import assert from "node:assert/strict";
import test from "node:test";
import {
  capabilityMutationRequiresApproval,
  evidencePatchRequiresApproval,
  governedMutationAllowed,
  isApprovedEvidence,
} from "./reviewIntegrityPolicy";
import { hasPermission } from "./permissions";

test("confirmed evidence cannot be edited or reverted by a contributor", () => {
  const confirmed = {
    evidenceStatus: "present",
    suggested: false,
    confirmedBy: "reviewer-1",
  };
  assert.equal(isApprovedEvidence(confirmed), true);
  assert.equal(
    governedMutationAllowed(
      evidencePatchRequiresApproval(confirmed, { evidenceStatus: "pending" }),
      hasPermission(["contributor"], "evidence:approve"),
    ),
    false,
  );
  assert.equal(
    governedMutationAllowed(
      evidencePatchRequiresApproval(confirmed, {}),
      hasPermission(["client_reviewer_approver"], "evidence:approve"),
    ),
    true,
  );
});

test("unapproved pending evidence remains editable by a contributor", () => {
  const pending = {
    evidenceStatus: "pending",
    suggested: false,
    confirmedBy: null,
  };
  assert.equal(evidencePatchRequiresApproval(pending, {}), false);
});

test("approved capability claims require approver authority for edits and deletion", () => {
  assert.equal(
    governedMutationAllowed(
      capabilityMutationRequiresApproval("approved"),
      hasPermission(["contributor"], "evidence:approve"),
    ),
    false,
  );
  assert.equal(
    governedMutationAllowed(
      capabilityMutationRequiresApproval("approved"),
      hasPermission(["client_reviewer_approver"], "evidence:approve"),
    ),
    true,
  );
  assert.equal(capabilityMutationRequiresApproval("pending"), false);
});

test("requirement governance denies contributors and admits reviewers", () => {
  assert.equal(hasPermission(["contributor"], "requirement:review"), false);
  assert.equal(
    hasPermission(["client_reviewer_approver"], "requirement:review"),
    true,
  );
});
