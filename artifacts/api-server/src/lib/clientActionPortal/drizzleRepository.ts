import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNull,
  like,
  lte,
  or,
  sql,
} from "drizzle-orm";
import {
  currentTenantDatabaseOrganisation,
  db,
  documents,
  exportDeliveries,
  organisationMemberships,
  organisations,
  packageVersions,
  packages,
  projects,
  roleGrants,
  users,
  workTasks,
} from "@workspace/db";
import { ORGANISATION_ROLES } from "../permissions";
import {
  CLIENT_ACTION_BOUNDS,
  CLIENT_ACTION_PURPOSES,
  type ClientActionRecord,
  type ClientActionRecordKind,
  type ClientActionScope,
} from "./contracts";
import { ClientActionError } from "./errors";
import type { ClientActionAuthority, ClientActionRepository } from "./service";
import {
  clientActionRecipientPredicate,
  validClientActionAuthorityName,
} from "./authorityPolicy";

type ClientActionTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export const CLIENT_ACTION_TITLE_PREFIX = "[CLIENT-ACTION:" as const;
const ENVELOPE_SCHEMA = "valo.client-action-portal/v1" as const;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

function plain(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function validText(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maximum
  );
}

function validInstant(value: unknown): value is string {
  return validText(value, 64) && !Number.isNaN(Date.parse(value as string));
}

function validActorStamp(value: unknown, statement = false): boolean {
  const item = plain(value);
  return Boolean(
    item &&
    (!statement || validText(item.statement, CLIENT_ACTION_BOUNDS.statement)) &&
    UUID_PATTERN.test(String(item.acknowledgedByUserId)) &&
    validInstant(item.acknowledgedAt),
  );
}

function validAttempt(value: unknown): boolean {
  const attempt = plain(value);
  const intent = plain(attempt?.intent);
  const document = attempt?.document === null ? null : plain(attempt?.document);
  const review = attempt?.review === null ? null : plain(attempt?.review);
  const correction =
    attempt?.correctionAcknowledgement === null
      ? null
      : plain(attempt?.correctionAcknowledgement);
  return Boolean(
    attempt &&
    UUID_PATTERN.test(String(attempt.id)) &&
    intent &&
    UUID_PATTERN.test(String(intent.id)) &&
    validText(intent.filename, CLIENT_ACTION_BOUNDS.filename) &&
    validText(intent.contentType, 192) &&
    Number.isSafeInteger(intent.sizeBytes) &&
    Number(intent.sizeBytes) >= 1 &&
    Number(intent.sizeBytes) <= CLIENT_ACTION_BOUNDS.maximumIntentBytes &&
    SHA256_PATTERN.test(String(intent.declaredSha256)) &&
    UUID_PATTERN.test(String(intent.recordedByUserId)) &&
    validInstant(intent.recordedAt) &&
    (document === null ||
      (UUID_PATTERN.test(String(document.documentId)) &&
        SHA256_PATTERN.test(String(document.sha256)) &&
        UUID_PATTERN.test(String(document.attachedByUserId)) &&
        validInstant(document.attachedAt))) &&
    (review === null ||
      ((review.decision === "accepted" ||
        review.decision === "correction_required") &&
        validText(review.reason, CLIENT_ACTION_BOUNDS.statement) &&
        UUID_PATTERN.test(String(review.reviewedByUserId)) &&
        validInstant(review.reviewedAt))) &&
    (correction === null || validActorStamp(correction, true)) &&
    (document !== null || (review === null && correction === null)) &&
    (correction === null || review?.decision === "correction_required"),
  );
}

function validAttemptAuthority(
  value: unknown,
  recipientUserId: string,
): boolean {
  const attempt = plain(value);
  const intent = plain(attempt?.intent);
  const document = plain(attempt?.document);
  const review = plain(attempt?.review);
  const correction = plain(attempt?.correctionAcknowledgement);
  return Boolean(
    intent &&
    intent.recordedByUserId === recipientUserId &&
    (!document || document.attachedByUserId === recipientUserId) &&
    (!review || review.reviewedByUserId !== recipientUserId) &&
    (!correction || correction.acknowledgedByUserId === recipientUserId),
  );
}

function denied(message: string): never {
  throw new ClientActionError("scope_denied", message);
}

function assertScope(scope: ClientActionScope): void {
  if (
    !UUID_PATTERN.test(scope.organisationId) ||
    !UUID_PATTERN.test(scope.projectId) ||
    !UUID_PATTERN.test(scope.actorUserId) ||
    currentTenantDatabaseOrganisation() !== scope.organisationId
  ) {
    denied("Client action scope denied.");
  }
}

function assertRecordId(id: string): void {
  if (!UUID_PATTERN.test(id)) {
    throw new ClientActionError(
      "not_found",
      "The client action was not found.",
    );
  }
}

async function lockClientActionScope(
  transaction: ClientActionTx,
  scope: ClientActionScope,
): Promise<void> {
  assertScope(scope);
  await transaction.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${scope.projectId}, 0))`,
  );
  await transaction.execute(sql`
    select pg_advisory_xact_lock(
      hashtextextended(${`${scope.organisationId}:${scope.projectId}:client-actions`}, 0)
    )
  `);
}

async function readClientActionRecordsForWrite(
  transaction: ClientActionTx,
  scope: ClientActionScope,
): Promise<ClientActionRecord[]> {
  const rows = await transaction
    .select({
      id: workTasks.id,
      description: workTasks.description,
      version: workTasks.version,
      bytes: sql<number>`octet_length(${workTasks.description})`,
    })
    .from(workTasks)
    .where(
      and(
        eq(workTasks.organisationId, scope.organisationId),
        eq(workTasks.projectId, scope.projectId),
        like(workTasks.title, `${CLIENT_ACTION_TITLE_PREFIX}%`),
      ),
    )
    .orderBy(asc(workTasks.createdAt), asc(workTasks.id))
    .limit(CLIENT_ACTION_BOUNDS.recordsPerProject + 1)
    .for("update");
  if (rows.length > CLIENT_ACTION_BOUNDS.recordsPerProject) {
    throw new ClientActionError(
      "capacity_exceeded",
      "The client-action record limit has been exceeded.",
    );
  }
  let total = 0;
  for (const row of rows) {
    if (
      !Number.isSafeInteger(row.bytes) ||
      row.bytes < 1 ||
      row.bytes > CLIENT_ACTION_BOUNDS.envelopeBytes
    ) {
      throw new ClientActionError(
        "capacity_exceeded",
        "A persisted client action exceeds its safe bound.",
      );
    }
    total += row.bytes;
    if (total > CLIENT_ACTION_BOUNDS.snapshotBytes) {
      throw new ClientActionError(
        "capacity_exceeded",
        "The client-action snapshot exceeds its safe bound.",
      );
    }
  }
  return rows.map((row) =>
    parseEnvelope(row.description, scope, row.id, row.version),
  );
}

async function assertEvidenceRequestRecipientForWrite(
  transaction: ClientActionTx,
  scope: ClientActionScope,
  recipientUserId: string,
): Promise<void> {
  if (!UUID_PATTERN.test(recipientUserId)) {
    denied("Evidence request recipient access denied.");
  }
  const now = new Date();
  const projectRows = await transaction
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.id, scope.projectId),
        eq(projects.organisationId, scope.organisationId),
      ),
    )
    .limit(2)
    .for("share");
  if (projectRows.length !== 1) {
    denied("Project access denied.");
  }
  const recipientRows = await transaction
    .select({
      membershipId: organisationMemberships.id,
      name: users.name,
    })
    .from(organisationMemberships)
    .innerJoin(users, eq(users.id, organisationMemberships.userId))
    .innerJoin(
      organisations,
      eq(organisations.id, organisationMemberships.organisationId),
    )
    .where(
      and(
        clientActionRecipientPredicate(transaction, scope, now),
        eq(organisationMemberships.userId, recipientUserId),
      ),
    )
    .limit(2)
    .for("share");
  if (
    recipientRows.length !== 1 ||
    !validClientActionAuthorityName(recipientRows[0]!.name)
  ) {
    denied("Evidence request recipient access denied.");
  }
}

function recordTitle(record: ClientActionRecord): string {
  const label =
    record.kind === "evidence_request"
      ? `${record.purpose} for ${record.recipientUserId}`
      : `package ${record.packageVersionId} for ${record.recipientUserId}`;
  return `${CLIENT_ACTION_TITLE_PREFIX}${record.kind}] ${label}`.slice(
    0,
    1_024,
  );
}

function serialize(record: ClientActionRecord): string {
  const value = JSON.stringify({ schema: ENVELOPE_SCHEMA, record });
  if (Buffer.byteLength(value, "utf8") > CLIENT_ACTION_BOUNDS.envelopeBytes) {
    throw new ClientActionError(
      "capacity_exceeded",
      "The client action exceeds its durable envelope bound.",
    );
  }
  return value;
}

function parseEnvelope(
  raw: string | null,
  scope: ClientActionScope,
  rowId: string,
  rowVersion: number,
): ClientActionRecord {
  if (!raw) {
    throw new ClientActionError(
      "policy_denied",
      "The persisted client action is missing.",
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new ClientActionError(
      "policy_denied",
      "The persisted client action is malformed.",
    );
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ClientActionError(
      "policy_denied",
      "The persisted client action envelope is malformed.",
    );
  }
  const envelope = value as { schema?: unknown; record?: unknown };
  const record = envelope.record as Partial<ClientActionRecord> | undefined;
  if (
    envelope.schema !== ENVELOPE_SCHEMA ||
    !record ||
    (record.kind !== "evidence_request" &&
      record.kind !== "package_delivery") ||
    record.id !== rowId ||
    record.organisationId !== scope.organisationId ||
    record.projectId !== scope.projectId ||
    record.version !== rowVersion ||
    !Number.isSafeInteger(record.version) ||
    rowVersion < 1 ||
    !UUID_PATTERN.test(String(record.createdByUserId)) ||
    !UUID_PATTERN.test(String(record.updatedByUserId)) ||
    !validInstant(record.createdAt) ||
    !validInstant(record.updatedAt)
  ) {
    throw new ClientActionError(
      "policy_denied",
      "The persisted client action failed its scope or identity check.",
    );
  }
  if (record.kind === "evidence_request") {
    const candidate = record as Partial<
      Extract<ClientActionRecord, { kind: "evidence_request" }>
    >;
    if (
      !CLIENT_ACTION_PURPOSES.includes(candidate.purpose as never) ||
      !UUID_PATTERN.test(String(candidate.recipientUserId)) ||
      candidate.externalMessageSentByValo !== false ||
      !validText(candidate.purposeStatement, CLIENT_ACTION_BOUNDS.statement) ||
      ![
        "open",
        "acknowledged",
        "in_progress",
        "submitted",
        "changes_required",
        "completed",
      ].includes(String(candidate.status)) ||
      (candidate.requestAcknowledgement !== null &&
        !validActorStamp(candidate.requestAcknowledgement, true)) ||
      (plain(candidate.requestAcknowledgement)?.acknowledgedByUserId !==
        undefined &&
        plain(candidate.requestAcknowledgement)?.acknowledgedByUserId !==
          candidate.recipientUserId) ||
      (candidate.completionReceiptSha256 !== null &&
        !SHA256_PATTERN.test(String(candidate.completionReceiptSha256))) ||
      (candidate.status === "completed") !==
        SHA256_PATTERN.test(String(candidate.completionReceiptSha256)) ||
      !Array.isArray(candidate.slots) ||
      candidate.slots.length < 1 ||
      candidate.slots.length > CLIENT_ACTION_BOUNDS.slotsPerRequest ||
      candidate.slots.some(
        (slot) =>
          !UUID_PATTERN.test(String(slot?.id)) ||
          !validText(slot?.label, CLIENT_ACTION_BOUNDS.shortText) ||
          typeof slot?.required !== "boolean" ||
          !Array.isArray(slot?.attempts) ||
          slot.attempts.length > CLIENT_ACTION_BOUNDS.attemptsPerSlot ||
          slot.attempts.some((attempt) => !validAttempt(attempt)) ||
          slot.attempts.some(
            (attempt) =>
              !validAttemptAuthority(
                attempt,
                String(candidate.recipientUserId),
              ),
          ) ||
          !Array.isArray(slot.acceptedContentTypes) ||
          slot.acceptedContentTypes.length >
            CLIENT_ACTION_BOUNDS.contentTypesPerSlot ||
          slot.acceptedContentTypes.some(
            (contentType) => !validText(contentType, 192),
          ),
      )
    ) {
      throw new ClientActionError(
        "policy_denied",
        "The persisted evidence request failed its closed-schema bounds.",
      );
    }
  } else {
    const candidate = record as Partial<
      Extract<ClientActionRecord, { kind: "package_delivery" }>
    >;
    if (
      !UUID_PATTERN.test(String(candidate.recipientUserId)) ||
      !UUID_PATTERN.test(String(candidate.packageVersionId)) ||
      !SHA256_PATTERN.test(String(candidate.manifestSha256)) ||
      !SHA256_PATTERN.test(String(candidate.releaseReceiptSha256)) ||
      candidate.deliveryMode !== "metadata_record_only" ||
      candidate.externalDeliveryPerformedByValo !== false ||
      candidate.createdByUserId === candidate.recipientUserId ||
      (candidate.status !== "available_for_acknowledgement" &&
        candidate.status !== "acknowledged") ||
      (candidate.status === "available_for_acknowledgement" &&
        candidate.acknowledgement !== null) ||
      (candidate.status === "acknowledged" &&
        (!validActorStamp(candidate.acknowledgement, true) ||
          plain(candidate.acknowledgement)?.acknowledgedByUserId !==
            candidate.recipientUserId ||
          !SHA256_PATTERN.test(
            String(plain(candidate.acknowledgement)?.receiptSha256),
          )))
    ) {
      throw new ClientActionError(
        "policy_denied",
        "The persisted package delivery failed its closed-schema bounds.",
      );
    }
  }
  return structuredClone(record as ClientActionRecord);
}

// Governed adjacent workflows (for example, atomic client upload
// finalisation) must use the identical durable-envelope parser and serializer
// rather than maintaining a weaker parallel interpretation of work_tasks.
export const parsePersistedClientActionEnvelope = parseEnvelope;
export const serializePersistedClientActionEnvelope = serialize;
export const persistedClientActionTitle = recordTitle;

export class DrizzleClientActionRepository implements ClientActionRepository {
  async #lock(scope: ClientActionScope): Promise<void> {
    assertScope(scope);
    await db.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${scope.projectId}, 0))`,
    );
    await db.execute(sql`
      select pg_advisory_xact_lock(
        hashtextextended(${`${scope.organisationId}:${scope.projectId}:client-actions`}, 0)
      )
    `);
  }

  async #ids(scope: ClientActionScope): Promise<string[]> {
    assertScope(scope);
    const rows = await db
      .select({
        id: workTasks.id,
        bytes: sql<number>`octet_length(${workTasks.description})`,
      })
      .from(workTasks)
      .where(
        and(
          eq(workTasks.organisationId, scope.organisationId),
          eq(workTasks.projectId, scope.projectId),
          like(workTasks.title, `${CLIENT_ACTION_TITLE_PREFIX}%`),
        ),
      )
      .orderBy(asc(workTasks.createdAt), asc(workTasks.id))
      .limit(CLIENT_ACTION_BOUNDS.recordsPerProject + 1);
    if (rows.length > CLIENT_ACTION_BOUNDS.recordsPerProject) {
      throw new ClientActionError(
        "capacity_exceeded",
        "The client-action record limit has been exceeded.",
      );
    }
    let total = 0;
    for (const row of rows) {
      if (
        !Number.isSafeInteger(row.bytes) ||
        row.bytes < 1 ||
        row.bytes > CLIENT_ACTION_BOUNDS.envelopeBytes
      ) {
        throw new ClientActionError(
          "capacity_exceeded",
          "A persisted client action exceeds its safe bound.",
        );
      }
      total += row.bytes;
      if (total > CLIENT_ACTION_BOUNDS.snapshotBytes) {
        throw new ClientActionError(
          "capacity_exceeded",
          "The client-action snapshot exceeds its safe bound.",
        );
      }
    }
    return rows.map(({ id }) => id);
  }

  async list(
    scope: ClientActionScope,
    kind?: ClientActionRecordKind,
  ): Promise<ClientActionRecord[]> {
    const ids = await this.#ids(scope);
    if (ids.length === 0) return [];
    const rows = await db
      .select({
        id: workTasks.id,
        description: workTasks.description,
        version: workTasks.version,
      })
      .from(workTasks)
      .where(
        and(
          eq(workTasks.organisationId, scope.organisationId),
          eq(workTasks.projectId, scope.projectId),
          inArray(workTasks.id, ids),
          like(workTasks.title, `${CLIENT_ACTION_TITLE_PREFIX}%`),
        ),
      )
      .orderBy(asc(workTasks.createdAt), asc(workTasks.id));
    if (rows.length !== ids.length) {
      throw new ClientActionError(
        "conflict",
        "The client-action snapshot changed while it was read.",
      );
    }
    return rows
      .map((row) => parseEnvelope(row.description, scope, row.id, row.version))
      .filter((record) => !kind || record.kind === kind);
  }

  async insert(
    scope: ClientActionScope,
    record: ClientActionRecord,
    validateBeforeWrite?: () => Promise<void>,
  ): Promise<void> {
    if (
      record.organisationId !== scope.organisationId ||
      record.projectId !== scope.projectId ||
      !UUID_PATTERN.test(record.id)
    ) {
      denied("Client action scope denied.");
    }
    const description = serialize(record);
    await db.transaction(
      async (transaction) => {
        await lockClientActionScope(transaction, scope);
        const existing = await readClientActionRecordsForWrite(
          transaction,
          scope,
        );
        if (existing.length >= CLIENT_ACTION_BOUNDS.recordsPerProject) {
          throw new ClientActionError(
            "capacity_exceeded",
            "The client-action record limit has been reached.",
          );
        }
        if (
          record.kind === "package_delivery" &&
          existing.some(
            (candidate) =>
              candidate.kind === "package_delivery" &&
              candidate.packageVersionId === record.packageVersionId &&
              candidate.recipientUserId === record.recipientUserId,
          )
        ) {
          throw new ClientActionError(
            "conflict",
            "A delivery record already exists for this recipient and package version.",
          );
        }
        await validateBeforeWrite?.();
        if (record.kind === "evidence_request") {
          await assertEvidenceRequestRecipientForWrite(
            transaction,
            scope,
            record.recipientUserId,
          );
        }
        const inserted = await transaction
          .insert(workTasks)
          .values({
            id: record.id,
            organisationId: scope.organisationId,
            projectId: scope.projectId,
            title: recordTitle(record),
            description,
            dueAt:
              record.kind === "evidence_request" && record.dueAt
                ? new Date(record.dueAt)
                : null,
            priority: "normal",
            status: record.status,
            version: record.version,
          })
          .onConflictDoNothing({ target: workTasks.id })
          .returning({ id: workTasks.id });
        if (inserted.length !== 1) {
          throw new ClientActionError(
            "conflict",
            "The client action already exists.",
          );
        }
      },
      { isolationLevel: "read committed" },
    );
  }

  async compareAndSwap(
    scope: ClientActionScope,
    id: string,
    expectedVersion: number,
    mutate: (
      current: ClientActionRecord,
    ) => ClientActionRecord | Promise<ClientActionRecord>,
  ): Promise<ClientActionRecord> {
    assertRecordId(id);
    await this.#lock(scope);
    const rows = await db
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
          like(workTasks.title, `${CLIENT_ACTION_TITLE_PREFIX}%`),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) {
      throw new ClientActionError(
        "not_found",
        "The client action was not found.",
      );
    }
    const current = parseEnvelope(row.description, scope, row.id, row.version);
    if (current.version !== expectedVersion) {
      throw new ClientActionError(
        "stale_version",
        "The client action changed; reload before retrying.",
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
      throw new ClientActionError(
        "policy_denied",
        "Record identity or version invariant failed.",
      );
    }
    const updated = await db
      .update(workTasks)
      .set({
        title: recordTitle(next),
        description: serialize(next),
        dueAt:
          next.kind === "evidence_request" && next.dueAt
            ? new Date(next.dueAt)
            : null,
        status: next.status,
        version: next.version,
        updatedAt: new Date(next.updatedAt),
      })
      .where(
        and(
          eq(workTasks.id, id),
          eq(workTasks.organisationId, scope.organisationId),
          eq(workTasks.projectId, scope.projectId),
          eq(workTasks.version, expectedVersion),
          like(workTasks.title, `${CLIENT_ACTION_TITLE_PREFIX}%`),
        ),
      )
      .returning({ id: workTasks.id });
    if (updated.length !== 1) {
      throw new ClientActionError(
        "stale_version",
        "The client action changed; reload before retrying.",
      );
    }
    return structuredClone(next);
  }
}

export function createDbClientActionAuthority(): ClientActionAuthority {
  return {
    async assertProject(scope) {
      assertScope(scope);
      const rows = await db
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(
            eq(projects.id, scope.projectId),
            eq(projects.organisationId, scope.organisationId),
          ),
        )
        .limit(2);
      if (rows.length !== 1) denied("Project access denied.");
    },

    async assertNamedHuman(scope, userId) {
      assertScope(scope);
      if (!UUID_PATTERN.test(userId))
        denied("Named participant access denied.");
      const now = new Date();
      const rows = await db
        .selectDistinct({ membershipId: organisationMemberships.id })
        .from(organisationMemberships)
        .innerJoin(users, eq(users.id, organisationMemberships.userId))
        .innerJoin(
          organisations,
          eq(organisations.id, organisationMemberships.organisationId),
        )
        .innerJoin(
          roleGrants,
          eq(roleGrants.membershipId, organisationMemberships.id),
        )
        .where(
          and(
            eq(organisationMemberships.organisationId, scope.organisationId),
            eq(organisationMemberships.userId, userId),
            eq(organisationMemberships.status, "active"),
            isNull(organisationMemberships.delegatedByMembershipId),
            or(
              isNull(organisationMemberships.accessStartsAt),
              lte(organisationMemberships.accessStartsAt, now),
            ),
            or(
              isNull(organisationMemberships.accessExpiresAt),
              gt(organisationMemberships.accessExpiresAt, now),
            ),
            eq(organisations.status, "active"),
            eq(users.status, "active"),
            inArray(roleGrants.role, ORGANISATION_ROLES),
            isNull(roleGrants.revokedAt),
            or(isNull(roleGrants.startsAt), lte(roleGrants.startsAt, now)),
            or(isNull(roleGrants.expiresAt), gt(roleGrants.expiresAt, now)),
          ),
        )
        .limit(2);
      if (rows.length !== 1) {
        denied("Named participant access denied.");
      }
    },

    async assertEvidenceRequestRecipient(scope, userId) {
      assertScope(scope);
      if (!UUID_PATTERN.test(userId)) {
        denied("Evidence request recipient access denied.");
      }
      const now = new Date();
      const rows = await db
        .select({
          membershipId: organisationMemberships.id,
          name: users.name,
        })
        .from(organisationMemberships)
        .innerJoin(users, eq(users.id, organisationMemberships.userId))
        .innerJoin(
          organisations,
          eq(organisations.id, organisationMemberships.organisationId),
        )
        .where(
          and(
            clientActionRecipientPredicate(db, scope, now),
            eq(organisationMemberships.userId, userId),
          ),
        )
        .limit(2);
      if (rows.length !== 1 || !validClientActionAuthorityName(rows[0]!.name)) {
        denied("Evidence request recipient access denied.");
      }
    },

    async assertCanonicalDocument(scope, input) {
      assertScope(scope);
      if (
        !UUID_PATTERN.test(input.documentId) ||
        !UUID_PATTERN.test(input.uploadedByUserId) ||
        !SHA256_PATTERN.test(input.sha256)
      ) {
        denied("Canonical document access denied.");
      }
      const rows = await db
        .select({
          sha256: documents.sha256,
          contentType: documents.contentType,
          extractionStatus: documents.extractionStatus,
          uploadedBy: documents.uploadedBy,
        })
        .from(documents)
        .where(
          and(
            eq(documents.id, input.documentId),
            eq(documents.organisationId, scope.organisationId),
            eq(documents.projectId, scope.projectId),
            eq(documents.uploadedBy, input.uploadedByUserId),
            eq(documents.sha256, input.sha256),
          ),
        )
        .limit(2);
      const document = rows.length === 1 ? rows[0] : null;
      const mediaType = document?.contentType
        ?.trim()
        .toLocaleLowerCase("en-US");
      if (
        !document ||
        document.extractionStatus === "quarantined" ||
        document.sha256 !== input.sha256 ||
        document.uploadedBy !== input.uploadedByUserId ||
        (input.acceptedContentTypes.length > 0 &&
          (!mediaType || !input.acceptedContentTypes.includes(mediaType)))
      ) {
        denied("Canonical document access or integrity denied.");
      }
    },

    async assertReleasedPackage(scope, input) {
      assertScope(scope);
      if (
        !UUID_PATTERN.test(input.packageVersionId) ||
        !SHA256_PATTERN.test(input.manifestSha256) ||
        !SHA256_PATTERN.test(input.releaseReceiptSha256)
      ) {
        denied("Released package access denied.");
      }
      const rows = await db
        .select({
          manifestHash: packageVersions.manifestHash,
          versionNumber: packageVersions.versionNumber,
          currentVersionNumber: packages.currentVersionNumber,
          renderQaStatus: packageVersions.renderQaStatus,
          projectStatus: projects.status,
          receiptHash: exportDeliveries.deliveryReceiptHash,
          deliveryStatus: exportDeliveries.status,
        })
        .from(packageVersions)
        .innerJoin(
          packages,
          and(
            eq(packages.id, packageVersions.packageId),
            eq(packages.organisationId, packageVersions.organisationId),
          ),
        )
        .innerJoin(
          projects,
          and(
            eq(projects.id, packages.projectId),
            eq(projects.organisationId, packages.organisationId),
          ),
        )
        .innerJoin(
          exportDeliveries,
          and(
            eq(exportDeliveries.packageVersionId, packageVersions.id),
            eq(exportDeliveries.organisationId, scope.organisationId),
            eq(
              exportDeliveries.deliveryReceiptHash,
              input.releaseReceiptSha256,
            ),
            eq(exportDeliveries.status, "delivered"),
          ),
        )
        .where(
          and(
            eq(packageVersions.id, input.packageVersionId),
            eq(packageVersions.organisationId, scope.organisationId),
            eq(packages.projectId, scope.projectId),
            eq(packageVersions.manifestHash, input.manifestSha256),
            eq(packageVersions.renderQaStatus, "passed"),
            eq(projects.status, "exported"),
          ),
        )
        .limit(2);
      const released = rows.length === 1 ? rows[0] : null;
      if (
        !released ||
        released.versionNumber !== released.currentVersionNumber ||
        released.manifestHash !== input.manifestSha256 ||
        released.receiptHash !== input.releaseReceiptSha256 ||
        released.deliveryStatus !== "delivered"
      ) {
        denied("Released package access or integrity denied.");
      }
    },
  };
}
