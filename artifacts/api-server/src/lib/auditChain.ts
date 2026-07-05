import { createHash } from "node:crypto";

/**
 * Tamper-evident audit chain (FR-WFM-02): every audit event carries a
 * contiguous 1-based `seq`, the previous event's `hash` as `prevHash`, and its
 * own `hash` = SHA-256(prevHash + "\n" + canonical payload).
 *
 * Guarantee, stated precisely: altering any event, deleting or reordering any
 * INTERIOR event, breaks verification. Deleting the newest event(s) — tail
 * truncation — leaves a clean shorter prefix that the chain alone cannot
 * detect; it is only detectable against a previously recorded head anchor
 * (seq + hash) kept OUTSIDE the database. `verifyAuditChain` accepts such an
 * anchor, and `scripts/verify-audit-chain.ts` prints the current head after
 * every run so operators can record it (runbook, CI log, ticket).
 *
 * This module is pure — no DB, no clock — so the hashing and verification
 * rules are unit-testable and shared verbatim between the writer
 * (`lib/audit.ts`) and the verifier script.
 */

/** prevHash of the first chained event. */
export const AUDIT_GENESIS_HASH = "0".repeat(64);

export interface AuditChainPayload {
  seq: number;
  userId: string | null;
  userName: string | null;
  projectId: string | null;
  eventType: string;
  objectType: string | null;
  objectId: string | null;
  details: string | null;
  /** ISO-8601 timestamp; must be app-generated so it is part of the hash. */
  createdAt: string;
}

/**
 * Canonical byte representation of an event for hashing. Field order is fixed
 * and explicit — object key order must never depend on the caller — and the
 * encoding is JSON so delimiter injection via string fields is impossible.
 */
export function canonicalAuditPayload(p: AuditChainPayload): string {
  return JSON.stringify([
    p.seq,
    p.userId,
    p.userName,
    p.projectId,
    p.eventType,
    p.objectType,
    p.objectId,
    p.details,
    p.createdAt,
  ]);
}

export function computeAuditHash(prevHash: string, payload: AuditChainPayload): string {
  return createHash("sha256")
    .update(prevHash)
    .update("\n")
    .update(canonicalAuditPayload(payload))
    .digest("hex");
}

export interface AuditChainRow extends AuditChainPayload {
  prevHash: string;
  hash: string;
}

export interface AuditChainVerification {
  ok: boolean;
  /** Number of chained rows checked. */
  checked: number;
  /** First failure encountered, if any. */
  error?: { seq: number; reason: string };
}

/** A previously recorded chain head, kept outside the database. */
export interface AuditChainHead {
  seq: number;
  hash: string;
}

/**
 * Verify a complete chain: rows must be the full set of chained events,
 * in any order. Checks seq contiguity from 1, linkage, and every hash.
 * When `expectedHead` (a head recorded on a previous run, stored outside the
 * DB) is supplied, additionally proves the chain has not been tail-truncated
 * below it: the row at that seq must still exist with that exact hash.
 */
export function verifyAuditChain(
  rows: AuditChainRow[],
  expectedHead?: AuditChainHead,
): AuditChainVerification {
  const sorted = [...rows].sort((a, b) => a.seq - b.seq);
  let prevHash = AUDIT_GENESIS_HASH;
  for (let i = 0; i < sorted.length; i++) {
    const row = sorted[i];
    const expectedSeq = i + 1;
    if (row.seq !== expectedSeq) {
      return {
        ok: false,
        checked: i,
        error: {
          seq: row.seq,
          reason: `sequence gap: expected seq ${expectedSeq}, found ${row.seq} — event(s) missing or reordered`,
        },
      };
    }
    if (row.prevHash !== prevHash) {
      return {
        ok: false,
        checked: i,
        error: {
          seq: row.seq,
          reason: `broken link: prevHash does not match hash of event ${row.seq - 1}`,
        },
      };
    }
    const recomputed = computeAuditHash(prevHash, row);
    if (row.hash !== recomputed) {
      return {
        ok: false,
        checked: i,
        error: {
          seq: row.seq,
          reason: "hash mismatch: event payload was altered after it was written",
        },
      };
    }
    prevHash = row.hash;
  }

  if (expectedHead) {
    const anchored = sorted[expectedHead.seq - 1];
    if (!anchored) {
      return {
        ok: false,
        checked: sorted.length,
        error: {
          seq: expectedHead.seq,
          reason: `chain truncated: anchored head seq ${expectedHead.seq} is missing (chain now ends at ${sorted.length})`,
        },
      };
    }
    if (anchored.hash !== expectedHead.hash) {
      return {
        ok: false,
        checked: sorted.length,
        error: {
          seq: expectedHead.seq,
          reason: "anchored head hash mismatch: the event at the recorded head seq is not the recorded event",
        },
      };
    }
  }

  return { ok: true, checked: sorted.length };
}
