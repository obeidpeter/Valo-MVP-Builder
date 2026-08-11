import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { ClaimsDeskRecord } from "./contracts";
import {
  buildClaimsDeskPosture,
  claimsDeskSha256,
  decideClaimsDeskTransition,
  deterministicClaimsDeskUuid,
  parseClaimsDeskCreateDraft,
  parseClaimsDeskTransitionDraft,
} from "./service";

const DOCUMENT_ID = "10000000-0000-4000-8000-000000000001";
const SHA = "a".repeat(64);

const binding = [{ documentId: DOCUMENT_ID, sha256: SHA }];

function record(status: ClaimsDeskRecord["status"]): ClaimsDeskRecord {
  return {
    id: "20000000-0000-4000-8000-000000000002",
    organisationId: "30000000-0000-4000-8000-000000000003",
    projectId: "40000000-0000-4000-8000-000000000004",
    recordType: "claim",
    reference: "CLM-001",
    eventDate: "2026-08-01",
    dueAt: "2026-08-20T12:00:00.000Z",
    amountMinor: 125_000,
    currency: "NGN",
    documentBindings: binding,
    status,
    assessmentCode: null,
    pendingMakerUserId: null,
    version: 1,
    createdByUserId: "50000000-0000-4000-8000-000000000005",
    createdAt: "2026-08-01T12:00:00.000Z",
    updatedAt: "2026-08-01T12:00:00.000Z",
    latestReceiptSha256: SHA,
    reasonHistory: [],
  };
}

describe("Claims Desk closed input contracts", () => {
  test("accepts bounded integer-minor amounts and canonical evidence", () => {
    const parsed = parseClaimsDeskCreateDraft({
      recordType: "claim",
      reference: "CLM-001",
      eventDate: "2026-08-01",
      dueAt: "2026-08-20T12:00:00.000Z",
      amountMinor: 125_000,
      currency: "NGN",
      documentBindings: binding,
      idempotencyKey: "claim-create-0001",
    });
    assert.equal(parsed?.amountMinor, 125_000);
    assert.equal(parsed?.currency, "NGN");
  });

  test("rejects decimals, unknown currency, missing deadlines and extra keys", () => {
    const base = {
      recordType: "notice_deadline",
      reference: "NOTICE-1",
      eventDate: "2026-08-01",
      dueAt: null,
      amountMinor: null,
      currency: null,
      documentBindings: binding,
      idempotencyKey: "notice-create-01",
    };
    assert.equal(parseClaimsDeskCreateDraft(base), null);
    assert.equal(
      parseClaimsDeskCreateDraft({
        ...base,
        recordType: "claim",
        amountMinor: 1.5,
        currency: "NGN",
      }),
      null,
    );
    assert.equal(
      parseClaimsDeskCreateDraft({
        ...base,
        recordType: "claim",
        amountMinor: 10,
        currency: "ZZZ",
      }),
      null,
    );
    assert.equal(
      parseClaimsDeskCreateDraft({ ...base, unexpected: "content" }),
      null,
    );
  });

  test("requires assessment code only on a human proposal", () => {
    assert.ok(
      parseClaimsDeskTransitionDraft({
        action: "propose_assessment",
        reasonCode: "assessment_ready",
        assessmentCode: "requires_further_review",
        documentBindings: binding,
        idempotencyKey: "assessment-0001",
      }),
    );
    assert.equal(
      parseClaimsDeskTransitionDraft({
        action: "approve_assessment",
        reasonCode: "assessment_checked",
        assessmentCode: "commercial_position_recorded",
        documentBindings: binding,
        idempotencyKey: "assessment-0002",
      }),
      null,
    );
  });
});

describe("Claims Desk controlled workflow", () => {
  test("enforces maker-checker on assessment and closure", () => {
    const proposed = {
      ...record("assessment_proposed"),
      pendingMakerUserId: "maker",
      assessmentCode: "commercial_position_recorded" as const,
    };
    const approval = {
      action: "approve_assessment" as const,
      reasonCode: "assessment_checked" as const,
      assessmentCode: null,
      documentBindings: binding,
      idempotencyKey: "approve-assessment-1",
    };
    assert.equal(
      decideClaimsDeskTransition(proposed, approval, "maker"),
      "maker_checker_conflict",
    );
    assert.deepEqual(
      decideClaimsDeskTransition(proposed, approval, "checker"),
      {
        fromStatus: "assessment_proposed",
        toStatus: "assessed",
        assessmentCode: "commercial_position_recorded",
        pendingMakerUserId: null,
      },
    );

    const closing = {
      ...record("closure_proposed"),
      pendingMakerUserId: "maker",
    };
    assert.equal(
      decideClaimsDeskTransition(
        closing,
        {
          ...approval,
          action: "approve_closure",
          reasonCode: "closure_checked",
        },
        "maker",
      ),
      "maker_checker_conflict",
    );
  });

  test("does not permit skipping controlled states", () => {
    assert.equal(
      decideClaimsDeskTransition(
        record("registered"),
        {
          action: "approve_closure",
          reasonCode: "closure_checked",
          assessmentCode: null,
          documentBindings: binding,
          idempotencyKey: "skip-state-0001",
        },
        "checker",
      ),
      "state_conflict",
    );
  });

  test("derives bounded posture and stable digests deterministically", () => {
    const open = record("under_review");
    const posture = buildClaimsDeskPosture(
      [open, { ...record("closed"), id: "closed" }],
      new Date("2026-08-21T00:00:00.000Z"),
    );
    assert.deepEqual(posture, {
      total: 2,
      open: 1,
      overdue: 1,
      dueSoon: 0,
      awaitingChecker: 0,
      terminal: 1,
    });
    assert.equal(
      claimsDeskSha256({ b: 2, a: 1 }),
      claimsDeskSha256({ a: 1, b: 2 }),
    );
    assert.match(deterministicClaimsDeskUuid("stable"), /^[0-9a-f-]{36}$/u);
  });
});
