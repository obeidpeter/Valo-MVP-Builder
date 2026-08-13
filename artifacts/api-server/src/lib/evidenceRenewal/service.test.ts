import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  EVIDENCE_RENEWAL_LEDGER_SCHEMA,
  EvidenceRenewalUnavailableError,
} from "./contracts";
import {
  ZERO_SHA256,
  createEvidenceRenewalEventReceipt,
  parseEvidenceRenewalCreateDraft,
  parseEvidenceRenewalReviewDraft,
  parseEvidenceRenewalStageDraft,
  reduceEvidenceRenewalLedger,
  type PersistedEvidenceRenewalEvent,
} from "./service";

const ORGANISATION_ID = "10000000-0000-4000-8000-000000000001";
const PROJECT_ID = "20000000-0000-4000-8000-000000000002";
const VAULT_ITEM_ID = "30000000-0000-4000-8000-000000000003";
const OWNER_ID = "40000000-0000-4000-8000-000000000004";
const VERIFIER_ID = "50000000-0000-4000-8000-000000000005";
const OWNER_MEMBERSHIP_ID = "60000000-0000-4000-8000-000000000006";
const VERIFIER_MEMBERSHIP_ID = "70000000-0000-4000-8000-000000000007";
const PLAN_ID = "80000000-0000-4000-8000-000000000008";
const DOCUMENT_ID = "90000000-0000-4000-8000-000000000009";
const DOCUMENT_VERSION_ID = "a0000000-0000-4000-8000-00000000000a";
const SHA = "a".repeat(64);

function seal(
  event: Omit<PersistedEvidenceRenewalEvent, "receiptSha256">,
): PersistedEvidenceRenewalEvent {
  return { ...event, receiptSha256: createEvidenceRenewalEventReceipt(event) };
}

function genesis(): PersistedEvidenceRenewalEvent {
  return seal({
    schema: EVIDENCE_RENEWAL_LEDGER_SCHEMA,
    eventId: "c0000000-0000-4000-8000-00000000000c",
    planId: PLAN_ID,
    aggregateVersion: 1,
    kind: "plan_created",
    organisationId: ORGANISATION_ID,
    projectId: PROJECT_ID,
    occurredAt: "2026-08-13T08:00:00.000Z",
    actorUserId: OWNER_ID,
    actorMembershipId: OWNER_MEMBERSHIP_ID,
    idempotencyKeySha256: "1".repeat(64),
    requestSha256: "2".repeat(64),
    previousReceiptSha256: ZERO_SHA256,
    creation: {
      vaultItemId: VAULT_ITEM_ID,
      ownerUserId: OWNER_ID,
      ownerMembershipId: OWNER_MEMBERSHIP_ID,
      verifierUserId: VERIFIER_ID,
      targetDate: "2026-09-01",
      reminderDueAt: "2026-09-01T16:00:00.000Z",
      affectedPursuits: [{ projectId: PROJECT_ID, impact: "blocked" }],
    },
    stage: null,
    review: null,
  });
}

function stage(previous: PersistedEvidenceRenewalEvent) {
  return seal({
    schema: EVIDENCE_RENEWAL_LEDGER_SCHEMA,
    eventId: "d0000000-0000-4000-8000-00000000000d",
    planId: PLAN_ID,
    aggregateVersion: 2,
    kind: "replacement_staged",
    organisationId: ORGANISATION_ID,
    projectId: PROJECT_ID,
    occurredAt: "2026-08-14T08:00:00.000Z",
    actorUserId: OWNER_ID,
    actorMembershipId: OWNER_MEMBERSHIP_ID,
    idempotencyKeySha256: "3".repeat(64),
    requestSha256: "4".repeat(64),
    previousReceiptSha256: previous.receiptSha256,
    creation: null,
    stage: {
      documentId: DOCUMENT_ID,
      documentVersionId: DOCUMENT_VERSION_ID,
      documentVersionNumber: 3,
      sha256: SHA,
      issueDate: "2026-08-12",
      expiryDate: "2027-08-12",
      expectedVaultItemVersion: 4,
    },
    review: null,
  });
}

function review(previous: PersistedEvidenceRenewalEvent, actor = VERIFIER_ID) {
  return seal({
    schema: EVIDENCE_RENEWAL_LEDGER_SCHEMA,
    eventId: "e0000000-0000-4000-8000-00000000000e",
    planId: PLAN_ID,
    aggregateVersion: 3,
    kind: "replacement_reviewed",
    organisationId: ORGANISATION_ID,
    projectId: PROJECT_ID,
    occurredAt: "2026-08-15T08:00:00.000Z",
    actorUserId: actor,
    actorMembershipId: VERIFIER_MEMBERSHIP_ID,
    idempotencyKeySha256: "5".repeat(64),
    requestSha256: "6".repeat(64),
    previousReceiptSha256: previous.receiptSha256,
    creation: null,
    stage: null,
    review: { decision: "approve", reasonCode: "replacement_verified" },
  });
}

describe("evidence-renewal closed input contracts", () => {
  test("accepts a named owner/checker plan and rejects ambiguous authority", () => {
    const draft = {
      vaultItemId: VAULT_ITEM_ID,
      ownerUserId: OWNER_ID,
      verifierUserId: VERIFIER_ID,
      targetDate: "2026-09-01",
      affectedPursuits: [{ projectId: PROJECT_ID, impact: "at_risk" }],
      idempotencyKey: "renewal-plan-0001",
    };
    assert.deepEqual(parseEvidenceRenewalCreateDraft(draft), draft);
    assert.equal(
      parseEvidenceRenewalCreateDraft({
        ...draft,
        verifierUserId: OWNER_ID,
      }),
      null,
    );
    assert.equal(
      parseEvidenceRenewalCreateDraft({ ...draft, unexpected: true }),
      null,
    );
  });

  test("requires a current-looking replacement window and matched review reason", () => {
    assert.ok(
      parseEvidenceRenewalStageDraft({
        documentId: DOCUMENT_ID,
        sha256: SHA,
        issueDate: "2026-08-12",
        expiryDate: "2027-08-12",
        idempotencyKey: "renewal-stage-0001",
      }),
    );
    assert.equal(
      parseEvidenceRenewalStageDraft({
        documentId: DOCUMENT_ID,
        sha256: SHA,
        issueDate: "2027-08-12",
        expiryDate: "2026-08-12",
        idempotencyKey: "renewal-stage-0001",
      }),
      null,
    );
    assert.ok(
      parseEvidenceRenewalReviewDraft({
        decision: "approve",
        reasonCode: "replacement_verified",
        idempotencyKey: "renewal-review-001",
      }),
    );
    assert.equal(
      parseEvidenceRenewalReviewDraft({
        decision: "approve",
        reasonCode: "quality_issue",
        idempotencyKey: "renewal-review-001",
      }),
      null,
    );
  });
});

describe("evidence-renewal deterministic ledger", () => {
  test("reduces plan, stage and independent approval into an immutable receipt chain", () => {
    const created = genesis();
    const staged = stage(created);
    const approved = review(staged);
    const [plan] = reduceEvidenceRenewalLedger([approved, created, staged]);
    assert.equal(plan?.status, "promoted");
    assert.equal(plan?.version, 3);
    assert.equal(plan?.ownerMembershipId, OWNER_MEMBERSHIP_ID);
    assert.equal(plan?.reminderDueAt, "2026-09-01T16:00:00.000Z");
    assert.equal(plan?.stagedReplacement?.sha256, SHA);
    assert.equal(plan?.promotionReceiptSha256, approved.receiptSha256);
    assert.deepEqual(
      plan?.receipts.map(({ version }) => version),
      [1, 2, 3],
    );
  });

  test("fails closed on maker-checker reuse or a broken previous receipt", () => {
    const created = genesis();
    const staged = stage(created);
    assert.throws(
      () =>
        reduceEvidenceRenewalLedger([
          created,
          staged,
          review(staged, OWNER_ID),
        ]),
      EvidenceRenewalUnavailableError,
    );
    const broken = review(staged);
    broken.previousReceiptSha256 = "f".repeat(64);
    broken.receiptSha256 = createEvidenceRenewalEventReceipt(
      (({ receiptSha256: _receipt, ...event }) => event)(broken),
    );
    assert.throws(
      () => reduceEvidenceRenewalLedger([created, staged, broken]),
      /receipt chain/u,
    );
  });
});
