import assert from "node:assert/strict";
import test from "node:test";
import type { BoundedSourceCitation } from "./boundedMvpContracts";
import { runExtendedSubmissionPreflight } from "./boundedMvpSubmissionPreflight";

const scope = { organisationId: "org-a", projectId: "project-a" };
function citation(quote: string): BoundedSourceCitation {
  return {
    ...scope,
    documentId: "tender",
    documentVersionId: "tender-v3",
    sourceSha256: "c".repeat(64),
    pageNumber: 2,
    quote,
    canonicalPageText: quote,
    lifecycleState: "active",
  };
}

test("passing extension checks still do not authorise submission", () => {
  const result = runExtendedSubmissionPreflight({
    ...scope,
    asOfIso: "2026-09-01T10:00:00Z",
    namedReviewerId: "reviewer-1",
    obligations: [
      {
        id: "obligation-1",
        label: "Signed Form A",
        mandatory: true,
        reviewState: "accepted",
        expectedFilename: "Form-A.pdf",
        citation: citation("Upload Signed Form A as Form-A.pdf"),
      },
    ],
    artifacts: [
      {
        id: "artifact-1",
        obligationIds: ["obligation-1"],
        filename: "Form-A.pdf",
        lifecycleState: "final",
        sha256: "d".repeat(64),
        approvedByUserId: "reviewer-1",
      },
    ],
    addenda: [
      {
        id: "addendum-1",
        reviewState: "accepted",
        incorporationState: "applied",
        citation: citation("Addendum 1 changes the delivery address."),
      },
    ],
    deadline: {
      dueAtIso: "2026-09-30T11:00:00Z",
      sourceDateText: "30 September 2026",
      citation: citation("Deadline: 30 September 2026 at 12:00 WAT."),
    },
  });

  assert.equal(result.status, "checks_passed_pending_human_approval");
  assert.equal(result.submissionAuthorized, false);
  assert.deepEqual(result.issues, []);
});

test("finds source-backed artifact, addendum, deadline, and approval blockers", () => {
  const result = runExtendedSubmissionPreflight({
    ...scope,
    asOfIso: "2026-10-01T00:00:00Z",
    obligations: [
      {
        id: "missing",
        label: "Signed Form A",
        mandatory: true,
        reviewState: "accepted",
        citation: citation("Signed Form A is mandatory."),
      },
      {
        id: "filename",
        label: "Technical response",
        mandatory: true,
        reviewState: "accepted",
        expectedFilename: "Technical.pdf",
        citation: citation("Technical response must be named Technical.pdf"),
      },
    ],
    artifacts: [
      {
        id: "artifact-2",
        obligationIds: ["filename"],
        filename: "Draft.pdf",
        lifecycleState: "final",
      },
    ],
    addenda: [
      {
        id: "addendum-2",
        reviewState: "accepted",
        incorporationState: "not_applied",
        citation: citation("Addendum 2 replaces the schedule."),
      },
    ],
    deadline: {
      dueAtIso: "2026-09-30T11:00:00Z",
      sourceDateText: "30 September 2026",
      citation: citation("Deadline: 30 September 2026 at 12:00 WAT."),
    },
  });

  const codes = new Set(result.issues.map((issue) => issue.code));
  for (const code of [
    "reviewer_missing",
    "mandatory_artifact_missing",
    "artifact_integrity_missing",
    "final_artifact_not_approved",
    "required_filename_mismatch",
    "addendum_not_applied",
    "deadline_passed",
  ]) {
    assert.equal(codes.has(code as never), true, code);
  }
  assert.equal(result.remediationProposals.length, result.issues.length);
  assert.equal(result.safety.externalAction, "none");
});

test("does not enforce an obligation with an unverified source", () => {
  const foreign = citation("Signed Form B is mandatory.");
  foreign.organisationId = "org-b";
  const result = runExtendedSubmissionPreflight({
    ...scope,
    asOfIso: "2026-09-01T00:00:00Z",
    obligations: [
      {
        id: "foreign-rule",
        label: "Signed Form B",
        mandatory: true,
        reviewState: "accepted",
        citation: foreign,
      },
    ],
    artifacts: [],
    addenda: [],
  });
  assert.deepEqual(
    result.issues.map((issue) => issue.code),
    ["reviewer_missing", "unverified_obligation"],
  );
});

test("a draft artifact cannot satisfy submission preflight", () => {
  const result = runExtendedSubmissionPreflight({
    ...scope,
    asOfIso: "2026-09-01T00:00:00Z",
    namedReviewerId: "reviewer-1",
    obligations: [
      {
        id: "draft-rule",
        label: "Technical response",
        mandatory: true,
        reviewState: "accepted",
        citation: citation("Technical response is mandatory."),
      },
    ],
    artifacts: [
      {
        id: "draft-artifact",
        obligationIds: ["draft-rule"],
        filename: "Technical.pdf",
        lifecycleState: "draft",
        sha256: "d".repeat(64),
      },
    ],
    addenda: [],
  });
  assert.deepEqual(
    result.issues.map((issue) => issue.code),
    ["artifact_not_final"],
  );
});
