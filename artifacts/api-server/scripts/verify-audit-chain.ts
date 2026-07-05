/**
 * Audit-chain verifier (FR-WFM-02): recomputes the hash chain over the entire
 * audit_events table.
 *
 * What it proves, stated precisely:
 *   - Any ALTERED event, and any DELETED or REORDERED interior event, is
 *     detected unconditionally.
 *   - TAIL TRUNCATION (deleting the newest events) is detectable only against
 *     a previously recorded head anchor. The script prints the current head
 *     (`HEAD seq=<n> hash=<hex>`) after every run — record it outside the
 *     database (runbook, CI log) and pass it back on the next run via
 *     AUDIT_EXPECTED_HEAD="<seq>:<hash>" to close that gap.
 *   - Unchained rows written after the chain started (writes bypassing
 *     writeAudit) are flagged, keyed on the DB-assigned row_no ordinal rather
 *     than the attacker-writable created_at timestamp.
 *
 * Usage: pnpm --filter @workspace/api-server run verify:audit
 *        AUDIT_EXPECTED_HEAD="42:ab12..." pnpm --filter @workspace/api-server run verify:audit
 * Requires DATABASE_URL. Exit code 0 = chain intact, 1 = chain broken.
 */
import { asc, isNull, isNotNull } from "drizzle-orm";
import { db, auditEvents, pool } from "@workspace/db";
import {
  verifyAuditChain,
  type AuditChainRow,
  type AuditChainHead,
} from "../src/lib/auditChain";

function parseExpectedHead(raw: string | undefined): AuditChainHead | undefined {
  if (!raw) return undefined;
  const m = /^(\d+):([0-9a-f]{64})$/i.exec(raw.trim());
  if (!m) {
    throw new Error(
      `AUDIT_EXPECTED_HEAD must look like "<seq>:<64-hex-hash>", got: ${raw}`,
    );
  }
  return { seq: Number(m[1]), hash: m[2].toLowerCase() };
}

async function main(): Promise<number> {
  const expectedHead = parseExpectedHead(process.env.AUDIT_EXPECTED_HEAD);

  const chained = await db
    .select()
    .from(auditEvents)
    .where(isNotNull(auditEvents.hash))
    .orderBy(asc(auditEvents.seq));
  const legacy = await db
    .select({ rowNo: auditEvents.rowNo, createdAt: auditEvents.createdAt })
    .from(auditEvents)
    .where(isNull(auditEvents.hash));

  const rows: AuditChainRow[] = chained.map((r) => ({
    seq: r.seq ?? -1,
    userId: r.userId,
    userName: r.userName,
    projectId: r.projectId,
    eventType: r.eventType,
    objectType: r.objectType,
    objectId: r.objectId,
    details: r.details,
    createdAt: r.createdAt.toISOString(),
    prevHash: r.prevHash ?? "",
    hash: r.hash ?? "",
  }));

  const result = verifyAuditChain(rows, expectedHead);
  console.log(`Chained events checked: ${result.checked}/${rows.length}`);
  console.log(`Legacy (pre-chain) events: ${legacy.length}`);

  let failed = !result.ok;
  if (result.error) {
    console.error(`FAIL at seq ${result.error.seq}: ${result.error.reason}`);
  }

  // An unchained row written after chaining began means writes are bypassing
  // writeAudit (or someone inserted directly). Keyed on the DB-assigned
  // row_no ordinal: unlike created_at, a plain INSERT cannot backdate it.
  if (chained.length > 0 && legacy.length > 0) {
    const chainStartRowNo = chained.reduce(
      (min, r) => Math.min(min, r.rowNo),
      Infinity,
    );
    const strays = legacy.filter((l) => l.rowNo > chainStartRowNo);
    if (strays.length > 0) {
      failed = true;
      console.error(
        `FAIL: ${strays.length} unchained event(s) written after the chain started (row_no > ${chainStartRowNo}) — writes are bypassing the chain.`,
      );
    }
  }

  // Print the current head so operators can record it outside the DB and pass
  // it back next run — the only way tail truncation becomes detectable.
  if (rows.length > 0) {
    const head = rows.reduce((max, r) => (r.seq > max.seq ? r : max), rows[0]);
    console.log(`HEAD seq=${head.seq} hash=${head.hash}`);
    console.log(
      `Record this head; next run: AUDIT_EXPECTED_HEAD="${head.seq}:${head.hash}"`,
    );
  } else {
    console.log("HEAD (empty chain)");
  }

  console.log(failed ? "AUDIT CHAIN: BROKEN" : "AUDIT CHAIN: INTACT");
  return failed ? 1 : 0;
}

main()
  .then(async (code) => {
    await pool.end();
    process.exit(code);
  })
  .catch(async (err) => {
    console.error("verify-audit-chain crashed:", err);
    await pool.end().catch(() => {});
    process.exit(1);
  });
