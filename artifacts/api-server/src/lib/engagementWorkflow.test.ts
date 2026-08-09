import assert from "node:assert/strict";
import test from "node:test";
import {
  ENGAGEMENT_STAGES,
  evaluateEngagementTransition,
} from "./engagementWorkflow";

test("every ordinary lifecycle step advances exactly once", () => {
  for (let index = 0; index < ENGAGEMENT_STAGES.length - 1; index += 1) {
    const from = ENGAGEMENT_STAGES[index];
    const to = ENGAGEMENT_STAGES[index + 1];
    const result = evaluateEngagementTransition({
      from,
      to,
      event: "progress",
      currentVersion: index,
      expectedVersion: index,
      readinessGatePassed: to === "named_signoff" ? true : undefined,
      ownerApproved: to === "archived" ? true : undefined,
    });
    if (to === "archived") {
      assert.equal(result.allowed, false);
      assert.equal(result.code, "invalid_transition");
    } else {
      assert.equal(result.allowed, true, `${from} -> ${to}`);
      assert.equal(result.nextVersion, index + 1);
    }
  }
});

test("stale optimistic versions are denied", () => {
  const result = evaluateEngagementTransition({
    from: "secure_intake",
    to: "document_processing",
    event: "progress",
    currentVersion: 4,
    expectedVersion: 3,
  });
  assert.equal(result.code, "stale_version");
  assert.equal(result.nextVersion, 4);
});

test("named sign-off cannot bypass readiness", () => {
  const result = evaluateEngagementTransition({
    from: "package_assembly",
    to: "named_signoff",
    event: "progress",
    currentVersion: 1,
    expectedVersion: 1,
    readinessGatePassed: false,
  });
  assert.equal(result.code, "readiness_gate_failed");
});

test("addenda invalidate downstream work and require a reason", () => {
  const denied = evaluateEngagementTransition({
    from: "reviewer_approval",
    to: "requirement_review",
    event: "apply_addendum",
    currentVersion: 7,
    expectedVersion: 7,
  });
  assert.equal(denied.code, "reason_required");

  const allowed = evaluateEngagementTransition({
    from: "reviewer_approval",
    to: "requirement_review",
    event: "apply_addendum",
    currentVersion: 7,
    expectedVersion: 7,
    reason: "Addendum 2 replaces the eligibility schedule",
  });
  assert.equal(allowed.allowed, true);
});

test("replacement and retry paths are controlled", () => {
  assert.equal(
    evaluateEngagementTransition({
      from: "document_processing",
      to: "secure_intake",
      event: "replace_document",
      currentVersion: 2,
      expectedVersion: 2,
      reason: "Client supplied unlocked revision",
    }).allowed,
    true,
  );
  assert.equal(
    evaluateEngagementTransition({
      from: "document_processing",
      to: "document_processing",
      event: "retry_processing",
      currentVersion: 2,
      expectedVersion: 2,
      recoveryComplete: false,
    }).code,
    "recovery_incomplete",
  );
});

test("withdrawal and cancellation require owner approval and reason", () => {
  const missingApproval = evaluateEngagementTransition({
    from: "remediation",
    to: "withdrawn",
    event: "withdraw",
    currentVersion: 1,
    expectedVersion: 1,
    reason: "Tender withdrawn",
  });
  assert.equal(missingApproval.code, "approval_required");

  const missingReason = evaluateEngagementTransition({
    from: "remediation",
    to: "cancelled",
    event: "cancel",
    currentVersion: 1,
    expectedVersion: 1,
    ownerApproved: true,
  });
  assert.equal(missingReason.code, "reason_required");
});

test("reopen and archive are explicit, approved transitions", () => {
  assert.equal(
    evaluateEngagementTransition({
      from: "export_delivery",
      to: "remediation",
      event: "reopen",
      currentVersion: 9,
      expectedVersion: 9,
      ownerApproved: true,
      reason: "Delivery manifest mismatch",
    }).allowed,
    true,
  );
  assert.equal(
    evaluateEngagementTransition({
      from: "outcome_capture",
      to: "archived",
      event: "archive",
      currentVersion: 10,
      expectedVersion: 10,
      ownerApproved: true,
    }).allowed,
    true,
  );
  assert.equal(
    evaluateEngagementTransition({
      from: "archived",
      to: "remediation",
      event: "reopen",
      currentVersion: 11,
      expectedVersion: 11,
      ownerApproved: true,
      reason: "Attempted mutation",
    }).code,
    "terminal_state",
  );
});
