import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { CLAIMS_DESK_LEDGER_SCHEMA } from "./contracts";
import {
  createClaimsDeskEventReceipt,
  reduceClaimsDeskLedger,
  type PersistedClaimsDeskLedgerEvent,
} from "./repository";

const ORG = "10000000-0000-4000-8000-000000000001";
const PROJECT = "20000000-0000-4000-8000-000000000002";
const RECORD = "30000000-0000-4000-8000-000000000003";
const ACTOR = "40000000-0000-4000-8000-000000000004";
const MEMBER = "50000000-0000-4000-8000-000000000005";
const DOC = "60000000-0000-4000-8000-000000000006";
const SHA = "a".repeat(64);

function seal(
  event: Omit<PersistedClaimsDeskLedgerEvent, "receiptSha256">,
): PersistedClaimsDeskLedgerEvent {
  return { ...event, receiptSha256: createClaimsDeskEventReceipt(event) };
}

function genesis(): PersistedClaimsDeskLedgerEvent {
  return seal({
    schema: CLAIMS_DESK_LEDGER_SCHEMA,
    eventId: "70000000-0000-4000-8000-000000000007",
    recordId: RECORD,
    aggregateVersion: 1,
    kind: "record_created",
    organisationId: ORG,
    projectId: PROJECT,
    occurredAt: "2026-08-01T12:00:00.000Z",
    actorUserId: ACTOR,
    actorMembershipId: MEMBER,
    idempotencyKeySha256: "b".repeat(64),
    requestSha256: "c".repeat(64),
    previousReceiptSha256: "0".repeat(64),
    creation: {
      recordType: "claim",
      reference: "CLM-1",
      eventDate: "2026-08-01",
      dueAt: null,
      amountMinor: 10_000,
      currency: "NGN",
      documentBindings: [{ documentId: DOC, sha256: SHA }],
    },
    transition: null,
  });
}

function transition(
  first: PersistedClaimsDeskLedgerEvent,
): PersistedClaimsDeskLedgerEvent {
  return seal({
    schema: CLAIMS_DESK_LEDGER_SCHEMA,
    eventId: "80000000-0000-4000-8000-000000000008",
    recordId: RECORD,
    aggregateVersion: 2,
    kind: "transition_recorded",
    organisationId: ORG,
    projectId: PROJECT,
    occurredAt: "2026-08-02T12:00:00.000Z",
    actorUserId: ACTOR,
    actorMembershipId: MEMBER,
    idempotencyKeySha256: "d".repeat(64),
    requestSha256: "e".repeat(64),
    previousReceiptSha256: first.receiptSha256,
    creation: null,
    transition: {
      action: "start_review",
      reasonCode: "evidence_received",
      assessmentCode: null,
      documentBindings: [{ documentId: DOC, sha256: SHA }],
      fromStatus: "registered",
      toStatus: "under_review",
      resultingAssessmentCode: null,
      pendingMakerUserId: null,
    },
  });
}

describe("Claims Desk append-only reducer", () => {
  test("reconstructs an aggregate and reason history from digest-linked events", () => {
    const first = genesis();
    const record = reduceClaimsDeskLedger([transition(first), first])[0];
    assert.equal(record?.status, "under_review");
    assert.equal(record?.version, 2);
    assert.equal(record?.reasonHistory.length, 1);
    assert.equal(record?.latestReceiptSha256, transition(first).receiptSha256);
  });

  test("fails closed on a broken previous digest or duplicate idempotency evidence", () => {
    const first = genesis();
    const next = transition(first);
    assert.throws(() =>
      reduceClaimsDeskLedger([
        first,
        { ...next, previousReceiptSha256: "f".repeat(64) },
      ]),
    );
    assert.throws(() =>
      reduceClaimsDeskLedger([
        first,
        { ...next, idempotencyKeySha256: first.idempotencyKeySha256 },
      ]),
    );
  });

  test("fails closed when persisted workflow claims an impossible transition", () => {
    const first = genesis();
    const next = transition(first);
    assert.throws(() =>
      reduceClaimsDeskLedger([
        first,
        {
          ...next,
          transition: next.transition
            ? { ...next.transition, toStatus: "closed" }
            : null,
        },
      ]),
    );
  });
});
