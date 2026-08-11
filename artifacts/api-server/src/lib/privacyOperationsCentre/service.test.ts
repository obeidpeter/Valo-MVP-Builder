import assert from "node:assert/strict";
import test from "node:test";
import type {
  PrivacyOperationsRawDashboard,
  PrivacyOperationsRepository,
  PrivacyOperationsScope,
} from "./contracts";
import { PrivacyOperationsRepositoryUnavailableError } from "./contracts";
import {
  PrivacyOperationsValidationError,
  buildPrivacyOperationsDashboard,
  createPrivacyWorkflowAuditDetails,
  parsePrivacyConsentWithdrawalDraft,
  parsePrivacyDsrTriageDraft,
  parsePrivacyHoldReviewDraft,
  recordPrivacyConsentWithdrawal,
  recordPrivacyLegalHoldReview,
  triagePrivacyDsr,
} from "./service";

const ORGANISATION_ID = "10000000-0000-4000-8000-000000000001";
const ACTOR_ID = "20000000-0000-4000-8000-000000000002";
const ASSIGNEE_ID = "30000000-0000-4000-8000-000000000003";
const DSR_ID = "40000000-0000-4000-8000-000000000004";
const CONSENT_ID = "50000000-0000-4000-8000-000000000005";
const HOLD_ID = "60000000-0000-4000-8000-000000000006";
const SHA_A = "a".repeat(64);
const NOW = new Date("2026-08-11T12:00:00.000Z");
const SCOPE: PrivacyOperationsScope = {
  organisationId: ORGANISATION_ID,
  actorUserId: ACTOR_ID,
};

function rawDashboard(): PrivacyOperationsRawDashboard {
  const withdrawal = createPrivacyWorkflowAuditDetails({
    eventType: "privacy.consent_withdrawal_recorded",
    objectId: CONSENT_ID,
    actorUserId: ACTOR_ID,
    recordedAt: "2026-08-10T12:00:00.000Z",
    resultingVersion: 2,
    payload: {
      evidenceSha256: SHA_A,
      expectedVersion: 1,
      withdrawnAt: "2026-08-10T11:00:00.000Z",
    },
  });
  return {
    totals: {
      dataSubjectRequests: 1,
      consentRecords: 1,
      legalHolds: 1,
      subprocessors: 1,
      crossBorderTransfers: 1,
      deletionActions: 1,
    },
    dataSubjectRequests: [
      {
        organisationId: ORGANISATION_ID,
        id: DSR_ID,
        requestType: "access",
        identityVerificationStatus: "pending",
        receivedAt: new Date("2026-08-01T12:00:00.000Z"),
        dueAt: new Date("2026-08-10T12:00:00.000Z"),
        status: "received",
        assignedToUserId: null,
        responseEvidencePresent: true,
        responseEvidenceSha256: null,
        completedAt: null,
        version: 1,
        updatedAt: new Date("2026-08-01T12:00:00.000Z"),
      },
    ],
    consentRecords: [
      {
        organisationId: ORGANISATION_ID,
        id: CONSENT_ID,
        privacyRecordId: null,
        capturedAt: new Date("2026-07-01T12:00:00.000Z"),
        withdrawnAt: new Date("2026-08-10T11:00:00.000Z"),
        evidenceHash: SHA_A,
        version: 2,
        updatedAt: new Date("2026-08-10T12:00:00.000Z"),
      },
    ],
    legalHolds: [
      {
        organisationId: ORGANISATION_ID,
        id: HOLD_ID,
        projectId: null,
        status: "active",
        placedByUserId: ACTOR_ID,
        releasedByUserId: null,
        releasedAt: null,
        version: 1,
        createdAt: new Date("2026-07-01T12:00:00.000Z"),
        updatedAt: new Date("2026-07-01T12:00:00.000Z"),
      },
    ],
    subprocessors: [
      {
        organisationId: ORGANISATION_ID,
        id: "70000000-0000-4000-8000-000000000007",
        legalName: "Example Processor Ltd",
        service: "Document processing",
        countryCode: "NG",
        dpaStatus: "approved",
        securityReviewStatus: "approved",
        approvedAt: new Date("2026-01-01T12:00:00.000Z"),
        nextReviewAt: new Date("2026-08-01T12:00:00.000Z"),
        version: 1,
        updatedAt: new Date("2026-01-01T12:00:00.000Z"),
      },
    ],
    crossBorderTransfers: [
      {
        organisationId: ORGANISATION_ID,
        id: "80000000-0000-4000-8000-000000000008",
        subprocessorId: null,
        originCountry: "NG",
        destinationCountry: "IE",
        transferBasis: "contractual_safeguards",
        approvalEvidencePresent: false,
        approvalEvidenceSha256: null,
        legalReviewStatus: "pending",
        nextReviewAt: new Date("2026-09-30T12:00:00.000Z"),
        version: 1,
        updatedAt: new Date("2026-08-01T12:00:00.000Z"),
      },
    ],
    deletionActions: [
      {
        organisationId: ORGANISATION_ID,
        id: "90000000-0000-4000-8000-000000000009",
        status: "completed",
        legalHoldId: null,
        executedByUserId: ACTOR_ID,
        executedAt: new Date("2026-08-09T12:00:00.000Z"),
        version: 2,
        updatedAt: new Date("2026-08-09T12:00:00.000Z"),
        certificates: [],
      },
    ],
    auditRows: [
      {
        organisationId: ORGANISATION_ID,
        objectId: CONSENT_ID,
        eventType: "privacy.consent_withdrawal_recorded",
        details: withdrawal.details,
        seq: 14,
        hash: "b".repeat(64),
        createdAt: new Date("2026-08-10T12:00:00.000Z"),
      },
    ],
  };
}

test("bounded dashboard exposes posture and receipts without raw subject PII", () => {
  const snapshot = buildPrivacyOperationsDashboard({
    raw: rawDashboard(),
    scope: SCOPE,
    limit: 25,
    now: NOW,
  });
  assert.equal(snapshot.legalDecisionAutomated, false);
  assert.equal(snapshot.rawSubjectPiiIncluded, false);
  assert.equal(snapshot.dataSubjectRequests[0]?.urgency, "overdue");
  assert.equal(
    snapshot.dataSubjectRequests[0]?.responseEvidenceState,
    "invalid",
  );
  assert.equal(snapshot.consentRecords[0]?.withdrawalReceiptState, "verified");
  assert.equal(snapshot.legalHolds[0]?.reviewPosture, "missing_review_date");
  assert.equal(snapshot.subprocessors[0]?.reviewPosture, "overdue");
  assert.equal(snapshot.deletionActions[0]?.receiptState, "missing");
  assert.equal(JSON.stringify(snapshot).includes("subjectReference"), false);
  assert.equal(JSON.stringify(snapshot).includes("requesterReference"), false);
  assert.ok(snapshot.blockers.length >= 4);
});

test("dashboard fails closed on cross-tenant rows and over-bounded repositories", () => {
  const crossTenant = rawDashboard();
  crossTenant.dataSubjectRequests[0]!.organisationId =
    "a0000000-0000-4000-8000-00000000000a";
  assert.throws(() =>
    buildPrivacyOperationsDashboard({
      raw: crossTenant,
      scope: SCOPE,
      limit: 25,
      now: NOW,
    }),
  );

  const overBounded = rawDashboard();
  overBounded.consentRecords = Array.from(
    { length: 27 },
    () => overBounded.consentRecords[0]!,
  );
  assert.throws(() =>
    buildPrivacyOperationsDashboard({
      raw: overBounded,
      scope: SCOPE,
      limit: 25,
      now: NOW,
    }),
  );
});

test("workflow parsers are closed and require digests rather than narrative PII", () => {
  const triage = {
    status: "triaged",
    identityVerificationStatus: "verified",
    assignedToUserId: ASSIGNEE_ID,
    reasonCode: "initial_triage",
    decisionEvidenceSha256: SHA_A,
  };
  assert.deepEqual(parsePrivacyDsrTriageDraft(triage), triage);
  assert.equal(
    parsePrivacyDsrTriageDraft({ ...triage, notes: "raw data" }),
    null,
  );
  assert.deepEqual(
    parsePrivacyConsentWithdrawalDraft({
      withdrawnAt: "2026-08-10T11:00:00Z",
      evidenceSha256: SHA_A,
    }),
    {
      withdrawnAt: "2026-08-10T11:00:00.000Z",
      evidenceSha256: SHA_A,
    },
  );
  assert.ok(
    parsePrivacyHoldReviewDraft({
      reviewOutcome: "continue",
      nextReviewAt: "2026-09-01T12:00:00.000Z",
      evidenceSha256: SHA_A,
    }),
  );
});

test("named-human services pass CAS commands and reject unsafe time windows", async () => {
  const commands: unknown[] = [];
  const repository: PrivacyOperationsRepository = {
    listAssignees: async () => [],
    readDashboard: async () => rawDashboard(),
    triageDataSubjectRequest: async (_scope, command) => {
      commands.push(command);
      return {
        outcome: "updated",
        resultingVersion: 2,
        receipt: createPrivacyWorkflowAuditDetails({
          eventType: "privacy.dsr_triage_recorded",
          objectId: command.id,
          actorUserId: ACTOR_ID,
          recordedAt: command.recordedAt,
          resultingVersion: 2,
          payload: {
            assignedToUserId: command.assignedToUserId,
            decisionEvidenceSha256: command.decisionEvidenceSha256,
            expectedVersion: command.expectedVersion,
            identityVerificationStatus: command.identityVerificationStatus,
            reasonCode: command.reasonCode,
            status: command.status,
          },
        }).receipt,
      };
    },
    recordConsentWithdrawal: async (_scope, command) => {
      commands.push(command);
      return { outcome: "state_conflict" };
    },
    recordLegalHoldReview: async (_scope, command) => {
      commands.push(command);
      return {
        outcome: "updated",
        resultingVersion: 2,
        receipt: createPrivacyWorkflowAuditDetails({
          eventType: "privacy.legal_hold_review_recorded",
          objectId: command.id,
          actorUserId: ACTOR_ID,
          recordedAt: command.recordedAt,
          resultingVersion: 2,
          payload: {},
        }).receipt,
      };
    },
  };

  await triagePrivacyDsr({
    repository,
    scope: SCOPE,
    id: DSR_ID,
    expectedVersion: 1,
    draft: parsePrivacyDsrTriageDraft({
      status: "triaged",
      identityVerificationStatus: "pending",
      assignedToUserId: ASSIGNEE_ID,
      reasonCode: "initial_triage",
      decisionEvidenceSha256: SHA_A,
    })!,
    now: NOW,
  });
  assert.equal((commands[0] as { expectedVersion: number }).expectedVersion, 1);

  await assert.rejects(
    recordPrivacyConsentWithdrawal({
      repository,
      scope: SCOPE,
      id: CONSENT_ID,
      expectedVersion: 1,
      draft: {
        withdrawnAt: "2026-08-12T12:00:00.000Z",
        evidenceSha256: SHA_A,
      },
      now: NOW,
    }),
    (error: unknown) =>
      error instanceof PrivacyOperationsValidationError &&
      error.code === "INVALID_TIME",
  );
  await assert.rejects(
    recordPrivacyLegalHoldReview({
      repository,
      scope: SCOPE,
      id: HOLD_ID,
      expectedVersion: 1,
      draft: {
        reviewOutcome: "continue",
        nextReviewAt: "2028-08-11T12:00:00.000Z",
        evidenceSha256: SHA_A,
      },
      now: NOW,
    }),
    (error: unknown) =>
      error instanceof PrivacyOperationsValidationError &&
      error.code === "INVALID_REVIEW_WINDOW",
  );
});

test("workflow receipt is deterministic, immutable and explicitly non-legal", () => {
  const input = {
    eventType: "privacy.legal_hold_review_recorded" as const,
    objectId: HOLD_ID,
    actorUserId: ACTOR_ID,
    recordedAt: NOW.toISOString(),
    resultingVersion: 2,
    payload: {
      evidenceSha256: SHA_A,
      reviewOutcome: "continue",
    },
  };
  const first = createPrivacyWorkflowAuditDetails(input);
  const second = createPrivacyWorkflowAuditDetails(input);
  assert.equal(first.receipt.receiptSha256, second.receipt.receiptSha256);
  assert.equal(first.receipt.legalDecisionAutomated, false);
  assert.notEqual(
    first.receipt.receiptSha256,
    createPrivacyWorkflowAuditDetails({
      ...input,
      payload: { ...input.payload, reviewOutcome: "release_recommended" },
    }).receipt.receiptSha256,
  );
});

test("service rejects a repository receipt that is not bound to the exact workflow", async () => {
  const repository: PrivacyOperationsRepository = {
    listAssignees: async () => [],
    readDashboard: async () => rawDashboard(),
    triageDataSubjectRequest: async (_scope, command) => ({
      outcome: "updated",
      resultingVersion: 2,
      receipt: {
        ...createPrivacyWorkflowAuditDetails({
          eventType: "privacy.dsr_triage_recorded",
          objectId: command.id,
          actorUserId: ACTOR_ID,
          recordedAt: command.recordedAt,
          resultingVersion: 2,
          payload: {
            assignedToUserId: command.assignedToUserId,
            decisionEvidenceSha256: command.decisionEvidenceSha256,
            expectedVersion: command.expectedVersion,
            identityVerificationStatus: command.identityVerificationStatus,
            reasonCode: command.reasonCode,
            status: command.status,
          },
        }).receipt,
        receiptSha256: "f".repeat(64),
      },
    }),
    recordConsentWithdrawal: async () => ({ outcome: "state_conflict" }),
    recordLegalHoldReview: async () => ({ outcome: "state_conflict" }),
  };
  await assert.rejects(
    triagePrivacyDsr({
      repository,
      scope: SCOPE,
      id: DSR_ID,
      expectedVersion: 1,
      draft: parsePrivacyDsrTriageDraft({
        status: "triaged",
        identityVerificationStatus: "pending",
        assignedToUserId: ASSIGNEE_ID,
        reasonCode: "initial_triage",
        decisionEvidenceSha256: SHA_A,
      })!,
      now: NOW,
    }),
    PrivacyOperationsRepositoryUnavailableError,
  );
});
