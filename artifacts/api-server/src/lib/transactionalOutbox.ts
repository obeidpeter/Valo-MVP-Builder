import { createHash } from "node:crypto";
import { notificationAttempts, notificationEvents } from "@workspace/db/schema";
import { and, desc, eq, isNull } from "drizzle-orm";

export const TRANSACTIONAL_OUTBOX_TEMPLATE = "valo.transactional-outbox.v1";
export const TRANSACTIONAL_OUTBOX_CHANNEL = "internal_outbox";
export const DISCONNECTED_OUTBOX_PROVIDER = "external-disconnected";

/**
 * First-wave safety boundary. Outbox rows and delivery-attempt evidence are
 * durable, but no provider adapter is connected and no method in this module
 * can claim that an external effect happened.
 */
export const TRANSACTIONAL_OUTBOX_STATUS = Object.freeze({
  persistenceImplemented: true,
  providerInvocationAllowed: false,
  trustedReceiptVerificationImplemented: false,
  arbitraryPayloadPersistenceImplemented: false,
  activation: "blocked" as const,
});

export type TransactionalOutboxEvent = typeof notificationEvents.$inferSelect;
export type TransactionalOutboxAttempt =
  typeof notificationAttempts.$inferSelect;
export type TransactionalOutboxStatus =
  | "queued"
  | "dispatching"
  | "retry_wait"
  | "reconciliation_required"
  | "reconciling"
  | "dead_letter"
  | "cancelled";

export interface OutboxScope {
  organisationId: string;
  projectId?: string | null;
}

/**
 * The current schema has no encrypted payload/blob reference owned by a job.
 * Consequently, this envelope deliberately persists only a digest and an
 * opaque, non-secret reference. Callers must keep effect payloads elsewhere.
 */
export interface TransactionalOutboxIntent extends OutboxScope {
  eventName: string;
  aggregateType: string;
  aggregateId: string;
  idempotencyDigest: string;
  payloadHash: string;
  payloadRef?: string | null;
  maxAttempts?: number;
  availableAt?: Date;
  deadlineAt: Date;
  createdBy?: string | null;
}

interface OutboxEnvelopeV1 {
  schemaVersion: typeof TRANSACTIONAL_OUTBOX_TEMPLATE;
  eventName: string;
  aggregateType: string;
  aggregateId: string;
  idempotencyDigest: string;
  payloadHash: string;
  payloadRef: string | null;
  maxAttempts: number;
  availableAt: string;
  deadlineAt: string;
}

export type TransactionalOutboxErrorCode =
  | "invalid_scope"
  | "invalid_input"
  | "not_found_or_not_authorized"
  | "not_outbox_record"
  | "invalid_transition"
  | "stale_fence"
  | "lease_not_expired"
  | "not_due"
  | "deadline_exceeded"
  | "persistence_conflict"
  | "provider_disconnected";

export class TransactionalOutboxError extends Error {
  constructor(readonly code: TransactionalOutboxErrorCode) {
    super(code);
    this.name = "TransactionalOutboxError";
  }
}

export interface PreparedOutboxDelivery {
  event: TransactionalOutboxEvent;
  attempt: TransactionalOutboxAttempt;
  /** Event version after prepare; required by every subsequent transition. */
  fenceToken: number;
  providerInvocationAllowed: false;
}

export interface TransactionalOutboxRepository {
  enqueue(
    intent: TransactionalOutboxIntent,
    now: Date,
  ): Promise<TransactionalOutboxEvent>;
  prepare(input: {
    scope: OutboxScope;
    eventId: string;
    expectedFence: number;
    workerId: string;
    leaseMs: number;
    now: Date;
  }): Promise<PreparedOutboxDelivery>;
  blockPrepared(input: {
    scope: OutboxScope;
    eventId: string;
    attemptId: string;
    expectedFence: number;
    workerId: string;
    disposition: "known_not_delivered" | "outcome_unknown";
    now: Date;
  }): Promise<TransactionalOutboxEvent>;
  claimReconciliation(input: {
    scope: OutboxScope;
    eventId: string;
    expectedFence: number;
    workerId: string;
    now: Date;
  }): Promise<TransactionalOutboxEvent>;
  resolveReconciliation(input: {
    scope: OutboxScope;
    eventId: string;
    expectedFence: number;
    workerId: string;
    outcome: "known_not_delivered" | "still_unknown";
    now: Date;
  }): Promise<TransactionalOutboxEvent>;
  recoverExpired(input: {
    scope: OutboxScope;
    eventId: string;
    expectedFence: number;
    now: Date;
  }): Promise<TransactionalOutboxEvent>;
}

type OutboxDatabase = (typeof import("@workspace/db"))["db"];
type OutboxTx = Parameters<Parameters<OutboxDatabase["transaction"]>[0]>[0];

async function appendAuditTx(
  tx: OutboxTx,
  params: import("./audit").AuditParams,
): Promise<void> {
  const { writeAuditTx } = await import("./audit");
  await writeAuditTx(tx, params);
}

import {
  SHA256_HEX_PATTERN as SHA256,
  UUID_V1_5_PATTERN as UUID,
} from "./identifierPatterns";
const CONTROL = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
const RECONCILIATION_LEASE_MS = 30_000;

function boundedInteger(
  value: unknown,
  min: number,
  max: number,
): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= min &&
    value <= max
  );
}

function validDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function assertScope(scope: OutboxScope): void {
  if (
    !UUID.test(scope.organisationId) ||
    (scope.projectId != null && !UUID.test(scope.projectId))
  ) {
    throw new TransactionalOutboxError("invalid_scope");
  }
}

function projectPredicate(projectId: string | null | undefined) {
  if (projectId === undefined) return undefined;
  return projectId === null
    ? isNull(notificationEvents.projectId)
    : eq(notificationEvents.projectId, projectId);
}

import { deterministicUuidFromBytes as deterministicUuid } from "./deterministicUuid";

function outboxEventId(intent: TransactionalOutboxIntent): string {
  return deterministicUuid(
    [
      TRANSACTIONAL_OUTBOX_TEMPLATE,
      intent.organisationId,
      intent.projectId ?? "-",
      intent.eventName,
      intent.aggregateType,
      intent.aggregateId,
      intent.idempotencyDigest,
    ].join("\0"),
  );
}

function attemptIdempotencyKey(eventId: string, attemptNumber: number): string {
  return createHash("sha256")
    .update(`${TRANSACTIONAL_OUTBOX_TEMPLATE}\0${eventId}\0${attemptNumber}`)
    .digest("hex");
}

function assertIntent(
  intent: TransactionalOutboxIntent,
  now: Date,
  enforceNewSchedule = true,
): OutboxEnvelopeV1 {
  assertScope(intent);
  const maxAttempts = intent.maxAttempts ?? 5;
  const availableAt =
    intent.availableAt ??
    (enforceNewSchedule
      ? now
      : new Date(Math.min(now.getTime(), intent.deadlineAt.getTime() - 1)));
  if (
    !CONTROL.test(intent.eventName) ||
    !CONTROL.test(intent.aggregateType) ||
    !REFERENCE.test(intent.aggregateId) ||
    !SHA256.test(intent.idempotencyDigest) ||
    !SHA256.test(intent.payloadHash) ||
    (intent.payloadRef != null && !REFERENCE.test(intent.payloadRef)) ||
    !boundedInteger(maxAttempts, 1, 10) ||
    !validDate(availableAt) ||
    !validDate(intent.deadlineAt) ||
    intent.deadlineAt.getTime() <= availableAt.getTime() ||
    (enforceNewSchedule && availableAt.getTime() < now.getTime() - 60_000) ||
    (enforceNewSchedule && intent.deadlineAt.getTime() <= now.getTime()) ||
    (enforceNewSchedule &&
      intent.deadlineAt.getTime() > now.getTime() + 30 * 24 * 60 * 60_000) ||
    (intent.createdBy != null && !UUID.test(intent.createdBy))
  ) {
    throw new TransactionalOutboxError("invalid_input");
  }
  return {
    schemaVersion: TRANSACTIONAL_OUTBOX_TEMPLATE,
    eventName: intent.eventName,
    aggregateType: intent.aggregateType,
    aggregateId: intent.aggregateId,
    idempotencyDigest: intent.idempotencyDigest,
    payloadHash: intent.payloadHash,
    payloadRef: intent.payloadRef ?? null,
    maxAttempts,
    availableAt: availableAt.toISOString(),
    deadlineAt: intent.deadlineAt.toISOString(),
  };
}

function matchesIntent(
  event: TransactionalOutboxEvent,
  intent: TransactionalOutboxIntent,
  expected: OutboxEnvelopeV1,
): boolean {
  if (
    event.organisationId !== intent.organisationId ||
    event.projectId !== (intent.projectId ?? null)
  ) {
    return false;
  }
  let stored: OutboxEnvelopeV1;
  try {
    stored = parseEnvelope(event);
  } catch {
    return false;
  }
  return (
    stored.eventName === expected.eventName &&
    stored.aggregateType === expected.aggregateType &&
    stored.aggregateId === expected.aggregateId &&
    stored.idempotencyDigest === expected.idempotencyDigest &&
    stored.payloadHash === expected.payloadHash &&
    stored.payloadRef === expected.payloadRef &&
    stored.maxAttempts === expected.maxAttempts &&
    stored.deadlineAt === expected.deadlineAt
  );
}

function parseEnvelope(event: TransactionalOutboxEvent): OutboxEnvelopeV1 {
  if (
    event.channel !== TRANSACTIONAL_OUTBOX_CHANNEL ||
    event.template !== TRANSACTIONAL_OUTBOX_TEMPLATE ||
    event.organisationId == null ||
    event.payload == null
  ) {
    throw new TransactionalOutboxError("not_outbox_record");
  }
  let value: unknown;
  try {
    value = JSON.parse(event.payload);
  } catch {
    throw new TransactionalOutboxError("not_outbox_record");
  }
  if (typeof value !== "object" || value == null) {
    throw new TransactionalOutboxError("not_outbox_record");
  }
  const envelope = value as Partial<OutboxEnvelopeV1>;
  if (
    envelope.schemaVersion !== TRANSACTIONAL_OUTBOX_TEMPLATE ||
    typeof envelope.eventName !== "string" ||
    !CONTROL.test(envelope.eventName) ||
    typeof envelope.aggregateType !== "string" ||
    !CONTROL.test(envelope.aggregateType) ||
    typeof envelope.aggregateId !== "string" ||
    !REFERENCE.test(envelope.aggregateId) ||
    typeof envelope.idempotencyDigest !== "string" ||
    !SHA256.test(envelope.idempotencyDigest) ||
    typeof envelope.payloadHash !== "string" ||
    !SHA256.test(envelope.payloadHash) ||
    (envelope.payloadRef != null &&
      (typeof envelope.payloadRef !== "string" ||
        !REFERENCE.test(envelope.payloadRef))) ||
    typeof envelope.availableAt !== "string" ||
    typeof envelope.deadlineAt !== "string" ||
    !Number.isFinite(Date.parse(envelope.availableAt)) ||
    !Number.isFinite(Date.parse(envelope.deadlineAt)) ||
    Date.parse(envelope.deadlineAt) <= Date.parse(envelope.availableAt) ||
    !boundedInteger(envelope.maxAttempts, 1, 10)
  ) {
    throw new TransactionalOutboxError("not_outbox_record");
  }
  return envelope as OutboxEnvelopeV1;
}

function assertControlInput(input: {
  eventId: string;
  expectedFence: number;
  workerId: string;
}): void {
  if (
    !UUID.test(input.eventId) ||
    !boundedInteger(input.expectedFence, 1, Number.MAX_SAFE_INTEGER) ||
    !CONTROL.test(input.workerId)
  ) {
    throw new TransactionalOutboxError("invalid_input");
  }
}

/**
 * Append an idempotent outbox record inside the caller's transaction. This is
 * the integration point for domain mutations: commit of the mutation, outbox
 * row, and audit event is all-or-nothing.
 */
export async function appendTransactionalOutboxTx(
  tx: OutboxTx,
  intent: TransactionalOutboxIntent,
  now: Date,
): Promise<TransactionalOutboxEvent> {
  const replayEnvelope = assertIntent(intent, now, false);
  const id = outboxEventId(intent);
  const [replay] = await tx
    .select()
    .from(notificationEvents)
    .where(
      and(
        eq(notificationEvents.id, id),
        eq(notificationEvents.organisationId, intent.organisationId),
      ),
    );
  if (replay) {
    if (!matchesIntent(replay, intent, replayEnvelope)) {
      throw new TransactionalOutboxError("persistence_conflict");
    }
    return replay;
  }
  const envelope = assertIntent(intent, now);
  const payload = JSON.stringify(envelope);
  const [inserted] = await tx
    .insert(notificationEvents)
    .values({
      id,
      organisationId: intent.organisationId,
      projectId: intent.projectId ?? null,
      channel: TRANSACTIONAL_OUTBOX_CHANNEL,
      template: TRANSACTIONAL_OUTBOX_TEMPLATE,
      recipient: null,
      payload,
      status: "queued",
      createdBy: intent.createdBy ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning();
  if (inserted) {
    await appendAuditTx(tx, {
      organisationId: intent.organisationId,
      projectId: intent.projectId ?? null,
      eventType: "outbox.enqueued",
      objectType: "notification_event",
      objectId: inserted.id,
      details: JSON.stringify({
        schemaVersion: TRANSACTIONAL_OUTBOX_TEMPLATE,
        eventName: envelope.eventName,
        aggregateType: envelope.aggregateType,
      }),
    });
    return inserted;
  }
  const [existing] = await tx
    .select()
    .from(notificationEvents)
    .where(
      and(
        eq(notificationEvents.id, id),
        eq(notificationEvents.organisationId, intent.organisationId),
        projectPredicate(intent.projectId),
      ),
    );
  if (!existing || !matchesIntent(existing, intent, envelope)) {
    throw new TransactionalOutboxError("persistence_conflict");
  }
  return existing;
}

export class DrizzleTransactionalOutboxRepository implements TransactionalOutboxRepository {
  async enqueue(
    intent: TransactionalOutboxIntent,
    now: Date,
  ): Promise<TransactionalOutboxEvent> {
    const database = (await import("@workspace/db")).db;
    return database.transaction(
      (tx) => appendTransactionalOutboxTx(tx, intent, now),
      { isolationLevel: "read committed" },
    );
  }

  async prepare(input: {
    scope: OutboxScope;
    eventId: string;
    expectedFence: number;
    workerId: string;
    leaseMs: number;
    now: Date;
  }): Promise<PreparedOutboxDelivery> {
    assertScope(input.scope);
    assertControlInput(input);
    if (
      !boundedInteger(input.leaseMs, 5_000, 300_000) ||
      !validDate(input.now)
    ) {
      throw new TransactionalOutboxError("invalid_input");
    }
    const database = (await import("@workspace/db")).db;
    return database.transaction(
      async (tx) => {
        const [event] = await tx
          .select()
          .from(notificationEvents)
          .where(
            and(
              eq(notificationEvents.id, input.eventId),
              eq(notificationEvents.organisationId, input.scope.organisationId),
              projectPredicate(input.scope.projectId),
            ),
          )
          .for("update");
        if (!event) {
          throw new TransactionalOutboxError("not_found_or_not_authorized");
        }
        const envelope = parseEnvelope(event);
        if (event.version !== input.expectedFence) {
          throw new TransactionalOutboxError("stale_fence");
        }
        if (event.status !== "queued" && event.status !== "retry_wait") {
          throw new TransactionalOutboxError("invalid_transition");
        }
        if (Date.parse(envelope.availableAt) > input.now.getTime()) {
          throw new TransactionalOutboxError("not_due");
        }
        if (Date.parse(envelope.deadlineAt) <= input.now.getTime()) {
          throw new TransactionalOutboxError("deadline_exceeded");
        }
        const [previous] = await tx
          .select({ attemptNumber: notificationAttempts.attemptNumber })
          .from(notificationAttempts)
          .where(
            and(
              eq(
                notificationAttempts.organisationId,
                input.scope.organisationId,
              ),
              eq(notificationAttempts.notificationEventId, event.id),
            ),
          )
          .orderBy(desc(notificationAttempts.attemptNumber))
          .limit(1);
        const attemptNumber = (previous?.attemptNumber ?? 0) + 1;
        if (attemptNumber > envelope.maxAttempts) {
          throw new TransactionalOutboxError("invalid_transition");
        }
        const fenceToken = event.version + 1;
        const leaseExpiresAt = new Date(
          Math.min(
            input.now.getTime() + input.leaseMs,
            Date.parse(envelope.deadlineAt),
          ),
        );
        const [attempt] = await tx
          .insert(notificationAttempts)
          .values({
            organisationId: input.scope.organisationId,
            notificationEventId: event.id,
            attemptNumber,
            provider: DISCONNECTED_OUTBOX_PROVIDER,
            idempotencyKey: attemptIdempotencyKey(event.id, attemptNumber),
            status: "prepared",
            responseCode: null,
            responseSummary: JSON.stringify({
              schemaVersion: "valo.outbox-attempt-control.v1",
              workerId: input.workerId,
              fenceToken,
            }),
            nextAttemptAt: leaseExpiresAt,
            attemptedAt: input.now,
          })
          .returning();
        const [updated] = await tx
          .update(notificationEvents)
          .set({
            status: "dispatching",
            version: fenceToken,
            updatedAt: input.now,
          })
          .where(
            and(
              eq(notificationEvents.id, event.id),
              eq(notificationEvents.version, event.version),
            ),
          )
          .returning();
        if (!attempt || !updated) {
          throw new TransactionalOutboxError("persistence_conflict");
        }
        await appendAuditTx(tx, {
          organisationId: input.scope.organisationId,
          projectId: event.projectId,
          eventType: "outbox.attempt_prepared",
          objectType: "notification_attempt",
          objectId: attempt.id,
          details: JSON.stringify({ attemptNumber, providerConnected: false }),
        });
        return {
          event: updated,
          attempt,
          fenceToken,
          providerInvocationAllowed: false as const,
        };
      },
      { isolationLevel: "read committed" },
    );
  }

  async blockPrepared(input: {
    scope: OutboxScope;
    eventId: string;
    attemptId: string;
    expectedFence: number;
    workerId: string;
    disposition: "known_not_delivered" | "outcome_unknown";
    now: Date;
  }): Promise<TransactionalOutboxEvent> {
    assertScope(input.scope);
    assertControlInput(input);
    if (!UUID.test(input.attemptId) || !validDate(input.now)) {
      throw new TransactionalOutboxError("invalid_input");
    }
    const database = (await import("@workspace/db")).db;
    return database.transaction(
      async (tx) => {
        const [event] = await tx
          .select()
          .from(notificationEvents)
          .where(
            and(
              eq(notificationEvents.id, input.eventId),
              eq(notificationEvents.organisationId, input.scope.organisationId),
              projectPredicate(input.scope.projectId),
            ),
          )
          .for("update");
        if (!event)
          throw new TransactionalOutboxError("not_found_or_not_authorized");
        const envelope = parseEnvelope(event);
        if (event.version !== input.expectedFence) {
          throw new TransactionalOutboxError("stale_fence");
        }
        if (event.status !== "dispatching") {
          throw new TransactionalOutboxError("invalid_transition");
        }
        const [attempt] = await tx
          .select()
          .from(notificationAttempts)
          .where(
            and(
              eq(notificationAttempts.id, input.attemptId),
              eq(
                notificationAttempts.organisationId,
                input.scope.organisationId,
              ),
              eq(notificationAttempts.notificationEventId, event.id),
              eq(notificationAttempts.status, "prepared"),
            ),
          )
          .for("update");
        if (!attempt)
          throw new TransactionalOutboxError("persistence_conflict");
        let control: { workerId?: unknown; fenceToken?: unknown } = {};
        try {
          control = JSON.parse(
            attempt.responseSummary ?? "{}",
          ) as typeof control;
        } catch {
          throw new TransactionalOutboxError("persistence_conflict");
        }
        if (
          control.workerId !== input.workerId ||
          control.fenceToken !== input.expectedFence
        ) {
          throw new TransactionalOutboxError("stale_fence");
        }
        const exhausted = attempt.attemptNumber >= envelope.maxAttempts;
        const deadlineExceeded =
          Date.parse(envelope.deadlineAt) <= input.now.getTime();
        const nextStatus: TransactionalOutboxStatus =
          input.disposition === "outcome_unknown"
            ? "reconciliation_required"
            : exhausted || deadlineExceeded
              ? "dead_letter"
              : "retry_wait";
        const nextAttemptAt =
          nextStatus === "retry_wait"
            ? new Date(
                input.now.getTime() +
                  Math.min(300_000, 5_000 * 2 ** (attempt.attemptNumber - 1)),
              )
            : null;
        await tx
          .update(notificationAttempts)
          .set({
            status:
              input.disposition === "outcome_unknown"
                ? "outcome_unknown"
                : "blocked_disconnected",
            responseCode: "EXTERNAL_PROVIDER_DISCONNECTED",
            responseSummary: null,
            nextAttemptAt,
          })
          .where(
            and(
              eq(notificationAttempts.id, attempt.id),
              eq(notificationAttempts.status, "prepared"),
            ),
          );
        const nextFence = event.version + 1;
        const nextEnvelope: OutboxEnvelopeV1 = {
          ...envelope,
          availableAt: nextAttemptAt?.toISOString() ?? envelope.availableAt,
        };
        const [updated] = await tx
          .update(notificationEvents)
          .set({
            status: nextStatus,
            payload: JSON.stringify(nextEnvelope),
            version: nextFence,
            updatedAt: input.now,
          })
          .where(
            and(
              eq(notificationEvents.id, event.id),
              eq(notificationEvents.version, event.version),
              eq(notificationEvents.status, "dispatching"),
            ),
          )
          .returning();
        if (!updated)
          throw new TransactionalOutboxError("persistence_conflict");
        await appendAuditTx(tx, {
          organisationId: input.scope.organisationId,
          projectId: event.projectId,
          eventType:
            nextStatus === "reconciliation_required"
              ? "outbox.reconciliation_required"
              : "outbox.attempt_blocked",
          objectType: "notification_event",
          objectId: event.id,
          details: JSON.stringify({ nextStatus, providerConnected: false }),
        });
        return updated;
      },
      { isolationLevel: "read committed" },
    );
  }

  async claimReconciliation(input: {
    scope: OutboxScope;
    eventId: string;
    expectedFence: number;
    workerId: string;
    now: Date;
  }): Promise<TransactionalOutboxEvent> {
    assertScope(input.scope);
    assertControlInput(input);
    if (!validDate(input.now))
      throw new TransactionalOutboxError("invalid_input");
    const database = (await import("@workspace/db")).db;
    return database.transaction(
      async (tx) => {
        const [event] = await tx
          .select()
          .from(notificationEvents)
          .where(
            and(
              eq(notificationEvents.id, input.eventId),
              eq(notificationEvents.organisationId, input.scope.organisationId),
              projectPredicate(input.scope.projectId),
            ),
          )
          .for("update");
        if (!event)
          throw new TransactionalOutboxError("not_found_or_not_authorized");
        parseEnvelope(event);
        if (event.version !== input.expectedFence)
          throw new TransactionalOutboxError("stale_fence");
        if (event.status !== "reconciliation_required")
          throw new TransactionalOutboxError("invalid_transition");
        const [attempt] = await tx
          .select()
          .from(notificationAttempts)
          .where(
            and(
              eq(
                notificationAttempts.organisationId,
                input.scope.organisationId,
              ),
              eq(notificationAttempts.notificationEventId, event.id),
            ),
          )
          .orderBy(desc(notificationAttempts.attemptNumber))
          .limit(1)
          .for("update");
        if (!attempt || attempt.status !== "outcome_unknown") {
          throw new TransactionalOutboxError("persistence_conflict");
        }
        const nextFence = event.version + 1;
        const leaseExpiresAt = new Date(
          input.now.getTime() + RECONCILIATION_LEASE_MS,
        );
        await tx
          .update(notificationAttempts)
          .set({
            status: "reconciling",
            responseSummary: JSON.stringify({
              schemaVersion: "valo.outbox-reconciliation-control.v1",
              workerId: input.workerId,
              fenceToken: nextFence,
            }),
            nextAttemptAt: leaseExpiresAt,
          })
          .where(
            and(
              eq(notificationAttempts.id, attempt.id),
              eq(notificationAttempts.status, "outcome_unknown"),
            ),
          );
        const [updated] = await tx
          .update(notificationEvents)
          .set({
            status: "reconciling",
            version: nextFence,
            updatedAt: input.now,
          })
          .where(
            and(
              eq(notificationEvents.id, event.id),
              eq(notificationEvents.status, "reconciliation_required"),
              eq(notificationEvents.version, event.version),
            ),
          )
          .returning();
        if (!updated)
          throw new TransactionalOutboxError("persistence_conflict");
        await appendAuditTx(tx, {
          organisationId: input.scope.organisationId,
          projectId: event.projectId,
          eventType: "outbox.reconciliation_claimed",
          objectType: "notification_event",
          objectId: event.id,
          details: JSON.stringify({ attemptId: attempt.id }),
        });
        return updated;
      },
      { isolationLevel: "read committed" },
    );
  }

  async resolveReconciliation(input: {
    scope: OutboxScope;
    eventId: string;
    expectedFence: number;
    workerId: string;
    outcome: "known_not_delivered" | "still_unknown";
    now: Date;
  }): Promise<TransactionalOutboxEvent> {
    assertScope(input.scope);
    assertControlInput(input);
    if (!validDate(input.now))
      throw new TransactionalOutboxError("invalid_input");
    const database = (await import("@workspace/db")).db;
    return database.transaction(
      async (tx) => {
        const [event] = await tx
          .select()
          .from(notificationEvents)
          .where(
            and(
              eq(notificationEvents.id, input.eventId),
              eq(notificationEvents.organisationId, input.scope.organisationId),
              projectPredicate(input.scope.projectId),
            ),
          )
          .for("update");
        if (!event)
          throw new TransactionalOutboxError("not_found_or_not_authorized");
        const envelope = parseEnvelope(event);
        if (event.version !== input.expectedFence)
          throw new TransactionalOutboxError("stale_fence");
        if (event.status !== "reconciling")
          throw new TransactionalOutboxError("invalid_transition");
        const [attempt] = await tx
          .select()
          .from(notificationAttempts)
          .where(
            and(
              eq(
                notificationAttempts.organisationId,
                input.scope.organisationId,
              ),
              eq(notificationAttempts.notificationEventId, event.id),
            ),
          )
          .orderBy(desc(notificationAttempts.attemptNumber))
          .limit(1)
          .for("update");
        if (!attempt || attempt.status !== "reconciling") {
          throw new TransactionalOutboxError("persistence_conflict");
        }
        let control: { workerId?: unknown; fenceToken?: unknown } = {};
        try {
          control = JSON.parse(
            attempt.responseSummary ?? "{}",
          ) as typeof control;
        } catch {
          throw new TransactionalOutboxError("persistence_conflict");
        }
        if (
          control.workerId !== input.workerId ||
          control.fenceToken !== input.expectedFence ||
          attempt.nextAttemptAt == null ||
          attempt.nextAttemptAt.getTime() <= input.now.getTime()
        ) {
          throw new TransactionalOutboxError("stale_fence");
        }
        const terminal =
          attempt.attemptNumber >= envelope.maxAttempts ||
          Date.parse(envelope.deadlineAt) <= input.now.getTime();
        const nextStatus: TransactionalOutboxStatus =
          input.outcome === "still_unknown"
            ? "reconciliation_required"
            : terminal
              ? "dead_letter"
              : "retry_wait";
        const nextAttemptAt =
          nextStatus === "retry_wait"
            ? new Date(input.now.getTime() + 5_000)
            : null;
        await tx
          .update(notificationAttempts)
          .set({
            status:
              input.outcome === "still_unknown"
                ? "outcome_unknown"
                : "reconciled_not_delivered",
            responseCode:
              input.outcome === "still_unknown"
                ? "OUTCOME_UNKNOWN"
                : "CONFIRMED_NOT_DELIVERED",
            responseSummary: null,
            nextAttemptAt,
          })
          .where(eq(notificationAttempts.id, attempt.id));
        const [updated] = await tx
          .update(notificationEvents)
          .set({
            status: nextStatus,
            version: event.version + 1,
            payload: JSON.stringify({
              ...envelope,
              availableAt: nextAttemptAt?.toISOString() ?? envelope.availableAt,
            } satisfies OutboxEnvelopeV1),
            updatedAt: input.now,
          })
          .where(
            and(
              eq(notificationEvents.id, event.id),
              eq(notificationEvents.status, "reconciling"),
              eq(notificationEvents.version, event.version),
            ),
          )
          .returning();
        if (!updated)
          throw new TransactionalOutboxError("persistence_conflict");
        await appendAuditTx(tx, {
          organisationId: input.scope.organisationId,
          projectId: event.projectId,
          eventType: "outbox.reconciliation_resolved",
          objectType: "notification_event",
          objectId: event.id,
          details: JSON.stringify({ outcome: input.outcome, nextStatus }),
        });
        return updated;
      },
      { isolationLevel: "read committed" },
    );
  }

  async recoverExpired(input: {
    scope: OutboxScope;
    eventId: string;
    expectedFence: number;
    now: Date;
  }): Promise<TransactionalOutboxEvent> {
    assertScope(input.scope);
    if (
      !UUID.test(input.eventId) ||
      !boundedInteger(input.expectedFence, 1, Number.MAX_SAFE_INTEGER) ||
      !validDate(input.now)
    ) {
      throw new TransactionalOutboxError("invalid_input");
    }
    const database = (await import("@workspace/db")).db;
    return database.transaction(
      async (tx) => {
        const [event] = await tx
          .select()
          .from(notificationEvents)
          .where(
            and(
              eq(notificationEvents.id, input.eventId),
              eq(notificationEvents.organisationId, input.scope.organisationId),
              projectPredicate(input.scope.projectId),
            ),
          )
          .for("update");
        if (!event)
          throw new TransactionalOutboxError("not_found_or_not_authorized");
        parseEnvelope(event);
        if (event.version !== input.expectedFence)
          throw new TransactionalOutboxError("stale_fence");
        if (event.status !== "dispatching" && event.status !== "reconciling") {
          throw new TransactionalOutboxError("invalid_transition");
        }
        const [attempt] = await tx
          .select()
          .from(notificationAttempts)
          .where(
            and(
              eq(
                notificationAttempts.organisationId,
                input.scope.organisationId,
              ),
              eq(notificationAttempts.notificationEventId, event.id),
            ),
          )
          .orderBy(desc(notificationAttempts.attemptNumber))
          .limit(1)
          .for("update");
        if (
          !attempt ||
          (attempt.status !== "prepared" && attempt.status !== "reconciling") ||
          attempt.nextAttemptAt == null ||
          attempt.nextAttemptAt.getTime() > input.now.getTime()
        ) {
          throw new TransactionalOutboxError("lease_not_expired");
        }
        await tx
          .update(notificationAttempts)
          .set({
            status: "outcome_unknown",
            responseCode: "ATTEMPT_LEASE_EXPIRED",
            responseSummary: null,
            nextAttemptAt: null,
          })
          .where(
            and(
              eq(notificationAttempts.id, attempt.id),
              eq(notificationAttempts.status, attempt.status),
            ),
          );
        const [updated] = await tx
          .update(notificationEvents)
          .set({
            status: "reconciliation_required",
            version: event.version + 1,
            updatedAt: input.now,
          })
          .where(
            and(
              eq(notificationEvents.id, event.id),
              eq(notificationEvents.status, event.status),
              eq(notificationEvents.version, event.version),
            ),
          )
          .returning();
        if (!updated)
          throw new TransactionalOutboxError("persistence_conflict");
        await appendAuditTx(tx, {
          organisationId: input.scope.organisationId,
          projectId: event.projectId,
          eventType: "outbox.attempt_recovered",
          objectType: "notification_event",
          objectId: event.id,
          details: JSON.stringify({
            attemptId: attempt.id,
            previousState: event.status,
            nextStatus: "reconciliation_required",
          }),
        });
        return updated;
      },
      { isolationLevel: "read committed" },
    );
  }
}

export class TransactionalOutboxService {
  constructor(
    private readonly repository: TransactionalOutboxRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  enqueue(
    intent: TransactionalOutboxIntent,
  ): Promise<TransactionalOutboxEvent> {
    return this.repository.enqueue(intent, this.now());
  }

  prepare(
    input: Omit<Parameters<TransactionalOutboxRepository["prepare"]>[0], "now">,
  ) {
    return this.repository.prepare({ ...input, now: this.now() });
  }

  blockPrepared(
    input: Omit<
      Parameters<TransactionalOutboxRepository["blockPrepared"]>[0],
      "now"
    >,
  ) {
    return this.repository.blockPrepared({ ...input, now: this.now() });
  }

  claimReconciliation(
    input: Omit<
      Parameters<TransactionalOutboxRepository["claimReconciliation"]>[0],
      "now"
    >,
  ) {
    return this.repository.claimReconciliation({ ...input, now: this.now() });
  }

  resolveReconciliation(
    input: Omit<
      Parameters<TransactionalOutboxRepository["resolveReconciliation"]>[0],
      "now"
    >,
  ) {
    return this.repository.resolveReconciliation({ ...input, now: this.now() });
  }

  recoverExpired(
    input: Omit<
      Parameters<TransactionalOutboxRepository["recoverExpired"]>[0],
      "now"
    >,
  ) {
    return this.repository.recoverExpired({ ...input, now: this.now() });
  }
}

export function createTransactionalOutboxService(input?: {
  repository?: TransactionalOutboxRepository;
  now?: () => Date;
}): TransactionalOutboxService {
  return new TransactionalOutboxService(
    input?.repository ?? new DrizzleTransactionalOutboxRepository(),
    input?.now,
  );
}
