/**
 * Verifies every organisation's independent audit chain under the same RLS
 * context used by runtime requests.
 *
 * Usage:
 *   pnpm --filter @workspace/api-server run verify:audit
 *   AUDIT_ORGANISATION_ID=<uuid> AUDIT_EXPECTED_HEAD="42:<64-hex>" ...
 *   AUDIT_EXPECTED_HEADS='{"<org-uuid>":"42:<64-hex>"}' ...
 */
import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import {
  auditEvents,
  db,
  organisations,
  pool,
  withTenantDatabase,
} from "@workspace/db";
import {
  verifyAuditChain,
  type AuditChainHead,
  type AuditChainRow,
} from "../src/lib/auditChain";

function parseExpectedHead(
  raw: string | undefined,
): AuditChainHead | undefined {
  if (!raw) return undefined;
  const match = /^(\d+):([0-9a-f]{64})$/i.exec(raw.trim());
  if (!match) {
    throw new Error(`Invalid audit head: ${raw}`);
  }
  return { seq: Number(match[1]), hash: match[2].toLowerCase() };
}

function expectedHeads(): Map<string, AuditChainHead> {
  const heads = new Map<string, AuditChainHead>();
  const rawMap = process.env.AUDIT_EXPECTED_HEADS;
  if (rawMap) {
    const parsed = JSON.parse(rawMap) as Record<string, string>;
    for (const [organisationId, rawHead] of Object.entries(parsed)) {
      heads.set(organisationId, parseExpectedHead(rawHead)!);
    }
  }
  const single = process.env.AUDIT_EXPECTED_HEAD;
  if (single) {
    const organisationId = process.env.AUDIT_ORGANISATION_ID?.trim();
    if (!organisationId) {
      throw new Error("AUDIT_EXPECTED_HEAD requires AUDIT_ORGANISATION_ID");
    }
    heads.set(organisationId, parseExpectedHead(single)!);
  }
  return heads;
}

async function verifyOrganisation(
  organisationId: string,
  expectedHead: AuditChainHead | undefined,
): Promise<boolean> {
  const { chained, legacy } = await withTenantDatabase(
    organisationId,
    async () => {
      const [chained, legacy] = await Promise.all([
        db
          .select()
          .from(auditEvents)
          .where(
            and(
              eq(auditEvents.organisationId, organisationId),
              isNotNull(auditEvents.hash),
            ),
          )
          .orderBy(asc(auditEvents.seq)),
        db
          .select({ rowNo: auditEvents.rowNo })
          .from(auditEvents)
          .where(
            and(
              eq(auditEvents.organisationId, organisationId),
              isNull(auditEvents.hash),
            ),
          ),
      ]);
      return { chained, legacy };
    },
  );

  const rows: AuditChainRow[] = chained.map((row) => ({
    seq: row.seq ?? -1,
    organisationId,
    userId: row.userId,
    userName: row.userName,
    projectId: row.projectId,
    eventType: row.eventType,
    objectType: row.objectType,
    objectId: row.objectId,
    details: row.details,
    createdAt: row.createdAt.toISOString(),
    prevHash: row.prevHash ?? "",
    hash: row.hash ?? "",
  }));
  const result = verifyAuditChain(rows, expectedHead);
  let failed = !result.ok;
  console.log(
    `[${organisationId}] chained=${result.checked}/${rows.length} legacy=${legacy.length}`,
  );
  if (result.error) {
    console.error(
      `[${organisationId}] FAIL seq=${result.error.seq}: ${result.error.reason}`,
    );
  }

  if (chained.length > 0 && legacy.length > 0) {
    const chainStartRowNo = chained.reduce(
      (minimum, row) => Math.min(minimum, row.rowNo),
      Infinity,
    );
    const strayCount = legacy.filter(
      (row) => row.rowNo > chainStartRowNo,
    ).length;
    if (strayCount > 0) {
      failed = true;
      console.error(
        `[${organisationId}] FAIL: ${strayCount} unchained event(s) follow the chain start`,
      );
    }
  }

  const head = rows[rows.length - 1];
  console.log(
    head
      ? `[${organisationId}] HEAD seq=${head.seq} hash=${head.hash}`
      : `[${organisationId}] HEAD (empty chain)`,
  );
  return !failed;
}

async function main(): Promise<number> {
  const requestedOrganisationId = process.env.AUDIT_ORGANISATION_ID?.trim();
  const tenantRows = requestedOrganisationId
    ? [{ id: requestedOrganisationId }]
    : await db.select({ id: organisations.id }).from(organisations);
  const heads = expectedHeads();
  let intact = true;
  for (const tenant of tenantRows) {
    intact =
      (await verifyOrganisation(tenant.id, heads.get(tenant.id))) && intact;
  }
  console.log(intact ? "AUDIT CHAINS: INTACT" : "AUDIT CHAINS: BROKEN");
  return intact ? 0 : 1;
}

main()
  .then(async (code) => {
    await pool.end();
    process.exit(code);
  })
  .catch(async (error: unknown) => {
    console.error("verify-audit-chain crashed:", error);
    await pool.end().catch(() => undefined);
    process.exit(1);
  });
