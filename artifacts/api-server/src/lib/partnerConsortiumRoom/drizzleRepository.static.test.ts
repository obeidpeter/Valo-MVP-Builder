import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./drizzleRepository.ts", import.meta.url),
  "utf8",
);

test("durable room uses one reserved project-retained work-task namespace", () => {
  assert.match(source, /CONSORTIUM_TITLE_PREFIX/u);
  assert.match(source, /\[CONSORTIUM-ROOM:v1:/u);
  assert.match(source, /owning_project_retention_policy/u);
  assert.match(source, /independentDeletionAllowed: false/u);
  assert.match(source, /eq\(workTasks\.organisationId/u);
  assert.match(source, /eq\(workTasks\.projectId/u);
  assert.doesNotMatch(source, /\.delete\(workTasks\)/u);
});

test("authority proves exact active relationship and direct named memberships", () => {
  assert.match(
    source,
    /eq\(partnerRelationships\.id, scope\.relationshipId\)/u,
  );
  assert.match(source, /eq\(partnerRelationships\.status, "active"\)/u);
  assert.match(
    source,
    /scope\.contextPartnerRelationshipId === scope\.relationshipId/u,
  );
  assert.match(
    source,
    /isNull\(organisationMemberships\.delegatedByMembershipId\)/u,
  );
  assert.match(source, /clientOwnershipRule !== "client_retained"/u);
  assert.match(source, /listPartyParticipants/u);
  assert.match(source, /isNotNull\(users\.name\)/u);
  assert.match(source, /\.limit\(limit\)/u);
});

test("CAS and immutable content-free receipts share the audit transaction", () => {
  assert.match(source, /eq\(workTasks\.version, current\.version\)/u);
  assert.match(source, /sameReceiptPrefix/u);
  assert.match(source, /validReceiptChain/u);
  assert.match(source, /writeAuditTx\(tx/u);
  assert.match(source, /contentIncluded: false/u);
  assert.match(source, /externalActionPerformed: false/u);
});

test("repository contains no legal, revenue, messaging, learning, or external effect adapter", () => {
  assert.doesNotMatch(
    source,
    /NotificationAdapter|PaymentAdapter|deliver\(|send\(|completeJson|revenue_share_entries/iu,
  );
});
