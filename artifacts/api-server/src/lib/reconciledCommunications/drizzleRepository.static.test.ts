import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./drizzleRepository.ts", import.meta.url),
  "utf8",
);

test("durable communications reuse scoped notification ledgers with CAS and atomic audit", () => {
  assert.match(source, /notificationEvents/u);
  assert.match(source, /notificationAttempts/u);
  assert.match(source, /eq\(notificationEvents\.organisationId/u);
  assert.match(source, /eq\(notificationEvents\.projectId/u);
  assert.match(source, /eq\(notificationEvents\.version, current\.version\)/u);
  assert.match(source, /writeAuditTx\(tx/u);
  assert.match(source, /attempt_prepared/u);
  assert.match(source, /preEffectRecordCommitted: true/u);
});

test("repository persists only a user reference and requires direct consented authority", () => {
  assert.match(
    source,
    /recipient: `user:\$\{record\.event\.recipientUserId\}`/u,
  );
  assert.match(
    source,
    /isNull\(organisationMemberships\.delegatedByMembershipId\)/u,
  );
  assert.match(source, /eq\(consentRecords\.evidenceHash/u);
  assert.match(source, /isNull\(consentRecords\.withdrawnAt\)/u);
  assert.match(source, /input\.channel !== "email"/u);
  assert.doesNotMatch(source, /recipientEmail|phoneNumber|messageBody/u);
});

test("only verified reconciliation may persist a delivered state", () => {
  assert.match(source, /deliveryAuthority: "verified_provider_receipt_only"/u);
  assert.match(source, /receipt_verified_delivered/u);
  assert.match(source, /input\.outcome === "delivered"/u);
  assert.match(source, /deliveryClaimed: input\.outcome === "delivered"/u);
});

test("reference choices are bounded, consented, named, and canonical", () => {
  assert.match(source, /loadDbCommunicationReferences/u);
  assert.match(source, /COMMUNICATION_BOUNDS\.referenceItems \+ 1/u);
  assert.match(source, /purpose, "notification:email"/u);
  assert.match(source, /safeReferenceName/u);
  assert.match(source, /CLIENT_ACTION_TITLE_PREFIX/u);
  assert.match(source, /eq\(packageVersions\.renderQaStatus, "passed"\)/u);
  assert.match(source, /deliveryReceiptHash/u);
});
