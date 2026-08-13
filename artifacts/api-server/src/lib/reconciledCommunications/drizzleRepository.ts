import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, like, sql } from "drizzle-orm";
import {
  consentRecords,
  currentTenantDatabaseOrganisation,
  db,
  exportDeliveries,
  notificationAttempts,
  notificationEvents,
  organisationMemberships,
  packages,
  packageVersions,
  projects,
  users,
  workTasks,
} from "@workspace/db";
import { writeAuditTx } from "../audit";
import {
  COMMUNICATION_BOUNDS,
  COMMUNICATION_CHANNELS,
  COMMUNICATION_TEMPLATE_IDS,
  type CommunicationAttempt,
  type CommunicationAttemptStatus,
  type CommunicationChannel,
  type CommunicationEvent,
  type CommunicationEventStatus,
  type CommunicationReferenceSet,
  type CommunicationScope,
  type CommunicationTemplateContext,
  type CommunicationTemplateId,
} from "./contracts";
import { CommunicationError } from "./errors";
import {
  COMMUNICATION_ENVELOPE_SCHEMA,
  COMMUNICATION_TEMPLATE_PREFIX,
  type CommunicationAuthority,
  type CommunicationRepository,
  type PreparedCommunicationAttempt,
  type ProviderSettlementStatus,
  type QueueCommunicationRecord,
} from "./service";

type NotificationEventRow = typeof notificationEvents.$inferSelect;
type NotificationAttemptRow = typeof notificationAttempts.$inferSelect;
type CommunicationDatabase = (typeof import("@workspace/db"))["db"];
type CommunicationTx = Parameters<
  Parameters<CommunicationDatabase["transaction"]>[0]
>[0];

const ATTEMPT_SUMMARY_SCHEMA =
  "valo.reconciled-communications/attempt/v1" as const;
const CLIENT_ACTION_TITLE_PREFIX = "[CLIENT-ACTION:evidence_request]";
import {
  SHA256_HEX_PATTERN as SHA256_PATTERN,
  UUID_PATTERN,
} from "../identifierPatterns";
const SAFE_REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u;
const RETRY_DELAY_MS = 5 * 60 * 1_000;

interface DurableCommunicationEnvelope {
  schema: typeof COMMUNICATION_ENVELOPE_SCHEMA;
  idempotencyDigest: string;
  recipientUserId: string;
  consentEvidenceSha256: string;
  context: CommunicationTemplateContext;
  requestedByUserId: string;
  requestedAt: string;
  deadlineAt: string;
  maxAttempts: number;
  deliveryAuthority: "verified_provider_receipt_only";
  arbitraryBodyAccepted: false;
  rawRecipientPersisted: false;
}

interface DurableAttemptSummary {
  schema: typeof ATTEMPT_SUMMARY_SCHEMA;
  providerMessageId: string | null;
  receiptSha256: string | null;
}

const EVENT_STATUSES: readonly CommunicationEventStatus[] = [
  "queued",
  "prepared",
  "accepted_pending_receipt",
  "retry_wait",
  "reconciliation_required",
  "delivered",
  "dead_letter",
];
const ATTEMPT_STATUSES: readonly CommunicationAttemptStatus[] = [
  "prepared",
  "provider_disconnected",
  "policy_blocked",
  "provider_rejected",
  "outcome_unknown",
  "accepted_pending_receipt",
  "receipt_verified_delivered",
  "receipt_verified_failed",
];

function denied(message: string): never {
  throw new CommunicationError("scope_denied", message);
}

function assertScope(scope: CommunicationScope): void {
  if (
    !UUID_PATTERN.test(scope.organisationId) ||
    !UUID_PATTERN.test(scope.projectId) ||
    !UUID_PATTERN.test(scope.actorUserId) ||
    currentTenantDatabaseOrganisation() !== scope.organisationId
  ) {
    denied("Communication scope denied.");
  }
}

function assertEventId(eventId: string): void {
  if (!UUID_PATTERN.test(eventId)) {
    throw new CommunicationError(
      "not_found",
      "Communication intent not found.",
    );
  }
}

function plain(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function validInstant(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 64 &&
    Number.isFinite(Date.parse(value))
  );
}

function validReference(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= maximum &&
    SAFE_REFERENCE_PATTERN.test(value)
  );
}

function validContext(
  templateId: CommunicationTemplateId,
  value: unknown,
): value is CommunicationTemplateContext {
  const context = plain(value);
  if (!context) return false;
  switch (templateId) {
    case "deadline_reminder_v1":
      return (
        Object.keys(context).length === 2 &&
        context.kind === "deadline" &&
        validInstant(context.deadlineAt)
      );
    case "evidence_request_ready_v1":
      return (
        Object.keys(context).length === 3 &&
        context.kind === "evidence_request" &&
        UUID_PATTERN.test(String(context.requestId)) &&
        (context.dueAt === null || validInstant(context.dueAt))
      );
    case "evidence_correction_required_v1":
      return (
        Object.keys(context).length === 3 &&
        context.kind === "evidence_correction" &&
        UUID_PATTERN.test(String(context.requestId)) &&
        Number.isSafeInteger(context.correctionSequence) &&
        Number(context.correctionSequence) >= 1 &&
        Number(context.correctionSequence) <=
          COMMUNICATION_BOUNDS.attemptsPerEvent
      );
    case "package_ready_v1":
      return (
        Object.keys(context).length === 3 &&
        context.kind === "released_package" &&
        UUID_PATTERN.test(String(context.packageVersionId)) &&
        SHA256_PATTERN.test(String(context.manifestSha256))
      );
  }
}

function parseEnvelope(
  row: NotificationEventRow,
): DurableCommunicationEnvelope {
  if (
    row.organisationId == null ||
    row.projectId == null ||
    row.payload == null ||
    row.recipient == null
  ) {
    throw new CommunicationError(
      "policy_denied",
      "Persisted communication is incomplete.",
    );
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(row.payload);
  } catch {
    throw new CommunicationError(
      "policy_denied",
      "Persisted communication is malformed.",
    );
  }
  const envelope = plain(decoded);
  const templateId = row.template.startsWith(COMMUNICATION_TEMPLATE_PREFIX)
    ? row.template.slice(COMMUNICATION_TEMPLATE_PREFIX.length)
    : "";
  if (
    !envelope ||
    Object.keys(envelope).length !== 12 ||
    envelope.schema !== COMMUNICATION_ENVELOPE_SCHEMA ||
    !COMMUNICATION_CHANNELS.includes(row.channel as CommunicationChannel) ||
    !COMMUNICATION_TEMPLATE_IDS.includes(
      templateId as CommunicationTemplateId,
    ) ||
    !SHA256_PATTERN.test(String(envelope.idempotencyDigest)) ||
    !UUID_PATTERN.test(String(envelope.recipientUserId)) ||
    row.recipient !== `user:${String(envelope.recipientUserId)}` ||
    !SHA256_PATTERN.test(String(envelope.consentEvidenceSha256)) ||
    !UUID_PATTERN.test(String(envelope.requestedByUserId)) ||
    row.createdBy !== envelope.requestedByUserId ||
    !validInstant(envelope.requestedAt) ||
    !validInstant(envelope.deadlineAt) ||
    Date.parse(String(envelope.deadlineAt)) <=
      Date.parse(String(envelope.requestedAt)) ||
    !Number.isSafeInteger(envelope.maxAttempts) ||
    Number(envelope.maxAttempts) < 1 ||
    Number(envelope.maxAttempts) > COMMUNICATION_BOUNDS.attemptsPerEvent ||
    envelope.deliveryAuthority !== "verified_provider_receipt_only" ||
    envelope.arbitraryBodyAccepted !== false ||
    envelope.rawRecipientPersisted !== false ||
    !validContext(templateId as CommunicationTemplateId, envelope.context)
  ) {
    throw new CommunicationError(
      "policy_denied",
      "Persisted communication failed its closed-schema policy.",
    );
  }
  return envelope as unknown as DurableCommunicationEnvelope;
}

function parseAttempt(row: NotificationAttemptRow): CommunicationAttempt {
  let summary: DurableAttemptSummary = {
    schema: ATTEMPT_SUMMARY_SCHEMA,
    providerMessageId: null,
    receiptSha256: null,
  };
  if (row.responseSummary != null) {
    try {
      const decoded = plain(JSON.parse(row.responseSummary));
      if (
        !decoded ||
        Object.keys(decoded).length !== 3 ||
        decoded.schema !== ATTEMPT_SUMMARY_SCHEMA ||
        (decoded.providerMessageId !== null &&
          !validReference(
            decoded.providerMessageId,
            COMMUNICATION_BOUNDS.providerReference,
          )) ||
        (decoded.receiptSha256 !== null &&
          !SHA256_PATTERN.test(String(decoded.receiptSha256)))
      ) {
        throw new Error("invalid summary");
      }
      summary = decoded as unknown as DurableAttemptSummary;
    } catch {
      throw new CommunicationError(
        "policy_denied",
        "Persisted attempt summary is malformed.",
      );
    }
  }
  if (
    !UUID_PATTERN.test(row.id) ||
    !Number.isSafeInteger(row.attemptNumber) ||
    row.attemptNumber < 1 ||
    row.attemptNumber > COMMUNICATION_BOUNDS.attemptsPerEvent ||
    !validReference(row.provider, COMMUNICATION_BOUNDS.providerReference) ||
    !SHA256_PATTERN.test(row.idempotencyKey) ||
    !ATTEMPT_STATUSES.includes(row.status as CommunicationAttemptStatus) ||
    (row.responseCode != null &&
      !validReference(row.responseCode, COMMUNICATION_BOUNDS.responseCode))
  ) {
    throw new CommunicationError(
      "policy_denied",
      "Persisted attempt failed its safe bounds.",
    );
  }
  return {
    id: row.id,
    attemptNumber: row.attemptNumber,
    provider: row.provider,
    idempotencyKey: row.idempotencyKey,
    status: row.status as CommunicationAttemptStatus,
    providerMessageId: summary.providerMessageId,
    receiptSha256: summary.receiptSha256,
    responseCode: row.responseCode,
    attemptedAt: row.attemptedAt.toISOString(),
    nextAttemptAt: row.nextAttemptAt?.toISOString() ?? null,
  };
}

function assertState(event: CommunicationEvent): void {
  const latest = event.attempts.at(-1);
  const consistent =
    (event.status === "queued" && !latest) ||
    (event.status === "prepared" && latest?.status === "prepared") ||
    (event.status === "accepted_pending_receipt" &&
      latest?.status === "accepted_pending_receipt") ||
    (event.status === "reconciliation_required" &&
      latest?.status === "outcome_unknown") ||
    (event.status === "delivered" &&
      latest?.status === "receipt_verified_delivered") ||
    (event.status === "retry_wait" &&
      latest != null &&
      [
        "provider_disconnected",
        "policy_blocked",
        "provider_rejected",
        "receipt_verified_failed",
      ].includes(latest.status)) ||
    (event.status === "dead_letter" &&
      latest != null &&
      [
        "provider_disconnected",
        "policy_blocked",
        "provider_rejected",
        "receipt_verified_failed",
      ].includes(latest.status));
  if (!consistent) {
    throw new CommunicationError(
      "policy_denied",
      "Persisted communication state is inconsistent.",
    );
  }
}

function materialize(
  row: NotificationEventRow,
  attemptRows: readonly NotificationAttemptRow[],
): CommunicationEvent {
  const envelope = parseEnvelope(row);
  if (
    !EVENT_STATUSES.includes(row.status as CommunicationEventStatus) ||
    !Number.isSafeInteger(row.version) ||
    row.version < 1
  ) {
    throw new CommunicationError(
      "policy_denied",
      "Persisted communication status is invalid.",
    );
  }
  const templateId = row.template.slice(
    COMMUNICATION_TEMPLATE_PREFIX.length,
  ) as CommunicationTemplateId;
  const attempts = attemptRows.map(parseAttempt);
  if (
    attempts.length > envelope.maxAttempts ||
    attempts.some((attempt, index) => attempt.attemptNumber !== index + 1)
  ) {
    throw new CommunicationError(
      "policy_denied",
      "Persisted attempt sequence is invalid.",
    );
  }
  const event: CommunicationEvent = {
    id: row.id,
    organisationId: row.organisationId!,
    projectId: row.projectId!,
    channel: row.channel as CommunicationChannel,
    templateId,
    recipientUserId: envelope.recipientUserId,
    consentEvidenceSha256: envelope.consentEvidenceSha256,
    context: envelope.context,
    status: row.status as CommunicationEventStatus,
    requestedByUserId: envelope.requestedByUserId,
    requestedAt: envelope.requestedAt,
    deadlineAt: envelope.deadlineAt,
    maxAttempts: envelope.maxAttempts,
    version: row.version,
    attempts,
    deliveryAuthority: "verified_provider_receipt_only",
    arbitraryBodyAccepted: false,
    rawRecipientPersisted: false,
  };
  assertState(event);
  return event;
}

function durableEnvelope(
  record: QueueCommunicationRecord,
): DurableCommunicationEnvelope {
  const event = record.event;
  return {
    schema: COMMUNICATION_ENVELOPE_SCHEMA,
    idempotencyDigest: record.idempotencyDigest,
    recipientUserId: event.recipientUserId,
    consentEvidenceSha256: event.consentEvidenceSha256,
    context: event.context,
    requestedByUserId: event.requestedByUserId,
    requestedAt: event.requestedAt,
    deadlineAt: event.deadlineAt,
    maxAttempts: event.maxAttempts,
    deliveryAuthority: "verified_provider_receipt_only",
    arbitraryBodyAccepted: false,
    rawRecipientPersisted: false,
  };
}

function serializeEnvelope(record: QueueCommunicationRecord): string {
  const encoded = JSON.stringify(durableEnvelope(record));
  if (Buffer.byteLength(encoded, "utf8") > COMMUNICATION_BOUNDS.envelopeBytes) {
    throw new CommunicationError(
      "capacity_exceeded",
      "Communication envelope exceeds its safe bound.",
    );
  }
  return encoded;
}

function summary(
  providerMessageId: string | null,
  receiptSha256: string | null,
): string {
  return JSON.stringify({
    schema: ATTEMPT_SUMMARY_SCHEMA,
    providerMessageId,
    receiptSha256,
  } satisfies DurableAttemptSummary);
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

import { deterministicUuidFromBytes as deterministicUuid } from "../deterministicUuid";

function sameIntent(
  row: NotificationEventRow,
  candidate: QueueCommunicationRecord,
): boolean {
  try {
    const envelope = parseEnvelope(row);
    const expected = durableEnvelope(candidate);
    return (
      row.id === candidate.event.id &&
      row.organisationId === candidate.event.organisationId &&
      row.projectId === candidate.event.projectId &&
      row.channel === candidate.event.channel &&
      row.template ===
        `${COMMUNICATION_TEMPLATE_PREFIX}${candidate.event.templateId}` &&
      envelope.idempotencyDigest === expected.idempotencyDigest &&
      envelope.recipientUserId === expected.recipientUserId &&
      envelope.consentEvidenceSha256 === expected.consentEvidenceSha256 &&
      JSON.stringify(envelope.context) === JSON.stringify(expected.context) &&
      envelope.requestedByUserId === expected.requestedByUserId &&
      envelope.deadlineAt === expected.deadlineAt &&
      envelope.maxAttempts === expected.maxAttempts
    );
  } catch {
    return false;
  }
}

async function lockProject(
  tx: CommunicationTx,
  scope: CommunicationScope,
): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`${scope.organisationId}:${scope.projectId}:communications`}, 0))`,
  );
}

async function auditUser(tx: CommunicationTx, actorUserId: string) {
  const [user] = await tx
    .select()
    .from(users)
    .where(eq(users.id, actorUserId))
    .limit(1);
  if (!user || user.status !== "active")
    denied("Named operator access denied.");
  return user;
}

async function loadAttempts(
  tx: CommunicationTx,
  organisationId: string,
  eventId: string,
  lock = false,
): Promise<NotificationAttemptRow[]> {
  const query = tx
    .select()
    .from(notificationAttempts)
    .where(
      and(
        eq(notificationAttempts.organisationId, organisationId),
        eq(notificationAttempts.notificationEventId, eventId),
      ),
    )
    .orderBy(asc(notificationAttempts.attemptNumber));
  return lock ? query.for("update") : query;
}

async function loadEvent(
  tx: CommunicationTx,
  scope: CommunicationScope,
  eventId: string,
  lock = false,
): Promise<{ row: NotificationEventRow; event: CommunicationEvent }> {
  const query = tx
    .select()
    .from(notificationEvents)
    .where(
      and(
        eq(notificationEvents.id, eventId),
        eq(notificationEvents.organisationId, scope.organisationId),
        eq(notificationEvents.projectId, scope.projectId),
        like(notificationEvents.template, `${COMMUNICATION_TEMPLATE_PREFIX}%`),
      ),
    )
    .limit(1);
  const rows = lock ? await query.for("update") : await query;
  const row = rows[0];
  if (!row)
    throw new CommunicationError(
      "not_found",
      "Communication intent not found.",
    );
  const attempts = await loadAttempts(tx, scope.organisationId, eventId, lock);
  return { row, event: materialize(row, attempts) };
}

function assertVersion(actual: number, expected: number): void {
  if (actual !== expected) {
    throw new CommunicationError(
      "stale_version",
      "Communication intent changed; reload before retrying.",
    );
  }
}

export class DrizzleCommunicationRepository implements CommunicationRepository {
  async list(scope: CommunicationScope): Promise<CommunicationEvent[]> {
    assertScope(scope);
    const rows = await db
      .select({
        row: notificationEvents,
        bytes: sql<number>`octet_length(${notificationEvents.payload})`,
      })
      .from(notificationEvents)
      .where(
        and(
          eq(notificationEvents.organisationId, scope.organisationId),
          eq(notificationEvents.projectId, scope.projectId),
          like(
            notificationEvents.template,
            `${COMMUNICATION_TEMPLATE_PREFIX}%`,
          ),
        ),
      )
      .orderBy(desc(notificationEvents.createdAt), desc(notificationEvents.id))
      .limit(COMMUNICATION_BOUNDS.eventsPerProject + 1);
    if (rows.length > COMMUNICATION_BOUNDS.eventsPerProject) {
      throw new CommunicationError(
        "capacity_exceeded",
        "Communication snapshot exceeds its event bound.",
      );
    }
    let bytes = 0;
    for (const item of rows) {
      if (
        !Number.isSafeInteger(item.bytes) ||
        item.bytes < 1 ||
        item.bytes > COMMUNICATION_BOUNDS.envelopeBytes
      ) {
        throw new CommunicationError(
          "capacity_exceeded",
          "Persisted envelope exceeds its safe bound.",
        );
      }
      bytes += item.bytes;
    }
    if (bytes > COMMUNICATION_BOUNDS.snapshotBytes) {
      throw new CommunicationError(
        "capacity_exceeded",
        "Communication snapshot exceeds its byte bound.",
      );
    }
    if (rows.length === 0) return [];
    const ids = rows.map(({ row }) => row.id);
    const attempts = await db
      .select()
      .from(notificationAttempts)
      .where(
        and(
          eq(notificationAttempts.organisationId, scope.organisationId),
          inArray(notificationAttempts.notificationEventId, ids),
        ),
      )
      .orderBy(asc(notificationAttempts.attemptNumber));
    const byEvent = new Map<string, NotificationAttemptRow[]>();
    for (const attempt of attempts) {
      const group = byEvent.get(attempt.notificationEventId) ?? [];
      group.push(attempt);
      byEvent.set(attempt.notificationEventId, group);
    }
    return rows.map(({ row }) => materialize(row, byEvent.get(row.id) ?? []));
  }

  async get(
    scope: CommunicationScope,
    eventId: string,
  ): Promise<CommunicationEvent> {
    assertScope(scope);
    assertEventId(eventId);
    return db.transaction(
      async (tx) => (await loadEvent(tx, scope, eventId)).event,
      { isolationLevel: "read committed" },
    );
  }

  async queue(
    scope: CommunicationScope,
    record: QueueCommunicationRecord,
  ): Promise<CommunicationEvent> {
    assertScope(scope);
    if (
      record.event.organisationId !== scope.organisationId ||
      record.event.projectId !== scope.projectId ||
      record.event.requestedByUserId !== scope.actorUserId ||
      record.event.version !== 1 ||
      record.event.status !== "queued" ||
      record.event.attempts.length !== 0 ||
      !SHA256_PATTERN.test(record.idempotencyDigest)
    ) {
      denied("Communication record scope denied.");
    }
    const payload = serializeEnvelope(record);
    return db.transaction(
      async (tx) => {
        await lockProject(tx, scope);
        const [existing] = await tx
          .select()
          .from(notificationEvents)
          .where(eq(notificationEvents.id, record.event.id))
          .limit(1)
          .for("update");
        if (existing) {
          if (!sameIntent(existing, record)) {
            throw new CommunicationError(
              "conflict",
              "Idempotency key conflicts with another intent.",
            );
          }
          return (await loadEvent(tx, scope, record.event.id)).event;
        }
        const [{ count }] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(notificationEvents)
          .where(
            and(
              eq(notificationEvents.organisationId, scope.organisationId),
              eq(notificationEvents.projectId, scope.projectId),
              like(
                notificationEvents.template,
                `${COMMUNICATION_TEMPLATE_PREFIX}%`,
              ),
            ),
          );
        if (count >= COMMUNICATION_BOUNDS.eventsPerProject) {
          throw new CommunicationError(
            "capacity_exceeded",
            "Communication intent limit reached.",
          );
        }
        const [inserted] = await tx
          .insert(notificationEvents)
          .values({
            id: record.event.id,
            organisationId: scope.organisationId,
            projectId: scope.projectId,
            channel: record.event.channel,
            template: `${COMMUNICATION_TEMPLATE_PREFIX}${record.event.templateId}`,
            recipient: `user:${record.event.recipientUserId}`,
            payload,
            status: "queued",
            createdBy: scope.actorUserId,
            version: 1,
            createdAt: new Date(record.event.requestedAt),
            updatedAt: new Date(record.event.requestedAt),
          })
          .onConflictDoNothing({ target: notificationEvents.id })
          .returning();
        if (!inserted) {
          throw new CommunicationError(
            "conflict",
            "Communication intent could not be queued atomically.",
          );
        }
        await writeAuditTx(tx, {
          user: await auditUser(tx, scope.actorUserId),
          organisationId: scope.organisationId,
          projectId: scope.projectId,
          eventType: "communications.intent_queued",
          objectType: "notification_event",
          objectId: inserted.id,
          details: JSON.stringify({
            channel: record.event.channel,
            templateId: record.event.templateId,
            approvedTemplateOnly: true,
            arbitraryBodyAccepted: false,
            rawRecipientPersisted: false,
          }),
        });
        return materialize(inserted, []);
      },
      { isolationLevel: "read committed" },
    );
  }

  async prepareAttempt(input: {
    scope: CommunicationScope;
    eventId: string;
    expectedVersion: number;
    provider: string;
    now: Date;
  }): Promise<PreparedCommunicationAttempt> {
    assertScope(input.scope);
    assertEventId(input.eventId);
    if (
      !Number.isSafeInteger(input.expectedVersion) ||
      input.expectedVersion < 1 ||
      !validReference(input.provider, COMMUNICATION_BOUNDS.providerReference) ||
      !Number.isFinite(input.now.getTime())
    ) {
      throw new CommunicationError(
        "invalid_request",
        "Attempt control is invalid.",
      );
    }
    return db.transaction(
      async (tx) => {
        const loaded = await loadEvent(tx, input.scope, input.eventId, true);
        const current = loaded.event;
        assertVersion(current.version, input.expectedVersion);
        const prior = current.attempts.at(-1);
        if (current.status === "prepared" && prior?.status === "prepared") {
          if (prior.provider !== input.provider) {
            throw new CommunicationError(
              "conflict",
              "Prepared provider no longer matches configuration.",
            );
          }
          return { event: current, attempt: prior };
        }
        if (current.status !== "queued" && current.status !== "retry_wait") {
          throw new CommunicationError(
            "policy_denied",
            "Communication is not eligible for delivery.",
          );
        }
        if (
          Date.parse(current.deadlineAt) <= input.now.getTime() ||
          (current.status === "retry_wait" &&
            current.attempts.at(-1)?.nextAttemptAt != null &&
            Date.parse(current.attempts.at(-1)!.nextAttemptAt!) >
              input.now.getTime())
        ) {
          throw new CommunicationError(
            "policy_denied",
            "Communication is not currently due.",
          );
        }
        const attemptNumber = current.attempts.length + 1;
        if (attemptNumber > current.maxAttempts) {
          throw new CommunicationError(
            "policy_denied",
            "Communication retry limit reached.",
          );
        }
        const attemptId = deterministicUuid(
          `${COMMUNICATION_ENVELOPE_SCHEMA}\0attempt\0${current.id}\0${attemptNumber}`,
        );
        const idempotencyKey = digest(
          `${COMMUNICATION_ENVELOPE_SCHEMA}\0delivery\0${current.id}\0${attemptNumber}`,
        );
        const [attemptRow] = await tx
          .insert(notificationAttempts)
          .values({
            id: attemptId,
            organisationId: input.scope.organisationId,
            notificationEventId: current.id,
            attemptNumber,
            provider: input.provider,
            idempotencyKey,
            status: "prepared",
            responseSummary: summary(null, null),
            attemptedAt: input.now,
          })
          .returning();
        const [eventRow] = await tx
          .update(notificationEvents)
          .set({
            status: "prepared",
            version: current.version + 1,
            updatedAt: input.now,
          })
          .where(
            and(
              eq(notificationEvents.id, current.id),
              eq(notificationEvents.organisationId, input.scope.organisationId),
              eq(notificationEvents.projectId, input.scope.projectId),
              eq(notificationEvents.version, current.version),
              eq(notificationEvents.status, current.status),
            ),
          )
          .returning();
        if (!attemptRow || !eventRow) {
          throw new CommunicationError(
            "stale_version",
            "Communication changed while preparing delivery.",
          );
        }
        await writeAuditTx(tx, {
          user: await auditUser(tx, input.scope.actorUserId),
          organisationId: input.scope.organisationId,
          projectId: input.scope.projectId,
          eventType: "communications.attempt_prepared",
          objectType: "notification_attempt",
          objectId: attemptRow.id,
          details: JSON.stringify({
            attemptNumber,
            preEffectRecordCommitted: true,
            autonomousDispatch: false,
            deliveryClaimed: false,
          }),
        });
        return {
          event: materialize(eventRow, [
            ...loaded.event.attempts.map((attempt) => ({
              id: attempt.id,
              organisationId: input.scope.organisationId,
              notificationEventId: current.id,
              attemptNumber: attempt.attemptNumber,
              provider: attempt.provider,
              idempotencyKey: attempt.idempotencyKey,
              status: attempt.status,
              responseCode: attempt.responseCode,
              responseSummary: summary(
                attempt.providerMessageId,
                attempt.receiptSha256,
              ),
              nextAttemptAt: attempt.nextAttemptAt
                ? new Date(attempt.nextAttemptAt)
                : null,
              attemptedAt: new Date(attempt.attemptedAt),
            })),
            attemptRow,
          ]),
          attempt: parseAttempt(attemptRow),
        };
      },
      { isolationLevel: "read committed" },
    );
  }

  async settleAttempt(input: {
    scope: CommunicationScope;
    eventId: string;
    attemptId: string;
    expectedVersion: number;
    status: ProviderSettlementStatus;
    providerMessageId?: string | null;
    responseCode?: string | null;
    now: Date;
  }): Promise<CommunicationEvent> {
    assertScope(input.scope);
    assertEventId(input.eventId);
    if (
      !UUID_PATTERN.test(input.attemptId) ||
      !Number.isSafeInteger(input.expectedVersion) ||
      input.expectedVersion < 1 ||
      ![
        "provider_disconnected",
        "policy_blocked",
        "provider_rejected",
        "outcome_unknown",
        "accepted_pending_receipt",
      ].includes(input.status) ||
      (input.providerMessageId != null &&
        !validReference(
          input.providerMessageId,
          COMMUNICATION_BOUNDS.providerReference,
        )) ||
      (input.responseCode != null &&
        !validReference(
          input.responseCode,
          COMMUNICATION_BOUNDS.responseCode,
        )) ||
      !Number.isFinite(input.now.getTime())
    ) {
      throw new CommunicationError(
        "invalid_request",
        "Attempt settlement is invalid.",
      );
    }
    return db.transaction(
      async (tx) => {
        const loaded = await loadEvent(tx, input.scope, input.eventId, true);
        const current = loaded.event;
        assertVersion(current.version, input.expectedVersion);
        const attempt = current.attempts.at(-1);
        if (
          current.status !== "prepared" ||
          !attempt ||
          attempt.id !== input.attemptId ||
          attempt.status !== "prepared"
        ) {
          throw new CommunicationError(
            "policy_denied",
            "Prepared attempt fence is invalid.",
          );
        }
        const knownNotDelivered = [
          "provider_disconnected",
          "policy_blocked",
          "provider_rejected",
        ].includes(input.status);
        const canRetry =
          knownNotDelivered &&
          attempt.attemptNumber < current.maxAttempts &&
          input.now.getTime() + RETRY_DELAY_MS < Date.parse(current.deadlineAt);
        const nextAttemptAt = canRetry
          ? new Date(input.now.getTime() + RETRY_DELAY_MS)
          : null;
        const eventStatus: CommunicationEventStatus =
          input.status === "accepted_pending_receipt"
            ? "accepted_pending_receipt"
            : input.status === "outcome_unknown"
              ? "reconciliation_required"
              : canRetry
                ? "retry_wait"
                : "dead_letter";
        const [attemptRow] = await tx
          .update(notificationAttempts)
          .set({
            status: input.status,
            responseCode: input.responseCode ?? null,
            responseSummary: summary(input.providerMessageId ?? null, null),
            nextAttemptAt,
          })
          .where(
            and(
              eq(notificationAttempts.id, attempt.id),
              eq(
                notificationAttempts.organisationId,
                input.scope.organisationId,
              ),
              eq(notificationAttempts.notificationEventId, current.id),
              eq(notificationAttempts.status, "prepared"),
            ),
          )
          .returning();
        const [eventRow] = await tx
          .update(notificationEvents)
          .set({
            status: eventStatus,
            version: current.version + 1,
            updatedAt: input.now,
          })
          .where(
            and(
              eq(notificationEvents.id, current.id),
              eq(notificationEvents.organisationId, input.scope.organisationId),
              eq(notificationEvents.projectId, input.scope.projectId),
              eq(notificationEvents.version, current.version),
              eq(notificationEvents.status, "prepared"),
            ),
          )
          .returning();
        if (!attemptRow || !eventRow) {
          throw new CommunicationError(
            "stale_version",
            "Communication changed while settling delivery.",
          );
        }
        await writeAuditTx(tx, {
          user: await auditUser(tx, input.scope.actorUserId),
          organisationId: input.scope.organisationId,
          projectId: input.scope.projectId,
          eventType: "communications.attempt_settled",
          objectType: "notification_attempt",
          objectId: attempt.id,
          details: JSON.stringify({
            attemptNumber: attempt.attemptNumber,
            status: input.status,
            eventStatus,
            providerAccepted: input.status === "accepted_pending_receipt",
            deliveryClaimed: false,
          }),
        });
        return materialize(eventRow, [
          ...loaded.event.attempts.slice(0, -1).map((prior) => ({
            id: prior.id,
            organisationId: input.scope.organisationId,
            notificationEventId: current.id,
            attemptNumber: prior.attemptNumber,
            provider: prior.provider,
            idempotencyKey: prior.idempotencyKey,
            status: prior.status,
            responseCode: prior.responseCode,
            responseSummary: summary(
              prior.providerMessageId,
              prior.receiptSha256,
            ),
            nextAttemptAt: prior.nextAttemptAt
              ? new Date(prior.nextAttemptAt)
              : null,
            attemptedAt: new Date(prior.attemptedAt),
          })),
          attemptRow,
        ]);
      },
      { isolationLevel: "read committed" },
    );
  }

  async reconcileReceipt(input: {
    scope: CommunicationScope;
    eventId: string;
    attemptId: string;
    expectedVersion: number;
    outcome: "delivered" | "failed";
    providerMessageId?: string | null;
    receiptSha256: string;
    now: Date;
  }): Promise<CommunicationEvent> {
    assertScope(input.scope);
    assertEventId(input.eventId);
    if (
      !UUID_PATTERN.test(input.attemptId) ||
      !Number.isSafeInteger(input.expectedVersion) ||
      input.expectedVersion < 1 ||
      (input.outcome !== "delivered" && input.outcome !== "failed") ||
      !SHA256_PATTERN.test(input.receiptSha256) ||
      (input.providerMessageId != null &&
        !validReference(
          input.providerMessageId,
          COMMUNICATION_BOUNDS.providerReference,
        )) ||
      !Number.isFinite(input.now.getTime())
    ) {
      throw new CommunicationError(
        "invalid_request",
        "Receipt reconciliation is invalid.",
      );
    }
    return db.transaction(
      async (tx) => {
        const loaded = await loadEvent(tx, input.scope, input.eventId, true);
        const current = loaded.event;
        assertVersion(current.version, input.expectedVersion);
        const attempt = current.attempts.at(-1);
        if (
          !attempt ||
          attempt.id !== input.attemptId ||
          (attempt.status !== "accepted_pending_receipt" &&
            attempt.status !== "outcome_unknown")
        ) {
          throw new CommunicationError(
            "policy_denied",
            "Attempt is not awaiting receipt reconciliation.",
          );
        }
        if (
          attempt.providerMessageId != null &&
          input.providerMessageId != null &&
          attempt.providerMessageId !== input.providerMessageId
        ) {
          throw new CommunicationError(
            "policy_denied",
            "Receipt provider message does not match the attempt.",
          );
        }
        const failedCanRetry =
          input.outcome === "failed" &&
          attempt.attemptNumber < current.maxAttempts &&
          input.now.getTime() + RETRY_DELAY_MS < Date.parse(current.deadlineAt);
        const nextAttemptAt = failedCanRetry
          ? new Date(input.now.getTime() + RETRY_DELAY_MS)
          : null;
        const attemptStatus: CommunicationAttemptStatus =
          input.outcome === "delivered"
            ? "receipt_verified_delivered"
            : "receipt_verified_failed";
        const eventStatus: CommunicationEventStatus =
          input.outcome === "delivered"
            ? "delivered"
            : failedCanRetry
              ? "retry_wait"
              : "dead_letter";
        const [attemptRow] = await tx
          .update(notificationAttempts)
          .set({
            status: attemptStatus,
            responseCode:
              input.outcome === "delivered"
                ? "verified_delivered"
                : "verified_failed",
            responseSummary: summary(
              input.providerMessageId ?? attempt.providerMessageId,
              input.receiptSha256,
            ),
            nextAttemptAt,
          })
          .where(
            and(
              eq(notificationAttempts.id, attempt.id),
              eq(
                notificationAttempts.organisationId,
                input.scope.organisationId,
              ),
              eq(notificationAttempts.notificationEventId, current.id),
              eq(notificationAttempts.status, attempt.status),
            ),
          )
          .returning();
        const [eventRow] = await tx
          .update(notificationEvents)
          .set({
            status: eventStatus,
            version: current.version + 1,
            updatedAt: input.now,
          })
          .where(
            and(
              eq(notificationEvents.id, current.id),
              eq(notificationEvents.organisationId, input.scope.organisationId),
              eq(notificationEvents.projectId, input.scope.projectId),
              eq(notificationEvents.version, current.version),
              eq(notificationEvents.status, current.status),
            ),
          )
          .returning();
        if (!attemptRow || !eventRow) {
          throw new CommunicationError(
            "stale_version",
            "Communication changed during reconciliation.",
          );
        }
        await writeAuditTx(tx, {
          user: await auditUser(tx, input.scope.actorUserId),
          organisationId: input.scope.organisationId,
          projectId: input.scope.projectId,
          eventType: "communications.receipt_reconciled",
          objectType: "notification_attempt",
          objectId: attempt.id,
          details: JSON.stringify({
            attemptNumber: attempt.attemptNumber,
            outcome: input.outcome,
            eventStatus,
            deliveryClaimed: input.outcome === "delivered",
            deliveryAuthority: "verified_provider_receipt_only",
          }),
        });
        return materialize(eventRow, [
          ...loaded.event.attempts.slice(0, -1).map((prior) => ({
            id: prior.id,
            organisationId: input.scope.organisationId,
            notificationEventId: current.id,
            attemptNumber: prior.attemptNumber,
            provider: prior.provider,
            idempotencyKey: prior.idempotencyKey,
            status: prior.status,
            responseCode: prior.responseCode,
            responseSummary: summary(
              prior.providerMessageId,
              prior.receiptSha256,
            ),
            nextAttemptAt: prior.nextAttemptAt
              ? new Date(prior.nextAttemptAt)
              : null,
            attemptedAt: new Date(prior.attemptedAt),
          })),
          attemptRow,
        ]);
      },
      { isolationLevel: "read committed" },
    );
  }
}

async function assertDirectNamedHuman(
  scope: CommunicationScope,
  userId: string,
): Promise<void> {
  assertScope(scope);
  if (!UUID_PATTERN.test(userId)) denied("Named participant access denied.");
  const rows = await db
    .select({
      membershipStatus: organisationMemberships.status,
      accessStartsAt: organisationMemberships.accessStartsAt,
      accessExpiresAt: organisationMemberships.accessExpiresAt,
      userStatus: users.status,
    })
    .from(organisationMemberships)
    .innerJoin(users, eq(users.id, organisationMemberships.userId))
    .where(
      and(
        eq(organisationMemberships.organisationId, scope.organisationId),
        eq(organisationMemberships.userId, userId),
        eq(organisationMemberships.status, "active"),
        isNull(organisationMemberships.delegatedByMembershipId),
        eq(users.status, "active"),
      ),
    )
    .limit(2);
  const participant = rows.length === 1 ? rows[0] : null;
  const now = Date.now();
  if (
    !participant ||
    (participant.accessStartsAt &&
      participant.accessStartsAt.getTime() > now) ||
    (participant.accessExpiresAt &&
      participant.accessExpiresAt.getTime() <= now)
  ) {
    denied("Named participant access denied.");
  }
}

function clientActionRecord(
  raw: string | null,
): Record<string, unknown> | null {
  if (!raw || Buffer.byteLength(raw, "utf8") > 256_000) return null;
  try {
    const envelope = plain(JSON.parse(raw));
    return envelope?.schema === "valo.client-action-portal/v1"
      ? plain(envelope.record)
      : null;
  } catch {
    return null;
  }
}

function correctionCount(record: Record<string, unknown>): number {
  const slots = Array.isArray(record.slots) ? record.slots : [];
  let count = 0;
  for (const slotValue of slots) {
    const slot = plain(slotValue);
    const attempts = Array.isArray(slot?.attempts) ? slot.attempts : [];
    for (const attemptValue of attempts) {
      const review = plain(plain(attemptValue)?.review);
      if (review?.decision === "correction_required") count += 1;
    }
  }
  return count;
}

function safeReferenceName(value: string | null): string | null {
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    value.length < 1 ||
    value.length > 512 ||
    /[\p{Cc}\p{Cf}\p{Cs}]/u.test(value) ||
    !/[^\s\p{Cf}]/u.test(value)
  ) {
    return null;
  }
  return value;
}

/**
 * Produces a bounded, PII-minimised chooser model. The response contains only
 * named active members with current email consent and canonical project
 * references that the queue authority will independently revalidate.
 */
export async function loadDbCommunicationReferences(
  scope: CommunicationScope,
): Promise<CommunicationReferenceSet> {
  assertScope(scope);
  await assertDirectNamedHuman(scope, scope.actorUserId);
  const [project] = await db
    .select({ id: projects.id, deadline: projects.deadline })
    .from(projects)
    .where(
      and(
        eq(projects.id, scope.projectId),
        eq(projects.organisationId, scope.organisationId),
      ),
    )
    .limit(1);
  if (!project) denied("Project access denied.");

  const members = await db
    .select({
      userId: users.id,
      name: users.name,
      accessStartsAt: organisationMemberships.accessStartsAt,
      accessExpiresAt: organisationMemberships.accessExpiresAt,
    })
    .from(organisationMemberships)
    .innerJoin(users, eq(users.id, organisationMemberships.userId))
    .where(
      and(
        eq(organisationMemberships.organisationId, scope.organisationId),
        eq(organisationMemberships.status, "active"),
        isNull(organisationMemberships.delegatedByMembershipId),
        eq(users.status, "active"),
      ),
    )
    .orderBy(asc(users.name), asc(users.id))
    .limit(COMMUNICATION_BOUNDS.referenceItems + 1);
  const now = Date.now();
  const eligibleMembers = members
    .filter(
      (member) =>
        (!member.accessStartsAt || member.accessStartsAt.getTime() <= now) &&
        (!member.accessExpiresAt || member.accessExpiresAt.getTime() > now) &&
        safeReferenceName(member.name),
    )
    .slice(0, COMMUNICATION_BOUNDS.referenceItems);
  const subjectReferences = eligibleMembers.map(
    (member) => `user:${member.userId}`,
  );
  const consentRows =
    subjectReferences.length === 0
      ? []
      : await db
          .select({
            subjectReference: consentRecords.subjectReference,
            evidenceHash: consentRecords.evidenceHash,
            capturedAt: consentRecords.capturedAt,
          })
          .from(consentRecords)
          .where(
            and(
              eq(consentRecords.organisationId, scope.organisationId),
              inArray(consentRecords.subjectReference, subjectReferences),
              eq(consentRecords.purpose, "notification:email"),
              isNull(consentRecords.withdrawnAt),
            ),
          )
          .orderBy(desc(consentRecords.capturedAt), desc(consentRecords.id))
          .limit(1_001);
  if (consentRows.length > 1_000) {
    throw new CommunicationError(
      "capacity_exceeded",
      "Communication consent references exceed the safe bound.",
    );
  }
  const newestConsent = new Map<string, string>();
  for (const consent of consentRows) {
    if (
      !newestConsent.has(consent.subjectReference) &&
      SHA256_PATTERN.test(consent.evidenceHash)
    ) {
      newestConsent.set(consent.subjectReference, consent.evidenceHash);
    }
  }
  const recipients = eligibleMembers.flatMap((member) => {
    const consentEvidenceSha256 = newestConsent.get(`user:${member.userId}`);
    const name = safeReferenceName(member.name);
    return consentEvidenceSha256 && name
      ? [
          {
            userId: member.userId,
            name,
            channel: "email" as const,
            consentEvidenceSha256,
          },
        ]
      : [];
  });

  const [requestRows, packageRows] = await Promise.all([
    db
      .select({ id: workTasks.id, description: workTasks.description })
      .from(workTasks)
      .where(
        and(
          eq(workTasks.organisationId, scope.organisationId),
          eq(workTasks.projectId, scope.projectId),
          like(workTasks.title, `${CLIENT_ACTION_TITLE_PREFIX}%`),
          sql`octet_length(coalesce(${workTasks.description}, '')) <= 256000`,
        ),
      )
      .orderBy(desc(workTasks.updatedAt), desc(workTasks.id))
      .limit(COMMUNICATION_BOUNDS.referenceItems + 1),
    db
      .select({
        packageVersionId: packageVersions.id,
        manifestHash: packageVersions.manifestHash,
        versionNumber: packageVersions.versionNumber,
        currentVersionNumber: packages.currentVersionNumber,
        renderQaStatus: packageVersions.renderQaStatus,
        projectStatus: projects.status,
        deliveryStatus: exportDeliveries.status,
        deliveryReceiptHash: exportDeliveries.deliveryReceiptHash,
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
          eq(exportDeliveries.status, "delivered"),
        ),
      )
      .where(
        and(
          eq(packageVersions.organisationId, scope.organisationId),
          eq(packages.projectId, scope.projectId),
          eq(packageVersions.renderQaStatus, "passed"),
          eq(projects.status, "exported"),
        ),
      )
      .orderBy(desc(packageVersions.createdAt), desc(packageVersions.id))
      .limit(COMMUNICATION_BOUNDS.referenceItems + 1),
  ]);

  const contexts: CommunicationReferenceSet["contexts"] = [];
  if (project.deadline && Number.isFinite(Date.parse(project.deadline))) {
    contexts.push({
      id: `deadline:${project.id}`,
      recipientUserId: null,
      label: "Canonical pursuit deadline",
      templateId: "deadline_reminder_v1",
      context: {
        kind: "deadline",
        deadlineAt: new Date(project.deadline).toISOString(),
      },
    });
  }
  for (const row of requestRows) {
    const record = clientActionRecord(row.description);
    if (
      !record ||
      record.kind !== "evidence_request" ||
      record.id !== row.id ||
      !UUID_PATTERN.test(String(record.recipientUserId))
    ) {
      continue;
    }
    const dueAt =
      record.dueAt === null || record.dueAt === undefined
        ? null
        : Number.isFinite(Date.parse(String(record.dueAt)))
          ? new Date(String(record.dueAt)).toISOString()
          : null;
    const corrections = correctionCount(record);
    if (record.status === "changes_required" && corrections >= 1) {
      contexts.push({
        id: `evidence-correction:${row.id}:${corrections}`,
        recipientUserId: String(record.recipientUserId),
        label: `Evidence correction ${corrections}`,
        templateId: "evidence_correction_required_v1",
        context: {
          kind: "evidence_correction",
          requestId: row.id,
          correctionSequence: corrections,
        },
      });
    } else if (
      record.status === "open" ||
      record.status === "acknowledged" ||
      record.status === "in_progress"
    ) {
      contexts.push({
        id: `evidence-request:${row.id}`,
        recipientUserId: String(record.recipientUserId),
        label: dueAt ? "Evidence request with due date" : "Evidence request",
        templateId: "evidence_request_ready_v1",
        context: { kind: "evidence_request", requestId: row.id, dueAt },
      });
    }
  }
  const seenPackageVersions = new Set<string>();
  for (const row of packageRows) {
    if (
      seenPackageVersions.has(row.packageVersionId) ||
      row.versionNumber !== row.currentVersionNumber ||
      !row.deliveryReceiptHash ||
      row.deliveryStatus !== "delivered" ||
      !SHA256_PATTERN.test(row.manifestHash)
    ) {
      continue;
    }
    seenPackageVersions.add(row.packageVersionId);
    contexts.push({
      id: `package:${row.packageVersionId}`,
      recipientUserId: null,
      label: `Released package version ${row.versionNumber}`,
      templateId: "package_ready_v1",
      context: {
        kind: "released_package",
        packageVersionId: row.packageVersionId,
        manifestSha256: row.manifestHash,
      },
    });
  }
  const truncated =
    members.length > COMMUNICATION_BOUNDS.referenceItems ||
    requestRows.length > COMMUNICATION_BOUNDS.referenceItems ||
    packageRows.length > COMMUNICATION_BOUNDS.referenceItems ||
    contexts.length > COMMUNICATION_BOUNDS.referenceItems;
  return {
    organisationId: scope.organisationId,
    projectId: scope.projectId,
    recipients,
    contexts: contexts.slice(0, COMMUNICATION_BOUNDS.referenceItems),
    limit: 100,
    truncated,
  };
}

export function createDbCommunicationAuthority(): CommunicationAuthority {
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
      await assertDirectNamedHuman(scope, userId);
    },

    async resolveRecipient(scope, input) {
      await assertDirectNamedHuman(scope, input.recipientUserId);
      if (!SHA256_PATTERN.test(input.consentEvidenceSha256)) {
        denied("Notification consent denied.");
      }
      const consent = await db
        .select({ id: consentRecords.id })
        .from(consentRecords)
        .where(
          and(
            eq(consentRecords.organisationId, scope.organisationId),
            eq(
              consentRecords.subjectReference,
              `user:${input.recipientUserId}`,
            ),
            eq(consentRecords.purpose, `notification:${input.channel}`),
            eq(consentRecords.evidenceHash, input.consentEvidenceSha256),
            isNull(consentRecords.withdrawnAt),
          ),
        )
        .orderBy(desc(consentRecords.capturedAt))
        .limit(1);
      if (!consent[0])
        denied("Active purpose-bound notification consent is required.");
      if (input.channel !== "email") {
        throw new CommunicationError(
          "policy_denied",
          "This channel has no approved subject-bound contact registry.",
        );
      }
      const [recipient] = await db
        .select({ email: users.email })
        .from(users)
        .where(
          and(eq(users.id, input.recipientUserId), eq(users.status, "active")),
        )
        .limit(1);
      const email = recipient?.email.trim();
      if (
        !email ||
        email.length > 254 ||
        /[\u0000-\u0020\u007f]/u.test(email) ||
        !/^[^@]+@[^@]+$/u.test(email)
      ) {
        denied("Approved recipient address is unavailable.");
      }
      return { recipient: email };
    },

    async assertTemplateContext(scope, input) {
      assertScope(scope);
      if (input.context.kind === "deadline") {
        const [project] = await db
          .select({ deadline: projects.deadline })
          .from(projects)
          .where(
            and(
              eq(projects.id, scope.projectId),
              eq(projects.organisationId, scope.organisationId),
            ),
          )
          .limit(1);
        if (
          !project?.deadline ||
          !Number.isFinite(Date.parse(project.deadline)) ||
          Date.parse(project.deadline) !== Date.parse(input.context.deadlineAt)
        ) {
          denied("Canonical deadline context denied.");
        }
        return;
      }
      if (
        input.context.kind === "evidence_request" ||
        input.context.kind === "evidence_correction"
      ) {
        const [task] = await db
          .select({
            description: workTasks.description,
            title: workTasks.title,
          })
          .from(workTasks)
          .where(
            and(
              eq(workTasks.id, input.context.requestId),
              eq(workTasks.organisationId, scope.organisationId),
              eq(workTasks.projectId, scope.projectId),
              like(workTasks.title, `${CLIENT_ACTION_TITLE_PREFIX}%`),
            ),
          )
          .limit(1);
        const record = clientActionRecord(task?.description ?? null);
        if (
          !record ||
          record.kind !== "evidence_request" ||
          record.id !== input.context.requestId ||
          record.recipientUserId !== input.recipientUserId
        ) {
          denied("Canonical evidence-request context denied.");
        }
        if (input.context.kind === "evidence_request") {
          const dueAt = record.dueAt;
          if (
            !["open", "acknowledged", "in_progress"].includes(
              String(record.status),
            ) ||
            (dueAt === null ? null : Date.parse(String(dueAt))) !==
              (input.context.dueAt === null
                ? null
                : Date.parse(input.context.dueAt))
          ) {
            denied("Canonical evidence-request due date denied.");
          }
        } else if (
          record.status !== "changes_required" ||
          correctionCount(record) !== input.context.correctionSequence
        ) {
          denied("Canonical correction sequence denied.");
        }
        return;
      }
      const rows = await db
        .select({
          manifestHash: packageVersions.manifestHash,
          versionNumber: packageVersions.versionNumber,
          currentVersionNumber: packages.currentVersionNumber,
          renderQaStatus: packageVersions.renderQaStatus,
          projectStatus: projects.status,
          deliveryStatus: exportDeliveries.status,
          deliveryReceiptHash: exportDeliveries.deliveryReceiptHash,
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
            eq(exportDeliveries.status, "delivered"),
          ),
        )
        .where(
          and(
            eq(packageVersions.id, input.context.packageVersionId),
            eq(packageVersions.organisationId, scope.organisationId),
            eq(packages.projectId, scope.projectId),
            eq(packageVersions.manifestHash, input.context.manifestSha256),
            eq(packageVersions.renderQaStatus, "passed"),
            eq(projects.status, "exported"),
          ),
        )
        .limit(2);
      const released = rows.length === 1 ? rows[0] : null;
      if (
        !released ||
        released.versionNumber !== released.currentVersionNumber ||
        released.manifestHash !== input.context.manifestSha256 ||
        released.deliveryStatus !== "delivered" ||
        !released.deliveryReceiptHash
      ) {
        denied("Released package context denied.");
      }
    },
  };
}
