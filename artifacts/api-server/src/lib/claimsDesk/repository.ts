import { and, asc, eq, inArray, isNull, like, lte, or, sql } from "drizzle-orm";
import {
  db,
  documents,
  organisationMemberships,
  projects,
  users,
  withTenantDatabase,
  workTasks,
} from "@workspace/db";
import { writeAuditTx } from "../audit";
import {
  CLAIMS_DESK_BOUNDS,
  CLAIMS_DESK_LEDGER_SCHEMA,
  CLAIMS_DESK_NAMESPACE,
  ClaimsDeskProjectAccessError,
  ClaimsDeskRepositoryUnavailableError,
  type ClaimsDeskCreateDraft,
  type ClaimsDeskDocumentBinding,
  type ClaimsDeskMutationOutcome,
  type ClaimsDeskRecord,
  type ClaimsDeskRepository,
  type ClaimsDeskScope,
  type ClaimsDeskSnapshot,
  type ClaimsDeskTransitionDraft,
} from "./contracts";
import {
  CLAIMS_DESK_AUTHORITY_NOTE,
  buildClaimsDeskPosture,
  canonicalJson,
  claimsDeskSha256,
  decideClaimsDeskTransition,
  deterministicClaimsDeskUuid,
} from "./service";

const ZERO_SHA256 = "0".repeat(64);
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

type ClaimsDeskLedgerEventKind = "record_created" | "transition_recorded";

interface ClaimsDeskCreationPayload {
  recordType: ClaimsDeskCreateDraft["recordType"];
  reference: string;
  eventDate: string;
  dueAt: string | null;
  amountMinor: number | null;
  currency: string | null;
  documentBindings: readonly ClaimsDeskDocumentBinding[];
}

interface ClaimsDeskTransitionPayload {
  action: ClaimsDeskTransitionDraft["action"];
  reasonCode: ClaimsDeskTransitionDraft["reasonCode"];
  assessmentCode: ClaimsDeskTransitionDraft["assessmentCode"];
  documentBindings: readonly ClaimsDeskDocumentBinding[];
  fromStatus: ClaimsDeskRecord["status"];
  toStatus: ClaimsDeskRecord["status"];
  resultingAssessmentCode: ClaimsDeskRecord["assessmentCode"];
  pendingMakerUserId: string | null;
}

export interface PersistedClaimsDeskLedgerEvent {
  schema: typeof CLAIMS_DESK_LEDGER_SCHEMA;
  eventId: string;
  recordId: string;
  aggregateVersion: number;
  kind: ClaimsDeskLedgerEventKind;
  organisationId: string;
  projectId: string;
  occurredAt: string;
  actorUserId: string;
  actorMembershipId: string;
  idempotencyKeySha256: string;
  requestSha256: string;
  previousReceiptSha256: string;
  creation: ClaimsDeskCreationPayload | null;
  transition: ClaimsDeskTransitionPayload | null;
  receiptSha256: string;
}

type ClaimsTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function assertUuid(value: string, label: string): void {
  if (!UUID_PATTERN.test(value)) {
    throw new ClaimsDeskRepositoryUnavailableError(`Invalid ${label}`);
  }
}

function eventWithoutReceipt(event: PersistedClaimsDeskLedgerEvent) {
  const { receiptSha256: _receiptSha256, ...content } = event;
  return content;
}

export function createClaimsDeskEventReceipt(
  event: Omit<PersistedClaimsDeskLedgerEvent, "receiptSha256">,
): string {
  return claimsDeskSha256(event);
}

function serializeEvent(event: PersistedClaimsDeskLedgerEvent): string {
  const value = canonicalJson(event);
  if (
    value.length > CLAIMS_DESK_BOUNDS.envelopeCodeUnits ||
    Buffer.byteLength(value, "utf8") > CLAIMS_DESK_BOUNDS.envelopeBytes
  ) {
    throw new ClaimsDeskRepositoryUnavailableError(
      "Claims Desk event exceeds its bounded envelope",
    );
  }
  return value;
}

function parseEvent(
  value: string | null,
  rowId: string,
  scope: Pick<ClaimsDeskScope, "organisationId" | "projectId">,
): PersistedClaimsDeskLedgerEvent {
  if (!value) {
    throw new ClaimsDeskRepositoryUnavailableError(
      "Claims Desk event is empty",
    );
  }
  let event: PersistedClaimsDeskLedgerEvent;
  try {
    event = JSON.parse(value) as PersistedClaimsDeskLedgerEvent;
  } catch {
    throw new ClaimsDeskRepositoryUnavailableError(
      "Claims Desk event is malformed",
    );
  }
  if (
    !event ||
    event.schema !== CLAIMS_DESK_LEDGER_SCHEMA ||
    event.eventId !== rowId ||
    event.organisationId !== scope.organisationId ||
    event.projectId !== scope.projectId ||
    !UUID_PATTERN.test(event.recordId) ||
    !Number.isSafeInteger(event.aggregateVersion) ||
    event.aggregateVersion < 1 ||
    !SHA256_PATTERN.test(event.idempotencyKeySha256) ||
    !SHA256_PATTERN.test(event.requestSha256) ||
    !SHA256_PATTERN.test(event.previousReceiptSha256) ||
    !SHA256_PATTERN.test(event.receiptSha256) ||
    claimsDeskSha256(eventWithoutReceipt(event)) !== event.receiptSha256 ||
    (event.kind === "record_created") !== Boolean(event.creation) ||
    (event.kind === "transition_recorded") !== Boolean(event.transition)
  ) {
    throw new ClaimsDeskRepositoryUnavailableError(
      "Claims Desk event failed identity, scope or digest verification",
    );
  }
  return event;
}

export function reduceClaimsDeskLedger(
  events: readonly PersistedClaimsDeskLedgerEvent[],
): ClaimsDeskRecord[] {
  const byRecord = new Map<string, PersistedClaimsDeskLedgerEvent[]>();
  const idempotencyKeys = new Set<string>();
  for (const event of events) {
    if (idempotencyKeys.has(event.idempotencyKeySha256)) {
      throw new ClaimsDeskRepositoryUnavailableError(
        "Claims Desk idempotency evidence is duplicated",
      );
    }
    idempotencyKeys.add(event.idempotencyKeySha256);
    const recordEvents = byRecord.get(event.recordId) ?? [];
    recordEvents.push(event);
    byRecord.set(event.recordId, recordEvents);
  }
  if (byRecord.size > CLAIMS_DESK_BOUNDS.recordsPerProject) {
    throw new ClaimsDeskRepositoryUnavailableError(
      "Claims Desk record bound has been exceeded",
    );
  }

  const records: ClaimsDeskRecord[] = [];
  for (const [recordId, unsorted] of byRecord) {
    if (unsorted.length > CLAIMS_DESK_BOUNDS.eventsPerRecord) {
      throw new ClaimsDeskRepositoryUnavailableError(
        "Claims Desk per-record event bound has been exceeded",
      );
    }
    const ordered = [...unsorted].sort(
      (left, right) => left.aggregateVersion - right.aggregateVersion,
    );
    const first = ordered[0];
    if (
      !first ||
      first.kind !== "record_created" ||
      !first.creation ||
      first.aggregateVersion !== 1 ||
      first.previousReceiptSha256 !== ZERO_SHA256
    ) {
      throw new ClaimsDeskRepositoryUnavailableError(
        "Claims Desk aggregate has no valid genesis event",
      );
    }
    let record: ClaimsDeskRecord = {
      id: recordId,
      organisationId: first.organisationId,
      projectId: first.projectId,
      ...first.creation,
      status: "registered",
      assessmentCode: null,
      pendingMakerUserId: null,
      version: 1,
      createdByUserId: first.actorUserId,
      createdAt: first.occurredAt,
      updatedAt: first.occurredAt,
      latestReceiptSha256: first.receiptSha256,
      reasonHistory: [],
    };
    for (let index = 1; index < ordered.length; index += 1) {
      const event = ordered[index];
      if (
        !event ||
        event.kind !== "transition_recorded" ||
        !event.transition ||
        event.aggregateVersion !== index + 1 ||
        event.previousReceiptSha256 !== record.latestReceiptSha256
      ) {
        throw new ClaimsDeskRepositoryUnavailableError(
          "Claims Desk aggregate chain is incomplete or out of order",
        );
      }
      const draft: ClaimsDeskTransitionDraft = {
        action: event.transition.action,
        reasonCode: event.transition.reasonCode,
        assessmentCode: event.transition.assessmentCode,
        documentBindings: event.transition.documentBindings,
        idempotencyKey: "persisted-event",
      };
      const decision = decideClaimsDeskTransition(
        record,
        draft,
        event.actorUserId,
      );
      if (
        typeof decision === "string" ||
        decision.fromStatus !== event.transition.fromStatus ||
        decision.toStatus !== event.transition.toStatus ||
        decision.assessmentCode !== event.transition.resultingAssessmentCode ||
        decision.pendingMakerUserId !== event.transition.pendingMakerUserId
      ) {
        throw new ClaimsDeskRepositoryUnavailableError(
          "Claims Desk transition evidence violates the controlled workflow",
        );
      }
      record = {
        ...record,
        status: decision.toStatus,
        assessmentCode: decision.assessmentCode,
        pendingMakerUserId: decision.pendingMakerUserId,
        documentBindings: event.transition.documentBindings,
        version: event.aggregateVersion,
        updatedAt: event.occurredAt,
        latestReceiptSha256: event.receiptSha256,
        reasonHistory: [
          ...record.reasonHistory,
          {
            action: event.transition.action,
            reasonCode: event.transition.reasonCode,
            assessmentCode: event.transition.assessmentCode,
            fromStatus: decision.fromStatus,
            toStatus: decision.toStatus,
            actorUserId: event.actorUserId,
            occurredAt: event.occurredAt,
            receiptSha256: event.receiptSha256,
          },
        ],
      };
    }
    records.push(record);
  }
  return records.sort(
    (left, right) =>
      right.updatedAt.localeCompare(left.updatedAt) ||
      left.id.localeCompare(right.id),
  );
}

async function assertProject(
  tx: ClaimsTx,
  scope: Pick<ClaimsDeskScope, "organisationId" | "projectId">,
): Promise<string> {
  const [project] = await tx
    .select({ status: projects.status })
    .from(projects)
    .where(
      and(
        eq(projects.id, scope.projectId),
        eq(projects.organisationId, scope.organisationId),
      ),
    )
    .limit(1);
  if (!project) throw new ClaimsDeskProjectAccessError("not_found");
  if (project.status === "archived") {
    throw new ClaimsDeskProjectAccessError("archived");
  }
  return project.status;
}

async function assertActiveActor(
  tx: ClaimsTx,
  scope: ClaimsDeskScope,
  now: Date,
) {
  const [membership] = await tx
    .select()
    .from(organisationMemberships)
    .where(
      and(
        eq(organisationMemberships.id, scope.actorMembershipId),
        eq(organisationMemberships.organisationId, scope.organisationId),
        eq(organisationMemberships.userId, scope.actorUserId),
        eq(organisationMemberships.status, "active"),
        or(
          isNull(organisationMemberships.accessStartsAt),
          lte(organisationMemberships.accessStartsAt, now),
        ),
        or(
          isNull(organisationMemberships.accessExpiresAt),
          sql`${organisationMemberships.accessExpiresAt} > ${now}`,
        ),
      ),
    )
    .limit(1);
  if (!membership) {
    throw new ClaimsDeskRepositoryUnavailableError(
      "The direct actor membership is no longer active",
    );
  }
  const [actor] = await tx
    .select()
    .from(users)
    .where(and(eq(users.id, scope.actorUserId), eq(users.status, "active")))
    .limit(1);
  if (!actor) {
    throw new ClaimsDeskRepositoryUnavailableError(
      "The Claims Desk actor is unavailable",
    );
  }
  return actor;
}

async function verifyDocuments(
  tx: ClaimsTx,
  scope: Pick<ClaimsDeskScope, "organisationId" | "projectId">,
  bindings: readonly ClaimsDeskDocumentBinding[],
): Promise<boolean> {
  const ids = bindings.map((binding) => binding.documentId);
  const documentRows = await tx
    .select({
      id: documents.id,
      organisationId: documents.organisationId,
      projectId: documents.projectId,
      sha256: documents.sha256,
      extractionStatus: documents.extractionStatus,
    })
    .from(documents)
    .where(
      and(
        eq(documents.organisationId, scope.organisationId),
        eq(documents.projectId, scope.projectId),
        inArray(documents.id, ids),
      ),
    );
  if (documentRows.length !== ids.length) return false;
  const versionResult = await tx.execute(sql`
    SELECT
      current_version.document_id::text AS "documentId",
      current_version.sha256 AS sha256,
      current_version.malware_status AS "malwareStatus",
      current_version.quarantine_status AS "quarantineStatus"
    FROM document_versions AS current_version
    WHERE current_version.organisation_id = ${scope.organisationId}::uuid
      AND current_version.document_id IN (${sql.join(
        ids.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})
      AND NOT EXISTS (
        SELECT 1
        FROM document_versions AS later_version
        WHERE later_version.organisation_id = current_version.organisation_id
          AND later_version.document_id = current_version.document_id
          AND later_version.version_number > current_version.version_number
      )
    LIMIT ${CLAIMS_DESK_BOUNDS.documentsPerEvent + 1}
  `);
  if (versionResult.rows.length !== ids.length) return false;
  const versionRows = versionResult.rows as Array<{
    documentId: string;
    sha256: string;
    malwareStatus: string;
    quarantineStatus: string;
  }>;
  const bindingById = new Map(
    bindings.map((binding) => [binding.documentId, binding]),
  );
  return documentRows.every((document) => {
    const binding = bindingById.get(document.id);
    const current = versionRows.filter(
      (version) => version.documentId === document.id,
    );
    return Boolean(
      binding &&
      SHA256_PATTERN.test(binding.sha256) &&
      document.organisationId === scope.organisationId &&
      document.projectId === scope.projectId &&
      document.sha256 === binding.sha256 &&
      document.extractionStatus !== "quarantined" &&
      current.length === 1 &&
      current[0]?.sha256 === binding.sha256 &&
      current[0]?.malwareStatus === "clean" &&
      current[0]?.quarantineStatus === "cleared",
    );
  });
}

async function loadEvents(
  tx: ClaimsTx,
  scope: Pick<ClaimsDeskScope, "organisationId" | "projectId">,
): Promise<PersistedClaimsDeskLedgerEvent[]> {
  const metadata = await tx
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
        like(workTasks.title, `${CLAIMS_DESK_NAMESPACE}%`),
      ),
    )
    .orderBy(asc(workTasks.createdAt), asc(workTasks.id))
    .limit(CLAIMS_DESK_BOUNDS.eventsPerProject + 1);
  if (metadata.length > CLAIMS_DESK_BOUNDS.eventsPerProject) {
    throw new ClaimsDeskRepositoryUnavailableError(
      "Claims Desk event bound exceeded",
    );
  }
  let bytes = 0;
  for (const row of metadata) {
    if (
      !Number.isSafeInteger(row.codeUnits) ||
      !Number.isSafeInteger(row.bytes) ||
      row.codeUnits < 1 ||
      row.bytes < 1 ||
      row.codeUnits > CLAIMS_DESK_BOUNDS.envelopeCodeUnits ||
      row.bytes > CLAIMS_DESK_BOUNDS.envelopeBytes
    ) {
      throw new ClaimsDeskRepositoryUnavailableError(
        "Claims Desk event failed bounded materialisation",
      );
    }
    bytes += row.bytes;
    if (bytes > CLAIMS_DESK_BOUNDS.snapshotBytes) {
      throw new ClaimsDeskRepositoryUnavailableError(
        "Claims Desk snapshot is too large",
      );
    }
  }
  if (metadata.length === 0) return [];
  const rows = await tx
    .select({ id: workTasks.id, description: workTasks.description })
    .from(workTasks)
    .where(
      and(
        eq(workTasks.organisationId, scope.organisationId),
        eq(workTasks.projectId, scope.projectId),
        inArray(
          workTasks.id,
          metadata.map((row) => row.id),
        ),
      ),
    )
    .orderBy(asc(workTasks.createdAt), asc(workTasks.id));
  if (rows.length !== metadata.length) {
    throw new ClaimsDeskRepositoryUnavailableError(
      "Claims Desk changed while reading",
    );
  }
  return rows.map((row) => parseEvent(row.description, row.id, scope));
}

async function lockProject(
  tx: ClaimsTx,
  scope: ClaimsDeskScope,
): Promise<void> {
  await tx.execute(
    sql`SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(${scope.projectId}, 0))`,
  );
  await tx.execute(sql`
    SELECT pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(${`${scope.organisationId}:${scope.projectId}:claims-desk`}, 0)
    )
  `);
}

function idempotencyDigest(scope: ClaimsDeskScope, key: string): string {
  return claimsDeskSha256({
    namespace: "claims-desk-idempotency/v1",
    organisationId: scope.organisationId,
    projectId: scope.projectId,
    key,
  });
}

async function appendEvent(
  tx: ClaimsTx,
  scope: ClaimsDeskScope,
  event: PersistedClaimsDeskLedgerEvent,
  actor: Awaited<ReturnType<typeof assertActiveActor>>,
): Promise<boolean> {
  const inserted = await tx
    .insert(workTasks)
    .values({
      id: event.eventId,
      organisationId: scope.organisationId,
      projectId: scope.projectId,
      title: `${CLAIMS_DESK_NAMESPACE}${event.kind}] ${event.recordId}`,
      description: serializeEvent(event),
      ownerMembershipId: scope.actorMembershipId,
      priority: "normal",
      status: "recorded",
      version: 1,
    })
    .onConflictDoNothing({ target: workTasks.id })
    .returning({ id: workTasks.id });
  if (inserted.length !== 1) return false;
  await writeAuditTx(tx, {
    user: actor,
    organisationId: scope.organisationId,
    projectId: scope.projectId,
    eventType: `claims_desk.${event.kind}`,
    objectType: "claims_desk_record",
    objectId: event.recordId,
    details: canonicalJson({
      schema: "valo.claims-desk-audit-receipt/v1",
      receiptSha256: event.receiptSha256,
      recordId: event.recordId,
      eventId: event.eventId,
      aggregateVersion: event.aggregateVersion,
      kind: event.kind,
      occurredAt: event.occurredAt,
    }),
  });
  return true;
}

function snapshot(
  scope: ClaimsDeskScope,
  projectStatus: string,
  records: readonly ClaimsDeskRecord[],
  now: Date,
): ClaimsDeskSnapshot {
  return {
    organisationId: scope.organisationId,
    projectId: scope.projectId,
    projectStatus,
    records,
    posture: buildClaimsDeskPosture(records, now),
    truncated: false,
    generatedAt: now.toISOString(),
    legalConclusionAutomated: false,
    noticeDispatched: false,
    paymentMutated: false,
    authorityNote: CLAIMS_DESK_AUTHORITY_NOTE,
  };
}

export class PostgresClaimsDeskRepository implements ClaimsDeskRepository {
  async readSnapshot(
    scope: ClaimsDeskScope,
    now: Date,
  ): Promise<ClaimsDeskSnapshot> {
    assertUuid(scope.organisationId, "organisation scope");
    assertUuid(scope.projectId, "project scope");
    return withTenantDatabase(scope.organisationId, () =>
      db.transaction(async (tx) => {
        const projectStatus = await assertProject(tx, scope);
        await assertActiveActor(tx, scope, now);
        const records = reduceClaimsDeskLedger(await loadEvents(tx, scope));
        return snapshot(scope, projectStatus, records, now);
      }),
    );
  }

  async createRecord(
    scope: ClaimsDeskScope,
    draft: ClaimsDeskCreateDraft,
    now: Date,
  ): Promise<ClaimsDeskMutationOutcome> {
    assertUuid(scope.organisationId, "organisation scope");
    assertUuid(scope.projectId, "project scope");
    return withTenantDatabase(scope.organisationId, () =>
      db.transaction(async (tx) => {
        await lockProject(tx, scope);
        await assertProject(tx, scope);
        const actor = await assertActiveActor(tx, scope, now);
        const events = await loadEvents(tx, scope);
        const records = reduceClaimsDeskLedger(events);
        const keySha = idempotencyDigest(scope, draft.idempotencyKey);
        const creation: ClaimsDeskCreationPayload = {
          recordType: draft.recordType,
          reference: draft.reference,
          eventDate: draft.eventDate,
          dueAt: draft.dueAt,
          amountMinor: draft.amountMinor,
          currency: draft.currency,
          documentBindings: draft.documentBindings,
        };
        const requestSha = claimsDeskSha256({
          kind: "record_created",
          scope,
          creation,
        });
        const replay = events.find(
          (event) => event.idempotencyKeySha256 === keySha,
        );
        if (replay) {
          if (
            replay.kind !== "record_created" ||
            replay.requestSha256 !== requestSha
          ) {
            return { outcome: "idempotency_conflict" };
          }
          const record = records.find(
            (candidate) => candidate.id === replay.recordId,
          );
          if (!record) throw new ClaimsDeskRepositoryUnavailableError();
          return { outcome: "created", record, replayed: true };
        }
        if (
          events.length >= CLAIMS_DESK_BOUNDS.eventsPerProject ||
          records.length >= CLAIMS_DESK_BOUNDS.recordsPerProject
        ) {
          return { outcome: "capacity_exceeded" };
        }
        if (!(await verifyDocuments(tx, scope, draft.documentBindings))) {
          return { outcome: "evidence_conflict" };
        }
        const recordId = deterministicClaimsDeskUuid(
          `claims-desk-record:${scope.organisationId}:${scope.projectId}:${keySha}`,
        );
        const eventId = deterministicClaimsDeskUuid(
          `claims-desk-event:${scope.organisationId}:${scope.projectId}:${keySha}`,
        );
        const eventBase: Omit<PersistedClaimsDeskLedgerEvent, "receiptSha256"> =
          {
            schema: CLAIMS_DESK_LEDGER_SCHEMA,
            eventId,
            recordId,
            aggregateVersion: 1,
            kind: "record_created",
            organisationId: scope.organisationId,
            projectId: scope.projectId,
            occurredAt: now.toISOString(),
            actorUserId: scope.actorUserId,
            actorMembershipId: scope.actorMembershipId,
            idempotencyKeySha256: keySha,
            requestSha256: requestSha,
            previousReceiptSha256: ZERO_SHA256,
            creation,
            transition: null,
          };
        const event = {
          ...eventBase,
          receiptSha256: createClaimsDeskEventReceipt(eventBase),
        };
        if (!(await appendEvent(tx, scope, event, actor))) {
          return { outcome: "idempotency_conflict" };
        }
        const [record] = reduceClaimsDeskLedger([...events, event]).filter(
          (candidate) => candidate.id === recordId,
        );
        if (!record) throw new ClaimsDeskRepositoryUnavailableError();
        return { outcome: "created", record, replayed: false };
      }),
    );
  }

  async transitionRecord(
    scope: ClaimsDeskScope,
    recordId: string,
    expectedVersion: number,
    draft: ClaimsDeskTransitionDraft,
    now: Date,
  ): Promise<ClaimsDeskMutationOutcome> {
    assertUuid(recordId, "Claims Desk record");
    return withTenantDatabase(scope.organisationId, () =>
      db.transaction(async (tx) => {
        await lockProject(tx, scope);
        await assertProject(tx, scope);
        const actor = await assertActiveActor(tx, scope, now);
        const events = await loadEvents(tx, scope);
        const records = reduceClaimsDeskLedger(events);
        const keySha = idempotencyDigest(scope, draft.idempotencyKey);
        const transitionRequest = {
          action: draft.action,
          reasonCode: draft.reasonCode,
          assessmentCode: draft.assessmentCode,
          documentBindings: draft.documentBindings,
        };
        const requestSha = claimsDeskSha256({
          kind: "transition_recorded",
          scope,
          recordId,
          expectedVersion,
          draft: transitionRequest,
        });
        const replay = events.find(
          (event) => event.idempotencyKeySha256 === keySha,
        );
        if (replay) {
          if (
            replay.kind !== "transition_recorded" ||
            replay.recordId !== recordId ||
            replay.requestSha256 !== requestSha
          ) {
            return { outcome: "idempotency_conflict" };
          }
          const replayedRecord = records.find(
            (record) => record.id === recordId,
          );
          if (!replayedRecord) throw new ClaimsDeskRepositoryUnavailableError();
          return { outcome: "updated", record: replayedRecord, replayed: true };
        }
        const current = records.find((record) => record.id === recordId);
        if (!current) return { outcome: "not_found" };
        if (current.version !== expectedVersion)
          return { outcome: "version_conflict" };
        if (
          events.length >= CLAIMS_DESK_BOUNDS.eventsPerProject ||
          current.version >= CLAIMS_DESK_BOUNDS.eventsPerRecord
        ) {
          return { outcome: "capacity_exceeded" };
        }
        const decision = decideClaimsDeskTransition(
          current,
          draft,
          scope.actorUserId,
        );
        if (
          decision === "state_conflict" ||
          decision === "maker_checker_conflict"
        ) {
          return { outcome: decision };
        }
        // Evidence is canonicalised and revalidated on every transition, which
        // includes both terminal transitions (approve_closure and withdraw).
        if (!(await verifyDocuments(tx, scope, draft.documentBindings))) {
          return { outcome: "evidence_conflict" };
        }
        const transition: ClaimsDeskTransitionPayload = {
          action: draft.action,
          reasonCode: draft.reasonCode,
          assessmentCode: draft.assessmentCode,
          documentBindings: draft.documentBindings,
          fromStatus: decision.fromStatus,
          toStatus: decision.toStatus,
          resultingAssessmentCode: decision.assessmentCode,
          pendingMakerUserId: decision.pendingMakerUserId,
        };
        const eventId = deterministicClaimsDeskUuid(
          `claims-desk-event:${scope.organisationId}:${scope.projectId}:${keySha}`,
        );
        const eventBase: Omit<PersistedClaimsDeskLedgerEvent, "receiptSha256"> =
          {
            schema: CLAIMS_DESK_LEDGER_SCHEMA,
            eventId,
            recordId,
            aggregateVersion: expectedVersion + 1,
            kind: "transition_recorded",
            organisationId: scope.organisationId,
            projectId: scope.projectId,
            occurredAt: now.toISOString(),
            actorUserId: scope.actorUserId,
            actorMembershipId: scope.actorMembershipId,
            idempotencyKeySha256: keySha,
            requestSha256: requestSha,
            previousReceiptSha256: current.latestReceiptSha256,
            creation: null,
            transition,
          };
        const event = {
          ...eventBase,
          receiptSha256: createClaimsDeskEventReceipt(eventBase),
        };
        if (!(await appendEvent(tx, scope, event, actor))) {
          return { outcome: "idempotency_conflict" };
        }
        const next = reduceClaimsDeskLedger([...events, event]).find(
          (record) => record.id === recordId,
        );
        if (!next) throw new ClaimsDeskRepositoryUnavailableError();
        return { outcome: "updated", record: next, replayed: false };
      }),
    );
  }
}

export const postgresClaimsDeskRepository = new PostgresClaimsDeskRepository();
