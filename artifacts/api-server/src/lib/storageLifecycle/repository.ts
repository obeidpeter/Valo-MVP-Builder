import { createHash } from "node:crypto";
import {
  currentTenantDatabaseOrganisation,
  db,
  notificationAttempts,
  notificationEvents,
  uploadSessions,
} from "@workspace/db";
import { and, asc, eq, inArray, lte, or, sql } from "drizzle-orm";
import type { LocalUser } from "../../middlewares/auth";
import { writeAuditTx } from "../audit";
import { lockStagedUploadObject } from "../stagedUploadLock";
import { storagePathReferenceKinds } from "../storageReferences";
import {
  STORAGE_DELETION_INTENT_SCHEMA,
  STORAGE_LIFECYCLE_BOUNDS,
  StorageLifecycleContractError,
  clientUploadDocumentPath,
  clientUploadObjectPath,
  clientUploadQuarantinePath,
  createStorageDeletionIntent,
  parseClientUploadLeaseEnvelope,
  parseStorageDeletionIntent,
  serializeStorageDeletionIntent,
  storageLifecycleSha256,
  type StorageDeletionIntentEnvelope,
} from "./contracts";

export const STORAGE_DELETION_CHANNEL = "internal_storage" as const;
export const STORAGE_DELETION_PROVIDER = "valo-object-storage" as const;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

type StorageLifecycleTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface StorageDeletionObjectStore {
  deleteObjectEntity(objectPath: string): Promise<boolean>;
}

export interface StorageDeletionIntentInput {
  organisationId: string;
  projectId: string | null;
  objectPath: string;
  aggregateType: StorageDeletionIntentEnvelope["aggregateType"];
  aggregateId: string;
  reason: StorageDeletionIntentEnvelope["reason"];
  requestedAt: Date;
  actor: LocalUser | null | undefined;
}

export interface StoredStorageDeletionIntent {
  id: string;
  version: number;
  status: "queued" | "retry_wait" | "completed" | "cancelled" | "dead_letter";
  replayed: boolean;
  envelope: StorageDeletionIntentEnvelope;
}

export interface StorageDeletionIntentBatch {
  items: StoredStorageDeletionIntent[];
  limit: number;
  truncated: boolean;
}

export interface ExpiredClientUploadLeaseSweep {
  considered: number;
  expired: number;
  completedCleanupQueued: number;
  rejectedCleanupQueued: number;
  quarantinedCleanupQueued: number;
  cleanupUnconfirmedPostExpiryQueued: number;
  truncated: boolean;
}

export type StorageDeletionReconciliation =
  | {
      outcome: "completed" | "cancelled" | "replayed";
      eventId: string;
      version: number;
      objectDeleted: boolean;
      references: readonly string[];
    }
  | {
      outcome: "retry_wait" | "dead_letter";
      eventId: string;
      version: number;
      objectDeleted: false;
      references: readonly [];
    };

export class StorageLifecycleRepositoryError extends Error {
  constructor(
    readonly code:
      | "invalid_scope"
      | "not_found"
      | "stale_version"
      | "invalid_state"
      | "persistence_unavailable",
  ) {
    super(code);
    this.name = "StorageLifecycleRepositoryError";
  }
}

function deterministicUuid(seed: string): string {
  const bytes = Buffer.from(
    createHash("sha256").update(seed).digest("hex").slice(0, 32),
    "hex",
  );
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function assertTenant(organisationId: string): void {
  if (
    !UUID.test(organisationId) ||
    currentTenantDatabaseOrganisation() !== organisationId
  ) {
    throw new StorageLifecycleRepositoryError("invalid_scope");
  }
}

function eventIdFor(envelope: StorageDeletionIntentEnvelope): string {
  return deterministicUuid(
    `${STORAGE_DELETION_INTENT_SCHEMA}\0${envelope.organisationId}\0${envelope.requestSha256}`,
  );
}

function attemptKey(eventId: string, attemptNumber: number): string {
  return storageLifecycleSha256({
    schema: STORAGE_DELETION_INTENT_SCHEMA,
    eventId,
    attemptNumber,
  });
}

function retryDelayMs(attemptNumber: number): number {
  const seconds = Math.min(
    STORAGE_LIFECYCLE_BOUNDS.deletionRetryBaseSeconds *
      2 ** Math.max(0, attemptNumber - 1),
    STORAGE_LIFECYCLE_BOUNDS.deletionRetryMaximumSeconds,
  );
  return seconds * 1_000;
}

function parseStoredEvent(row: {
  id: string;
  organisationId: string | null;
  projectId: string | null;
  channel: string;
  template: string;
  payload: string | null;
  status: string;
  version: number;
}): StoredStorageDeletionIntent {
  if (
    !row.organisationId ||
    row.channel !== STORAGE_DELETION_CHANNEL ||
    row.template !== STORAGE_DELETION_INTENT_SCHEMA ||
    !row.payload ||
    !["queued", "retry_wait", "completed", "cancelled", "dead_letter"].includes(
      row.status,
    ) ||
    !Number.isSafeInteger(row.version) ||
    row.version < 1
  ) {
    throw new StorageLifecycleRepositoryError("persistence_unavailable");
  }
  let envelope: StorageDeletionIntentEnvelope;
  try {
    envelope = parseStorageDeletionIntent(row.payload);
  } catch (error) {
    if (error instanceof StorageLifecycleContractError) {
      throw new StorageLifecycleRepositoryError("persistence_unavailable");
    }
    throw error;
  }
  if (
    envelope.organisationId !== row.organisationId ||
    // Queue rows deliberately avoid the project FK so a project lifecycle
    // delete cannot cascade away an outstanding object deletion intent.
    row.projectId !== null ||
    eventIdFor(envelope) !== row.id
  ) {
    throw new StorageLifecycleRepositoryError("persistence_unavailable");
  }
  return {
    id: row.id,
    version: row.version,
    status: row.status as StoredStorageDeletionIntent["status"],
    replayed: false,
    envelope,
  };
}

export async function enqueueStorageDeletionIntentTx(
  tx: StorageLifecycleTx,
  input: StorageDeletionIntentInput,
): Promise<StoredStorageDeletionIntent> {
  assertTenant(input.organisationId);
  if (!Number.isFinite(input.requestedAt.valueOf())) {
    throw new StorageLifecycleRepositoryError("persistence_unavailable");
  }
  let envelope: StorageDeletionIntentEnvelope;
  try {
    envelope = createStorageDeletionIntent({
      organisationId: input.organisationId,
      projectId: input.projectId,
      objectPath: input.objectPath,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      reason: input.reason,
      requestedAt: input.requestedAt.toISOString(),
    });
  } catch (error) {
    if (error instanceof StorageLifecycleContractError) {
      throw new StorageLifecycleRepositoryError("persistence_unavailable");
    }
    throw error;
  }
  const eventId = eventIdFor(envelope);
  const inserted = await tx
    .insert(notificationEvents)
    .values({
      id: eventId,
      organisationId: input.organisationId,
      // Keep the durable internal queue independent of project-row cascades.
      // The closed envelope and audit receipt retain the scoped project ID.
      projectId: null,
      channel: STORAGE_DELETION_CHANNEL,
      template: STORAGE_DELETION_INTENT_SCHEMA,
      recipient: null,
      payload: serializeStorageDeletionIntent(envelope),
      status: "queued",
      availableAt: input.requestedAt,
      createdBy: input.actor?.id ?? null,
      version: 1,
    })
    .onConflictDoNothing({ target: notificationEvents.id })
    .returning();
  if (inserted.length === 1) {
    await writeAuditTx(tx, {
      user: input.actor,
      organisationId: input.organisationId,
      projectId: input.projectId,
      eventType: "storage.deletion_queued",
      objectType: input.aggregateType,
      objectId: input.aggregateId,
      details: JSON.stringify({
        schema: STORAGE_DELETION_INTENT_SCHEMA,
        eventId,
        requestSha256: envelope.requestSha256,
      }),
    });
    return { ...parseStoredEvent(inserted[0]!), replayed: false };
  }
  const rows = await tx
    .select()
    .from(notificationEvents)
    .where(
      and(
        eq(notificationEvents.id, eventId),
        eq(notificationEvents.organisationId, input.organisationId),
      ),
    )
    .limit(2);
  if (rows.length !== 1) {
    throw new StorageLifecycleRepositoryError("persistence_unavailable");
  }
  const existing = parseStoredEvent(rows[0]!);
  if (existing.envelope.requestSha256 !== envelope.requestSha256) {
    throw new StorageLifecycleRepositoryError("persistence_unavailable");
  }
  return { ...existing, replayed: true };
}

/**
 * Append a deletion intent inside the active tenant transaction. Routes use
 * this wrapper so the reference mutation, intent and audit receipt commit or
 * roll back together; nested transactions are savepoints on the same client.
 */
export async function enqueueStorageDeletionIntent(
  input: StorageDeletionIntentInput,
): Promise<StoredStorageDeletionIntent> {
  return db.transaction((tx) => enqueueStorageDeletionIntentTx(tx, input));
}

/** One FIFO page for a single tenant. No unscoped/global claim is supported. */
export async function listPendingStorageDeletionIntents(
  organisationId: string,
  limit: number = STORAGE_LIFECYCLE_BOUNDS.reconciliationBatch,
): Promise<StorageDeletionIntentBatch> {
  assertTenant(organisationId);
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > STORAGE_LIFECYCLE_BOUNDS.reconciliationBatch
  ) {
    throw new StorageLifecycleRepositoryError("invalid_scope");
  }
  const rows = await db
    .select()
    .from(notificationEvents)
    .where(
      and(
        eq(notificationEvents.organisationId, organisationId),
        eq(notificationEvents.channel, STORAGE_DELETION_CHANNEL),
        eq(notificationEvents.template, STORAGE_DELETION_INTENT_SCHEMA),
        or(
          eq(notificationEvents.status, "queued"),
          and(
            eq(notificationEvents.status, "retry_wait"),
            lte(notificationEvents.availableAt, sql`clock_timestamp()`),
          ),
        ),
      ),
    )
    .orderBy(
      asc(notificationEvents.availableAt),
      asc(notificationEvents.createdAt),
      asc(notificationEvents.id),
    )
    .limit(limit + 1);
  const truncated = rows.length > limit;
  return {
    items: rows.slice(0, limit).map(parseStoredEvent),
    limit,
    truncated,
  };
}

/**
 * Close one bounded page of signed-upload paths after the URL lifetime and a
 * bounded in-flight request grace have both elapsed.
 * Completed leases are included because a signed PUT can recreate the staged
 * object after finalization until the URL expires. Row locking and intent
 * creation share the tenant transaction, so either both persist or neither
 * does. Candidate discovery is unlocked; exact eligibility is re-read after
 * the staged-path lock in the same deterministic order as issuance/finalize.
 */
export async function sweepExpiredClientUploadLeases(
  organisationId: string,
  limit: number = STORAGE_LIFECYCLE_BOUNDS.reconciliationBatch,
): Promise<ExpiredClientUploadLeaseSweep> {
  assertTenant(organisationId);
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > STORAGE_LIFECYCLE_BOUNDS.reconciliationBatch
  ) {
    throw new StorageLifecycleRepositoryError("invalid_scope");
  }
  return db.transaction(async (tx) => {
    const nowResult = await tx.execute(
      sql`SELECT pg_catalog.clock_timestamp() AS now`,
    );
    const nowValue = (nowResult.rows[0] as { now?: unknown } | undefined)?.now;
    const now = new Date(String(nowValue ?? ""));
    if (!Number.isFinite(now.valueOf())) {
      throw new StorageLifecycleRepositoryError("persistence_unavailable");
    }
    const eligibleBefore = new Date(
      now.valueOf() -
        STORAGE_LIFECYCLE_BOUNDS.uploadPostExpiryGraceSeconds * 1_000,
    );
    const cleanupSourceStatuses = [
      "open",
      "completed",
      "rejected",
      "quarantined",
      "cleanup_unconfirmed",
    ] as const;
    const candidates = await tx
      .select()
      .from(uploadSessions)
      .where(
        and(
          eq(uploadSessions.organisationId, organisationId),
          inArray(uploadSessions.status, cleanupSourceStatuses),
          lte(uploadSessions.expiresAt, eligibleBefore),
        ),
      )
      .orderBy(asc(uploadSessions.expiresAt), asc(uploadSessions.id))
      .limit(limit + 1);
    const truncated = candidates.length > limit;
    const page = candidates.slice(0, limit);
    let expired = 0;
    let completedCleanupQueued = 0;
    let rejectedCleanupQueued = 0;
    let quarantinedCleanupQueued = 0;
    let cleanupUnconfirmedPostExpiryQueued = 0;

    for (const candidate of page) {
      const objectPath = clientUploadObjectPath(organisationId, candidate.id);
      // All staged-object mutation paths use path -> upload row. Candidate
      // discovery is deliberately unlocked, then eligibility is re-read after
      // the advisory lock to avoid a path/row inversion with lease finalizing.
      await lockStagedUploadObject(objectPath);
      const currentRows = await tx
        .select()
        .from(uploadSessions)
        .where(
          and(
            eq(uploadSessions.id, candidate.id),
            eq(uploadSessions.organisationId, organisationId),
            inArray(uploadSessions.status, cleanupSourceStatuses),
            lte(uploadSessions.expiresAt, eligibleBefore),
          ),
        )
        .limit(2)
        .for("update");
      if (currentRows.length === 0) continue;
      if (currentRows.length !== 1) {
        throw new StorageLifecycleRepositoryError("persistence_unavailable");
      }
      const row = currentRows[0]!;
      // A corrupt envelope must not silently transition past cleanup.
      let envelope;
      try {
        envelope = parseClientUploadLeaseEnvelope(row.idempotencyKey);
      } catch (error) {
        if (error instanceof StorageLifecycleContractError) {
          throw new StorageLifecycleRepositoryError("persistence_unavailable");
        }
        throw error;
      }
      if (envelope.recordId.length === 0) {
        throw new StorageLifecycleRepositoryError("persistence_unavailable");
      }
      const nextStatus =
        row.status === "open"
          ? "expired"
          : row.status === "completed"
            ? "completed_cleanup_queued"
            : row.status === "rejected"
              ? "rejected_cleanup_queued"
              : row.status === "quarantined"
                ? "quarantined_cleanup_queued"
                : "cleanup_unconfirmed_post_expiry_queued";
      const updated = await tx
        .update(uploadSessions)
        .set({
          status: nextStatus,
          version: row.version + 1,
          updatedAt: now,
        })
        .where(
          and(
            eq(uploadSessions.id, row.id),
            eq(uploadSessions.organisationId, organisationId),
            eq(uploadSessions.status, row.status),
            eq(uploadSessions.version, row.version),
          ),
        )
        .returning({ id: uploadSessions.id });
      if (updated.length !== 1) {
        throw new StorageLifecycleRepositoryError("stale_version");
      }
      await enqueueStorageDeletionIntentTx(tx, {
        organisationId,
        projectId: row.projectId,
        objectPath,
        aggregateType: "upload_session",
        aggregateId: row.id,
        reason: "lease_expired",
        requestedAt: now,
        actor: null,
      });
      if (
        row.status === "open" ||
        row.status === "rejected" ||
        row.status === "quarantined" ||
        row.status === "cleanup_unconfirmed"
      ) {
        // Promotion writes this deterministic destination before the database
        // transaction. A crash/rollback can therefore leave it unregistered;
        // reference-aware reconciliation safely deletes only an orphan.
        await enqueueStorageDeletionIntentTx(tx, {
          organisationId,
          projectId: row.projectId,
          objectPath: clientUploadDocumentPath(organisationId, row.id),
          aggregateType: "upload_session",
          aggregateId: row.id,
          reason: "lease_expired",
          requestedAt: now,
          actor: null,
        });
      }
      if (
        row.status === "open" ||
        row.status === "quarantined" ||
        row.status === "cleanup_unconfirmed"
      ) {
        await enqueueStorageDeletionIntentTx(tx, {
          organisationId,
          projectId: row.projectId,
          objectPath: clientUploadQuarantinePath(organisationId, row.id),
          aggregateType: "upload_session",
          aggregateId: row.id,
          reason: "lease_expired",
          requestedAt: now,
          actor: null,
        });
      }
      await writeAuditTx(tx, {
        user: null,
        organisationId,
        projectId: row.projectId,
        eventType: "client_action.upload_post_expiry_cleanup_queued",
        objectType: "upload_session",
        objectId: row.id,
        details: JSON.stringify({
          leaseId: row.id,
          sourceStatus: row.status,
          nextStatus,
          expiresAt: row.expiresAt.toISOString(),
          stagedPathSha256: storageLifecycleSha256(objectPath),
          promotedPathCleanupQueued:
            row.status === "open" ||
            row.status === "rejected" ||
            row.status === "quarantined" ||
            row.status === "cleanup_unconfirmed",
          quarantinePathCleanupQueued:
            row.status === "open" ||
            row.status === "quarantined" ||
            row.status === "cleanup_unconfirmed",
        }),
      });
      if (nextStatus === "expired") expired += 1;
      else if (nextStatus === "completed_cleanup_queued")
        completedCleanupQueued += 1;
      else if (nextStatus === "rejected_cleanup_queued")
        rejectedCleanupQueued += 1;
      else if (nextStatus === "quarantined_cleanup_queued")
        quarantinedCleanupQueued += 1;
      else cleanupUnconfirmedPostExpiryQueued += 1;
    }

    return {
      considered: page.length,
      expired,
      completedCleanupQueued,
      rejectedCleanupQueued,
      quarantinedCleanupQueued,
      cleanupUnconfirmedPostExpiryQueued,
      truncated,
    };
  });
}

export async function reconcileStorageDeletionIntent(input: {
  organisationId: string;
  eventId: string;
  expectedVersion: number;
  actor: LocalUser | null | undefined;
  objectStore: StorageDeletionObjectStore;
  now: Date;
}): Promise<StorageDeletionReconciliation> {
  assertTenant(input.organisationId);
  if (
    !UUID.test(input.eventId) ||
    !Number.isSafeInteger(input.expectedVersion) ||
    input.expectedVersion < 1 ||
    !Number.isFinite(input.now.valueOf())
  ) {
    throw new StorageLifecycleRepositoryError("invalid_scope");
  }
  return db.transaction(async (tx) => {
    const candidateRows = await tx
      .select()
      .from(notificationEvents)
      .where(
        and(
          eq(notificationEvents.id, input.eventId),
          eq(notificationEvents.organisationId, input.organisationId),
          eq(notificationEvents.channel, STORAGE_DELETION_CHANNEL),
          eq(notificationEvents.template, STORAGE_DELETION_INTENT_SCHEMA),
        ),
      )
      .limit(2);
    if (candidateRows.length !== 1) {
      throw new StorageLifecycleRepositoryError("not_found");
    }
    const candidate = parseStoredEvent(candidateRows[0]!);
    await lockStagedUploadObject(candidate.envelope.objectPath);
    const rows = await tx
      .select()
      .from(notificationEvents)
      .where(
        and(
          eq(notificationEvents.id, input.eventId),
          eq(notificationEvents.organisationId, input.organisationId),
          eq(notificationEvents.channel, STORAGE_DELETION_CHANNEL),
          eq(notificationEvents.template, STORAGE_DELETION_INTENT_SCHEMA),
        ),
      )
      .limit(2)
      .for("update");
    if (rows.length !== 1) {
      throw new StorageLifecycleRepositoryError("not_found");
    }
    const event = parseStoredEvent(rows[0]!);
    if (
      event.envelope.requestSha256 !== candidate.envelope.requestSha256 ||
      event.envelope.objectPath !== candidate.envelope.objectPath
    ) {
      throw new StorageLifecycleRepositoryError("persistence_unavailable");
    }
    if (event.version !== input.expectedVersion) {
      throw new StorageLifecycleRepositoryError("stale_version");
    }
    if (event.status === "completed" || event.status === "cancelled") {
      return {
        outcome: "replayed",
        eventId: event.id,
        version: event.version,
        objectDeleted: event.status === "completed",
        references: [],
      };
    }
    if (event.status === "dead_letter") {
      throw new StorageLifecycleRepositoryError("invalid_state");
    }
    if (event.status === "retry_wait") {
      const eligibility = await tx.execute(
        sql`SELECT ${rows[0]!.availableAt} <= pg_catalog.clock_timestamp() AS eligible`,
      );
      if (
        (eligibility.rows[0] as { eligible?: unknown } | undefined)
          ?.eligible !== true
      ) {
        throw new StorageLifecycleRepositoryError("invalid_state");
      }
    }
    const attempts = await tx
      .select({ attemptNumber: notificationAttempts.attemptNumber })
      .from(notificationAttempts)
      .where(
        and(
          eq(notificationAttempts.organisationId, input.organisationId),
          eq(notificationAttempts.notificationEventId, event.id),
        ),
      )
      .orderBy(asc(notificationAttempts.attemptNumber))
      .limit(STORAGE_LIFECYCLE_BOUNDS.maximumAttempts + 1);
    if (attempts.length > STORAGE_LIFECYCLE_BOUNDS.maximumAttempts) {
      throw new StorageLifecycleRepositoryError("persistence_unavailable");
    }
    const attemptNumber = attempts.length + 1;
    if (attemptNumber > STORAGE_LIFECYCLE_BOUNDS.maximumAttempts) {
      const [dead] = await tx
        .update(notificationEvents)
        .set({
          status: "dead_letter",
          version: sql`${notificationEvents.version} + 1`,
          availableAt: input.now,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(notificationEvents.id, event.id),
            eq(notificationEvents.version, event.version),
          ),
        )
        .returning({ version: notificationEvents.version });
      if (!dead) {
        throw new StorageLifecycleRepositoryError("stale_version");
      }
      await writeAuditTx(tx, {
        user: input.actor,
        organisationId: input.organisationId,
        projectId: event.envelope.projectId,
        eventType: "storage.deletion_dead_lettered",
        objectType: event.envelope.aggregateType,
        objectId: event.envelope.aggregateId,
        details: JSON.stringify({
          eventId: event.id,
          requestSha256: event.envelope.requestSha256,
          attempts: attempts.length,
          reason: "attempt_limit_reached",
        }),
      });
      return {
        outcome: "dead_letter",
        eventId: event.id,
        version: dead.version,
        objectDeleted: false,
        references: [],
      };
    }

    const references = await storagePathReferenceKinds(
      event.envelope.objectPath,
    );
    if (references.length > 0) {
      await tx.insert(notificationAttempts).values({
        organisationId: input.organisationId,
        notificationEventId: event.id,
        attemptNumber,
        provider: STORAGE_DELETION_PROVIDER,
        idempotencyKey: attemptKey(event.id, attemptNumber),
        status: "cancelled_referenced",
        responseCode: "reference_present",
        responseSummary: references.join(","),
        attemptedAt: input.now,
      });
      const [cancelled] = await tx
        .update(notificationEvents)
        .set({
          status: "cancelled",
          version: sql`${notificationEvents.version} + 1`,
          availableAt: input.now,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(notificationEvents.id, event.id),
            eq(notificationEvents.version, event.version),
          ),
        )
        .returning({ version: notificationEvents.version });
      if (!cancelled) {
        throw new StorageLifecycleRepositoryError("stale_version");
      }
      await writeAuditTx(tx, {
        user: input.actor,
        organisationId: input.organisationId,
        projectId: event.envelope.projectId,
        eventType: "storage.deletion_cancelled_referenced",
        objectType: event.envelope.aggregateType,
        objectId: event.envelope.aggregateId,
        details: JSON.stringify({ eventId: event.id, references }),
      });
      return {
        outcome: "cancelled",
        eventId: event.id,
        version: cancelled.version,
        objectDeleted: false,
        references,
      };
    }

    try {
      const objectDeleted = await input.objectStore.deleteObjectEntity(
        event.envelope.objectPath,
      );
      await tx.insert(notificationAttempts).values({
        organisationId: input.organisationId,
        notificationEventId: event.id,
        attemptNumber,
        provider: STORAGE_DELETION_PROVIDER,
        idempotencyKey: attemptKey(event.id, attemptNumber),
        status: "completed",
        responseCode: objectDeleted ? "deleted" : "already_absent",
        responseSummary: null,
        attemptedAt: input.now,
      });
      const [completed] = await tx
        .update(notificationEvents)
        .set({
          status: "completed",
          version: sql`${notificationEvents.version} + 1`,
          availableAt: input.now,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(notificationEvents.id, event.id),
            eq(notificationEvents.version, event.version),
          ),
        )
        .returning({ version: notificationEvents.version });
      if (!completed) {
        throw new StorageLifecycleRepositoryError("stale_version");
      }
      await writeAuditTx(tx, {
        user: input.actor,
        organisationId: input.organisationId,
        projectId: event.envelope.projectId,
        eventType: "storage.deletion_reconciled",
        objectType: event.envelope.aggregateType,
        objectId: event.envelope.aggregateId,
        details: JSON.stringify({
          eventId: event.id,
          requestSha256: event.envelope.requestSha256,
          objectDeleted,
        }),
      });
      return {
        outcome: "completed",
        eventId: event.id,
        version: completed.version,
        objectDeleted,
        references: [],
      };
    } catch (error) {
      if (error instanceof StorageLifecycleRepositoryError) throw error;
      const terminal =
        attemptNumber >= STORAGE_LIFECYCLE_BOUNDS.maximumAttempts;
      const nextAttemptAt = terminal
        ? null
        : new Date(input.now.valueOf() + retryDelayMs(attemptNumber));
      await tx.insert(notificationAttempts).values({
        organisationId: input.organisationId,
        notificationEventId: event.id,
        attemptNumber,
        provider: STORAGE_DELETION_PROVIDER,
        idempotencyKey: attemptKey(event.id, attemptNumber),
        status: terminal ? "dead_letter" : "retry_wait",
        responseCode: "delete_unconfirmed",
        responseSummary: null,
        nextAttemptAt,
        attemptedAt: input.now,
      });
      const [updated] = await tx
        .update(notificationEvents)
        .set({
          status: terminal ? "dead_letter" : "retry_wait",
          version: sql`${notificationEvents.version} + 1`,
          availableAt: nextAttemptAt ?? input.now,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(notificationEvents.id, event.id),
            eq(notificationEvents.version, event.version),
          ),
        )
        .returning({ version: notificationEvents.version });
      if (!updated) {
        throw new StorageLifecycleRepositoryError("stale_version");
      }
      await writeAuditTx(tx, {
        user: input.actor,
        organisationId: input.organisationId,
        projectId: event.envelope.projectId,
        eventType: terminal
          ? "storage.deletion_dead_lettered"
          : "storage.deletion_retry_scheduled",
        objectType: event.envelope.aggregateType,
        objectId: event.envelope.aggregateId,
        details: JSON.stringify({
          eventId: event.id,
          requestSha256: event.envelope.requestSha256,
          attemptNumber,
          nextAttemptAt: nextAttemptAt?.toISOString() ?? null,
          reason: "delete_unconfirmed",
        }),
      });
      return {
        outcome: terminal ? "dead_letter" : "retry_wait",
        eventId: event.id,
        version: updated.version,
        objectDeleted: false,
        references: [],
      };
    }
  });
}
