import { and, asc, eq, inArray, like, sql } from "drizzle-orm";
import {
  currentTenantDatabaseOrganisation,
  db,
  workTasks,
} from "@workspace/db";
import { OPERATIONS_SUITE_BOUNDS } from "./bounds";
import {
  OPERATIONS_RECORD_KINDS,
  type OperationsRecord,
  type OperationsRecordKind,
  type OperationsScope,
  type OpportunityIntakeRecord,
  OPERATIONS_ENVELOPE_SCHEMA,
} from "./contracts";
import { OperationsSuiteError } from "./errors";
import type { OperationsSuiteStore } from "./store";

const TITLE_PREFIX = "[OPS:";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAX_ENVELOPE_CODE_UNITS = 524_288;
const MAX_ENVELOPE_BYTES = 2_097_152;
const MAX_LIST_BYTES = 8_388_608;

interface PersistedOperationsEnvelope {
  schema: typeof OPERATIONS_ENVELOPE_SCHEMA;
  record: OperationsRecord;
}

function storageTitle(record: OperationsRecord): string {
  const label = (() => {
    switch (record.kind) {
      case "opportunity_intake":
        return record.title;
      case "work_item":
        return record.title;
      case "evidence_request":
        return `Evidence request for ${record.recipientLabel}`;
      case "submission_war_room":
        return `Submission package ${record.packageVersionId}`;
      case "visual_qa_report":
        return `Visual QA ${record.packageVersionId}`;
      case "credential_verification":
        return `Credential check ${record.vaultItemId}`;
      case "mission":
        return record.title;
      case "post_award_item":
        return record.title;
    }
  })();
  return `${TITLE_PREFIX}${record.kind}] ${label}`.slice(0, 1_024);
}

function storageDueAt(record: OperationsRecord): Date | null {
  const value =
    record.kind === "work_item" ||
    record.kind === "evidence_request" ||
    record.kind === "post_award_item"
      ? record.dueAt
      : record.kind === "mission"
        ? record.startsAt
        : null;
  return value ? new Date(value) : null;
}

function storagePriority(
  record: OperationsRecord,
): "low" | "normal" | "high" | "critical" {
  return record.kind === "work_item" ? record.priority : "normal";
}

function storageStatus(record: OperationsRecord): string {
  switch (record.kind) {
    case "opportunity_intake":
    case "work_item":
    case "evidence_request":
    case "submission_war_room":
    case "mission":
    case "post_award_item":
      return record.status;
    case "visual_qa_report":
      return record.result.status;
    case "credential_verification":
      return record.outcome;
  }
}

function serialize(record: OperationsRecord): string {
  const value = JSON.stringify({ schema: OPERATIONS_ENVELOPE_SCHEMA, record });
  if (
    value.length > MAX_ENVELOPE_CODE_UNITS ||
    Buffer.byteLength(value, "utf8") > MAX_ENVELOPE_BYTES
  ) {
    throw new OperationsSuiteError(
      "capacity_exceeded",
      "The operations record is too large to persist safely.",
    );
  }
  return value;
}

function parseEnvelope(
  value: string | null,
  scope: OperationsScope,
  rowId: string,
  rowVersion: number,
): OperationsRecord {
  if (!value) {
    throw new OperationsSuiteError(
      "policy_denied",
      "The persisted operations record is missing.",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new OperationsSuiteError(
      "policy_denied",
      "The persisted operations record is malformed.",
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new OperationsSuiteError(
      "policy_denied",
      "The persisted operations envelope is malformed.",
    );
  }
  const envelope = parsed as Partial<PersistedOperationsEnvelope>;
  const record = envelope.record as OperationsRecord | undefined;
  if (
    envelope.schema !== OPERATIONS_ENVELOPE_SCHEMA ||
    !record ||
    typeof record !== "object" ||
    !OPERATIONS_RECORD_KINDS.includes(record.kind) ||
    record.id !== rowId ||
    record.organisationId !== scope.organisationId ||
    record.projectId !== scope.projectId ||
    record.version !== rowVersion ||
    !Number.isSafeInteger(record.version) ||
    record.version < 1
  ) {
    throw new OperationsSuiteError(
      "policy_denied",
      "The persisted operations record failed its scope or identity check.",
    );
  }
  if (record.kind === "evidence_request") {
    const invalidHistory = record.slots.some((slot) => {
      const history = (slot as { responseHistory?: unknown }).responseHistory;
      return (
        history !== undefined &&
        (!Array.isArray(history) ||
          history.length >
            OPERATIONS_SUITE_BOUNDS.evidenceResponseHistoryPerSlot)
      );
    });
    if (invalidHistory) {
      throw new OperationsSuiteError(
        "capacity_exceeded",
        "A persisted evidence response history exceeds its safe bound.",
      );
    }
    return structuredClone({
      ...record,
      slots: record.slots.map((slot) => ({
        ...slot,
        responseHistory: slot.responseHistory ?? [],
      })),
    });
  }
  return structuredClone(record);
}

function assertPersistableIdentity(record: OperationsRecord): void {
  if (!UUID_PATTERN.test(record.id)) {
    throw new OperationsSuiteError(
      "policy_denied",
      "Durable operations records require a UUID identity.",
    );
  }
}

function assertDurableScope(scope: OperationsScope): void {
  if (
    !UUID_PATTERN.test(scope.organisationId) ||
    !UUID_PATTERN.test(scope.projectId)
  ) {
    throw new OperationsSuiteError(
      "scope_denied",
      "The durable operations scope is invalid.",
    );
  }
}

function assertDurableRecordId(id: string): void {
  if (!UUID_PATTERN.test(id)) {
    throw new OperationsSuiteError("not_found", "The record was not found.");
  }
}

/**
 * Durable adapter over the existing tenant-RLS `work_tasks` relation.
 *
 * Operations records are stored as a closed, versioned JSON envelope and are
 * distinguished from legacy work tasks by a reserved title prefix. This keeps
 * the MVP additive and deployable without a new table. A future normalized
 * migration can move these envelopes without changing the service contract.
 */
export class DrizzleOperationsSuiteStore implements OperationsSuiteStore {
  async #lockScope(scope: OperationsScope): Promise<void> {
    assertDurableScope(scope);
    if (currentTenantDatabaseOrganisation() !== scope.organisationId) {
      throw new OperationsSuiteError(
        "scope_denied",
        "A matching tenant transaction is required for operations mutations.",
      );
    }
    // Match the global resource boundary: project/export lock first, then the
    // narrower operations-scope lock. This keeps direct/background adapter use
    // in the same order as mounted requests and package lifecycle mutations.
    await db.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${scope.projectId}, 0))`,
    );
    await db.execute(sql`
      SELECT pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
          ${`${scope.organisationId}:${scope.projectId}`},
          0
        )
      )
    `);
  }

  async #boundedIds(scope: OperationsScope): Promise<string[]> {
    assertDurableScope(scope);
    const metadata = await db
      .select({
        id: workTasks.id,
        codeUnits: sql<number>`pg_catalog.char_length(${workTasks.description})`,
        bytes: sql<number>`pg_catalog.octet_length(${workTasks.description})`,
      })
      .from(workTasks)
      .where(
        and(
          eq(workTasks.organisationId, scope.organisationId),
          eq(workTasks.projectId, scope.projectId),
          like(workTasks.title, `${TITLE_PREFIX}%`),
        ),
      )
      .orderBy(asc(workTasks.createdAt), asc(workTasks.id))
      .limit(OPERATIONS_SUITE_BOUNDS.recordsPerProject + 1);

    if (metadata.length > OPERATIONS_SUITE_BOUNDS.recordsPerProject) {
      throw new OperationsSuiteError(
        "capacity_exceeded",
        "The project operations record limit has been exceeded.",
      );
    }
    let totalBytes = 0;
    for (const row of metadata) {
      if (
        !Number.isSafeInteger(row.codeUnits) ||
        !Number.isSafeInteger(row.bytes) ||
        row.codeUnits < 1 ||
        row.codeUnits > MAX_ENVELOPE_CODE_UNITS ||
        row.bytes < 1 ||
        row.bytes > MAX_ENVELOPE_BYTES
      ) {
        throw new OperationsSuiteError(
          "capacity_exceeded",
          "A persisted operations record exceeds the safe materialisation limit.",
        );
      }
      totalBytes += row.bytes;
      if (totalBytes > MAX_LIST_BYTES) {
        throw new OperationsSuiteError(
          "capacity_exceeded",
          "The project operations snapshot exceeds the safe response limit.",
        );
      }
    }
    return metadata.map((row) => row.id);
  }

  async list(
    scope: OperationsScope,
    kind?: OperationsRecordKind,
  ): Promise<OperationsRecord[]> {
    const ids = await this.#boundedIds(scope);
    if (ids.length === 0) return [];
    const rows = await db
      .select({
        id: workTasks.id,
        description: workTasks.description,
        version: workTasks.version,
        createdAt: workTasks.createdAt,
      })
      .from(workTasks)
      .where(
        and(
          eq(workTasks.organisationId, scope.organisationId),
          eq(workTasks.projectId, scope.projectId),
          inArray(workTasks.id, ids),
        ),
      )
      .orderBy(asc(workTasks.createdAt), asc(workTasks.id));
    if (rows.length !== ids.length) {
      throw new OperationsSuiteError(
        "conflict",
        "The operations record set changed while it was being read.",
      );
    }
    return rows
      .map((row) => parseEnvelope(row.description, scope, row.id, row.version))
      .filter((record) => !kind || record.kind === kind);
  }

  async get(
    scope: OperationsScope,
    id: string,
  ): Promise<OperationsRecord | null> {
    assertDurableScope(scope);
    assertDurableRecordId(id);
    const [metadata] = await db
      .select({
        codeUnits: sql<number>`pg_catalog.char_length(${workTasks.description})`,
        bytes: sql<number>`pg_catalog.octet_length(${workTasks.description})`,
      })
      .from(workTasks)
      .where(
        and(
          eq(workTasks.id, id),
          eq(workTasks.organisationId, scope.organisationId),
          eq(workTasks.projectId, scope.projectId),
          like(workTasks.title, `${TITLE_PREFIX}%`),
        ),
      )
      .limit(1);
    if (!metadata) return null;
    if (
      !Number.isSafeInteger(metadata.codeUnits) ||
      !Number.isSafeInteger(metadata.bytes) ||
      metadata.codeUnits < 1 ||
      metadata.codeUnits > MAX_ENVELOPE_CODE_UNITS ||
      metadata.bytes < 1 ||
      metadata.bytes > MAX_ENVELOPE_BYTES
    ) {
      throw new OperationsSuiteError(
        "capacity_exceeded",
        "The persisted operations record exceeds the safe materialisation limit.",
      );
    }
    const [row] = await db
      .select({
        id: workTasks.id,
        description: workTasks.description,
        version: workTasks.version,
      })
      .from(workTasks)
      .where(
        and(
          eq(workTasks.id, id),
          eq(workTasks.organisationId, scope.organisationId),
          eq(workTasks.projectId, scope.projectId),
        ),
      )
      .limit(1);
    if (!row) {
      throw new OperationsSuiteError(
        "conflict",
        "The operations record changed while it was being read.",
      );
    }
    return parseEnvelope(row.description, scope, row.id, row.version);
  }

  async findOpportunityByDedupe(
    scope: OperationsScope,
    dedupeKey: string,
  ): Promise<OpportunityIntakeRecord | null> {
    await this.#lockScope(scope);
    const match = (await this.list(scope, "opportunity_intake")).find(
      (record): record is OpportunityIntakeRecord =>
        record.kind === "opportunity_intake" && record.dedupeKey === dedupeKey,
    );
    return match ?? null;
  }

  async insert(
    scope: OperationsScope,
    record: OperationsRecord,
  ): Promise<void> {
    if (
      record.organisationId !== scope.organisationId ||
      record.projectId !== scope.projectId
    ) {
      throw new OperationsSuiteError(
        "scope_denied",
        "The record does not belong to the active project scope.",
      );
    }
    assertPersistableIdentity(record);
    const description = serialize(record);
    await this.#lockScope(scope);
    const existing = await this.list(scope);
    if (existing.length >= OPERATIONS_SUITE_BOUNDS.recordsPerProject) {
      throw new OperationsSuiteError(
        "capacity_exceeded",
        "The project operations record limit has been reached.",
      );
    }
    if (
      record.kind === "opportunity_intake" &&
      existing.some(
        (candidate) =>
          candidate.kind === "opportunity_intake" &&
          candidate.dedupeKey === record.dedupeKey,
      )
    ) {
      throw new OperationsSuiteError(
        "conflict",
        "The opportunity source is already recorded for this pursuit.",
      );
    }
    if (
      record.kind === "submission_war_room" &&
      record.status !== "cancelled" &&
      existing.some(
        (candidate) =>
          candidate.kind === "submission_war_room" &&
          candidate.packageVersionId === record.packageVersionId &&
          candidate.status !== "cancelled",
      )
    ) {
      throw new OperationsSuiteError(
        "conflict",
        "An active war room already exists for this package version.",
      );
    }
    if (
      existing.filter((candidate) => candidate.kind === record.kind).length >=
      OPERATIONS_SUITE_BOUNDS.recordsPerKind
    ) {
      throw new OperationsSuiteError(
        "capacity_exceeded",
        `The ${record.kind} record limit has been reached.`,
      );
    }
    const inserted = await db
      .insert(workTasks)
      .values({
        id: record.id,
        organisationId: scope.organisationId,
        projectId: scope.projectId,
        title: storageTitle(record),
        description,
        dueAt: storageDueAt(record),
        priority: storagePriority(record),
        status: storageStatus(record),
        version: record.version,
      })
      .onConflictDoNothing({ target: workTasks.id })
      .returning({ id: workTasks.id });
    if (inserted.length !== 1) {
      throw new OperationsSuiteError("conflict", "The record already exists.");
    }
  }

  async compareAndSwap(
    scope: OperationsScope,
    id: string,
    expectedVersion: number,
    mutate: (
      current: OperationsRecord,
    ) => OperationsRecord | Promise<OperationsRecord>,
  ): Promise<OperationsRecord> {
    await this.#lockScope(scope);
    const current = await this.get(scope, id);
    if (!current) {
      throw new OperationsSuiteError("not_found", "The record was not found.");
    }
    if (current.version !== expectedVersion) {
      throw new OperationsSuiteError(
        "stale_version",
        "The record changed; reload before retrying.",
      );
    }
    const next = await mutate(structuredClone(current));
    if (
      next.id !== current.id ||
      next.kind !== current.kind ||
      next.organisationId !== scope.organisationId ||
      next.projectId !== scope.projectId ||
      next.version !== expectedVersion + 1
    ) {
      throw new OperationsSuiteError(
        "policy_denied",
        "The mutation violated record identity or version invariants.",
      );
    }
    const description = serialize(next);
    const rows = await db
      .update(workTasks)
      .set({
        title: storageTitle(next),
        description,
        dueAt: storageDueAt(next),
        priority: storagePriority(next),
        status: storageStatus(next),
        version: next.version,
        updatedAt: new Date(next.updatedAt),
      })
      .where(
        and(
          eq(workTasks.id, id),
          eq(workTasks.organisationId, scope.organisationId),
          eq(workTasks.projectId, scope.projectId),
          eq(workTasks.version, expectedVersion),
          like(workTasks.title, `${TITLE_PREFIX}%`),
        ),
      )
      .returning({ id: workTasks.id });
    if (rows.length !== 1) {
      throw new OperationsSuiteError(
        "stale_version",
        "The record changed; reload before retrying.",
      );
    }
    return structuredClone(next);
  }
}
