import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { db, auditEvents, projects } from "@workspace/db";
import type { LocalUser } from "../middlewares/auth";
import {
  AUDIT_GENESIS_HASH,
  computeAuditHash,
  type AuditChainPayload,
} from "./auditChain";

/**
 * Arbitrary constant key for the Postgres advisory lock that serialises audit
 * writes. The chain requires each event to reference its predecessor's hash,
 * so concurrent writers must be ordered; audit volume in this internal tool is
 * low enough that a single lock is the simplest correct answer.
 */
const AUDIT_CHAIN_LOCK_KEY = 823914501;

/** A drizzle transaction handle, derived without importing drizzle internals. */
type AuditTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface AuditParams {
  user?: LocalUser | null;
  organisationId?: string | null;
  projectId?: string | null;
  eventType: string;
  objectType?: string | null;
  objectId?: string | null;
  details?: string | null;
}

/**
 * Append one event to the tamper-evident audit chain within an already-open
 * transaction. Failures propagate to the caller so the surrounding work can be
 * rolled back — use this when the audit record and the audited change must be
 * atomic (e.g. the retention scheduler, whose whole purpose is to record that
 * it opened a request). The caller's transaction MUST be read-committed.
 */
export async function writeAuditTx(
  tx: AuditTx,
  params: AuditParams,
): Promise<void> {
  let organisationId = params.organisationId ?? null;
  if (!organisationId && params.projectId) {
    const [project] = await tx
      .select({ organisationId: projects.organisationId })
      .from(projects)
      .where(eq(projects.id, params.projectId));
    organisationId = project?.organisationId ?? null;
  }
  if (!organisationId) {
    throw new Error("Audit events require an explicit tenant organisation");
  }

  // Bound lock/statement waits so a wedged lock-holder fails fast rather than
  // stalling. SET LOCAL reverts at transaction end.
  await tx.execute(sql`SET LOCAL lock_timeout = '2s'`);
  await tx.execute(sql`SET LOCAL statement_timeout = '5s'`);
  // Serialise chain writers; released automatically at transaction end.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${AUDIT_CHAIN_LOCK_KEY})`);

  const [last] = await tx
    .select({ seq: auditEvents.seq, hash: auditEvents.hash })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.organisationId, organisationId),
        isNotNull(auditEvents.seq),
      ),
    )
    .orderBy(desc(auditEvents.seq))
    .limit(1);

  const payload: AuditChainPayload = {
    seq: (last?.seq ?? 0) + 1,
    organisationId,
    userId: params.user?.id ?? null,
    userName: params.user?.name ?? params.user?.email ?? null,
    projectId: params.projectId ?? null,
    eventType: params.eventType,
    objectType: params.objectType ?? null,
    objectId: params.objectId ?? null,
    details: params.details ?? null,
    // App-generated (not the DB default) so the timestamp is covered by
    // the hash and verification never depends on DB-side formatting.
    createdAt: new Date().toISOString(),
  };
  const prevHash = last?.hash ?? AUDIT_GENESIS_HASH;
  await tx.insert(auditEvents).values({
    organisationId,
    userId: payload.userId,
    userName: payload.userName,
    projectId: payload.projectId,
    eventType: payload.eventType,
    objectType: payload.objectType,
    objectId: payload.objectId,
    details: payload.details,
    seq: payload.seq,
    prevHash,
    hash: computeAuditHash(prevHash, payload),
    createdAt: new Date(payload.createdAt),
  });
}

export async function writeAudit(params: AuditParams): Promise<void> {
  await db.transaction(async (tx) => writeAuditTx(tx, params), {
    // Pin the isolation level: the max-seq read AFTER acquiring the lock
    // must see the previous holder's commit. Under a server configured with
    // default_transaction_isolation=repeatable read, the snapshot would be
    // taken before the lock wait ended and the chain could fork.
    isolationLevel: "read committed",
  });
}
