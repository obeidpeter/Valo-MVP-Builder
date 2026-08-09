import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateDefectDecision,
  isDirectDefectMutationAllowed,
  type DefectDecisionInput,
} from "./defectGovernance";

const decision = (overrides: Partial<DefectDecisionInput> = {}) =>
  evaluateDefectDecision({
    action: "reclassify",
    currentSeverity: "fatal",
    proposedSeverity: "scoring_risk",
    initiatedBy: "analyst-1",
    approvedBy: "reviewer-1",
    approverRole: "valo_quality_adviser",
    initiatorIsHuman: true,
    approverIsHuman: true,
    reason: "The tender addendum removes the mandatory condition.",
    evidenceIds: ["addendum-2-clause-4"],
    ...overrides,
  });

test("fatal downgrade requires reason, evidence, and independent human approval", () => {
  assert.equal(decision().allowed, true);
  assert.equal(decision({ reason: " " }).code, "reason_required");
  assert.equal(decision({ evidenceIds: [] }).code, "evidence_required");
  assert.equal(
    decision({ approvedBy: "analyst-1" }).code,
    "independent_approval_required",
  );
  assert.equal(
    decision({ approverIsHuman: false }).code,
    "human_actor_required",
  );
  assert.equal(
    decision({ approverRole: "contributor" }).code,
    "approver_role_insufficient",
  );
});

test("AI cannot initiate a defect decision", () => {
  assert.equal(
    decision({ initiatorIsHuman: false }).code,
    "human_actor_required",
  );
});

test("defect deletion is prohibited at every severity", () => {
  assert.equal(decision({ action: "delete" }).code, "deletion_prohibited");
  assert.equal(
    decision({ action: "delete", currentSeverity: "cosmetic" }).code,
    "deletion_prohibited",
  );
});

test("upward reclassification is recorded but does not require a second approver", () => {
  const result = decision({
    currentSeverity: "scoring_risk",
    proposedSeverity: "fatal",
    approvedBy: null,
    approverRole: null,
    evidenceIds: [],
  });
  assert.equal(result.allowed, true);
  assert.equal(result.requiresIndependentApproval, false);
});

test("fatal remediation retains independent approval and evidence controls", () => {
  assert.equal(
    decision({ action: "remediate", proposedSeverity: null }).allowed,
    true,
  );
  assert.equal(
    decision({ action: "remediate", proposedSeverity: null, evidenceIds: [] })
      .code,
    "evidence_required",
  );
});

test("generic defect mutation can confirm or escalate but cannot dispose or downgrade", () => {
  assert.equal(
    isDirectDefectMutationAllowed({
      currentStatus: "suggested",
      proposedStatus: "open",
      currentSeverity: "scoring_risk",
    }),
    true,
  );
  assert.equal(
    isDirectDefectMutationAllowed({
      currentStatus: "open",
      currentSeverity: "scoring_risk",
      proposedSeverity: "fatal",
    }),
    true,
  );
  assert.equal(
    isDirectDefectMutationAllowed({
      currentStatus: "open",
      proposedStatus: "waived",
      currentSeverity: "fatal",
    }),
    false,
  );
  assert.equal(
    isDirectDefectMutationAllowed({
      currentStatus: "open",
      currentSeverity: "fatal",
      proposedSeverity: "likely_fatal",
    }),
    false,
  );
});
