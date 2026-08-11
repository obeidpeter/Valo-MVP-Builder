import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./auditRepository.ts", import.meta.url),
  "utf8",
);

test("acceptance evidence requires current direct named tenant authorities", () => {
  assert.match(source, /eq\(organisationMemberships\.organisationId/u);
  assert.match(source, /eq\(organisationMemberships\.status, "active"\)/u);
  assert.match(
    source,
    /isNull\(organisationMemberships\.delegatedByMembershipId\)/u,
  );
  assert.match(source, /eq\(users\.status, "active"\)/u);
  assert.match(source, /isNull\(roleGrants\.revokedAt\)/u);
  assert.match(source, /RECORD_ROLES/u);
});

test("owner and verifier are revalidated together before the append", () => {
  assert.match(
    source,
    /\[scope\.actorUserId, record\.ownerUserId\][\s\S]*RECORD_ROLES/u,
  );
  assert.match(source, /record\.verifiedByUserId !== scope\.actorUserId/u);
  assert.match(source, /writeAuditTx\(tx/u);
});

test("the tenant evidence register stays bounded and append only", () => {
  assert.match(source, /maxEvidenceRecords \+ 1/u);
  assert.match(source, /pg_advisory_xact_lock/u);
  assert.match(source, /MAX_SET_BYTES/u);
  assert.doesNotMatch(
    source,
    /\.delete\(auditEvents\)|\.update\(auditEvents\)/u,
  );
});
