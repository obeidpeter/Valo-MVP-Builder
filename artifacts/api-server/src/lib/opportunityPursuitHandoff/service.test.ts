import assert from "node:assert/strict";
import test from "node:test";
import {
  OPPORTUNITY_PURSUIT_HANDOFF_AUTHORITY,
  OpportunityPursuitHandoffError,
  type NormalizedOpportunityPursuitHandoffDraft,
  type OpportunityPursuitHandoffPreparation,
  type OpportunityPursuitHandoffRepository,
  type OpportunityPursuitHandoffResult,
  type OpportunityPursuitHandoffScope,
} from "./contracts";
import {
  OpportunityPursuitHandoffService,
  hashOpportunityPursuitHandoff,
} from "./service";

const scope: OpportunityPursuitHandoffScope = {
  organisationId: "11111111-1111-4111-8111-111111111111",
  actorUserId: "22222222-2222-4222-8222-222222222222",
  actorName: "Named Handoff Maker",
  actorMembershipId: "33333333-3333-4333-8333-333333333333",
};
const candidateId = "44444444-4444-4444-8444-444444444444";
const body = {
  expectedCandidateVersion: 2,
  expectedSourceReceiptSha256: "a".repeat(64),
  expectedTenderVersion: 1,
  expectedConflictBoundarySha256: "b".repeat(64),
  clientId: "55555555-5555-4555-8555-555555555555",
  expectedClientVersion: 1,
  tenderLotId: null,
  expectedTenderLotVersion: null,
  confirmedLotReference: null,
  reviewerUserId: "66666666-6666-4666-8666-666666666666",
  officialSourceReopened: true as const,
  confirmedBuyer: "  Representative   Buyer ",
  confirmedReference: " NG-2026-42 ",
  confirmedSubmissionDeadline: "2026-09-01T12:00:00.000Z",
  confirmationNote: " Reopened the official source and checked every field. ",
};

class CapturingRepository implements OpportunityPursuitHandoffRepository {
  captured: NormalizedOpportunityPursuitHandoffDraft | null = null;

  async prepare(): Promise<OpportunityPursuitHandoffPreparation> {
    throw new Error("not used");
  }

  async confirm(
    _scope: OpportunityPursuitHandoffScope,
    _candidateId: string,
    draft: NormalizedOpportunityPursuitHandoffDraft,
  ): Promise<OpportunityPursuitHandoffResult> {
    this.captured = draft;
    throw new OpportunityPursuitHandoffError("conflict", "captured");
  }
}

test("normalizes a closed human confirmation and hashes the key without retaining it", async () => {
  const repository = new CapturingRepository();
  const service = new OpportunityPursuitHandoffService(repository);
  await assert.rejects(
    service.confirm(scope, candidateId, "handoff:2026-08:client-42", body),
    /captured/u,
  );
  assert.ok(repository.captured);
  assert.equal(repository.captured.confirmedBuyer, "Representative Buyer");
  assert.equal(repository.captured.confirmedReference, "NG-2026-42");
  assert.equal(
    repository.captured.idempotencyKeySha256,
    hashOpportunityPursuitHandoff("handoff:2026-08:client-42"),
  );
  assert.match(repository.captured.requestSha256, /^[0-9a-f]{64}$/u);
  assert.equal("idempotencyKey" in repository.captured, false);
});

test("rejects implicit source reopen, malformed CAS and short idempotency keys", async () => {
  const service = new OpportunityPursuitHandoffService(
    new CapturingRepository(),
  );
  await assert.rejects(
    service.confirm(scope, candidateId, "short", {
      ...body,
      officialSourceReopened: false as never,
      expectedCandidateVersion: 0,
    }),
    /handoff confirmation is invalid/u,
  );
});

test("authority contract never activates or fetches a provider", () => {
  assert.deepEqual(OPPORTUNITY_PURSUIT_HANDOFF_AUTHORITY, {
    sourceReopenRequired: true,
    namedHumanConfirmationRequired: true,
    makerCheckerRequired: true,
    conflictRevalidationRequired: true,
    createdPursuitState: "intake",
    pursuitActivated: false,
    providerFetchPerformed: false,
    autonomousPursuitActivationAllowed: false,
  });
});
