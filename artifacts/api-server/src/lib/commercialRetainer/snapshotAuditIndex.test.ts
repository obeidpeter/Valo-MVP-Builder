import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  COMMERCIAL_PAYMENT_RECORDED_EVENT,
  COMMERCIAL_PAYMENT_VERIFIED_EVENT,
  COMMERCIAL_QUOTE_APPROVED_EVENT,
  COMMERCIAL_QUOTE_CREATED_EVENT,
  indexCommercialSnapshotAudits,
  type CommercialSnapshotAuditEvent,
} from "./snapshotAuditIndex";

function event(
  overrides: Partial<CommercialSnapshotAuditEvent> &
    Pick<CommercialSnapshotAuditEvent, "eventType" | "objectId" | "seq">,
): CommercialSnapshotAuditEvent {
  return {
    objectType: "order",
    userId: null,
    details: null,
    createdAt: new Date("2026-08-12T00:00:00.000Z"),
    ...overrides,
  };
}

test("snapshot audit index tolerates duplicates and preserves earliest-created and latest-approved quote semantics", () => {
  const index = indexCommercialSnapshotAudits([
    event({
      eventType: COMMERCIAL_QUOTE_CREATED_EVENT,
      objectId: "order-1",
      seq: 20,
      details: "later",
    }),
    event({
      eventType: COMMERCIAL_QUOTE_APPROVED_EVENT,
      objectId: "order-1",
      seq: 30,
      userId: "checker-latest",
    }),
    event({
      eventType: COMMERCIAL_QUOTE_CREATED_EVENT,
      objectId: "order-1",
      seq: 10,
      details: "earliest",
    }),
    event({
      eventType: COMMERCIAL_QUOTE_APPROVED_EVENT,
      objectId: "order-1",
      seq: 25,
      userId: "checker-earlier",
    }),
  ]);

  assert.equal(index.quoteCreatedByOrderId.get("order-1")?.details, "earliest");
  assert.equal(
    index.quoteApprovedByOrderId.get("order-1")?.userId,
    "checker-latest",
  );
});

test("snapshot audit index tolerates duplicates and preserves earliest payment actor receipts", () => {
  const index = indexCommercialSnapshotAudits([
    event({
      objectType: "payment",
      eventType: COMMERCIAL_PAYMENT_RECORDED_EVENT,
      objectId: "payment-1",
      seq: 12,
      userId: "recorder-later",
    }),
    event({
      objectType: "payment",
      eventType: COMMERCIAL_PAYMENT_VERIFIED_EVENT,
      objectId: "payment-1",
      seq: 14,
      userId: "checker",
    }),
    event({
      objectType: "payment",
      eventType: COMMERCIAL_PAYMENT_RECORDED_EVENT,
      objectId: "payment-1",
      seq: 8,
      userId: "recorder-earliest",
    }),
  ]);

  assert.deepEqual(index.paymentActorsByPaymentId.get("payment-1"), {
    recordedByUserId: "recorder-earliest",
    verifiedByUserId: "checker",
  });
});

test("snapshot audit index ignores unrelated object and event types", () => {
  const index = indexCommercialSnapshotAudits([
    event({
      objectType: "invoice",
      eventType: COMMERCIAL_QUOTE_CREATED_EVENT,
      objectId: "order-1",
      seq: 1,
    }),
    event({
      objectType: "order",
      eventType: "commercial.unrelated.v1",
      objectId: "order-1",
      seq: 2,
    }),
    event({
      objectType: "payment",
      eventType: COMMERCIAL_PAYMENT_RECORDED_EVENT,
      objectId: null,
      seq: 3,
    }),
  ]);

  assert.equal(index.quoteCreatedByOrderId.size, 0);
  assert.equal(index.quoteApprovedByOrderId.size, 0);
  assert.equal(index.paymentActorsByPaymentId.size, 0);
});

test("snapshot materialisation uses one bounded audit read instead of per-record reads", async () => {
  const source = await readFile(
    new URL("./drizzleRepository.ts", import.meta.url),
    "utf8",
  );
  const readSnapshot = source.slice(
    source.indexOf("  async readSnapshot("),
    source.indexOf("\n  async createQuote("),
  );

  assert.equal(
    readSnapshot.match(/loadSnapshotAuditIndex\(/gu)?.length,
    1,
    "readSnapshot must issue one batched audit-index load",
  );
  assert.doesNotMatch(readSnapshot, /quoteRecord\(/u);
  assert.doesNotMatch(readSnapshot, /paymentRecord\(/u);
  assert.match(
    source,
    /async function loadSnapshotAuditIndex[\s\S]*?row_number\(\) over \([\s\S]*?partition by[\s\S]*?case[\s\S]*?COMMERCIAL_QUOTE_APPROVED_EVENT[\s\S]*?then -\$\{auditEvents\.seq\}[\s\S]*?else \$\{auditEvents\.seq\}[\s\S]*?\.as\("ranked_commercial_snapshot_audits"\)[\s\S]*?\.where\(eq\(rankedAudits\.snapshotRank, 1\)\)[\s\S]*?\.limit\(maxRows \+ 1\)[\s\S]*?rows\.length > maxRows[\s\S]*?indexCommercialSnapshotAudits/u,
  );
  const rankFilter = source.indexOf(".where(eq(rankedAudits.snapshotRank, 1))");
  const boundedLimit = source.indexOf(".limit(maxRows + 1)", rankFilter);
  assert.ok(rankFilter >= 0 && boundedLimit > rankFilter);
});
