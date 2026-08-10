import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateSubmissionReadiness,
  type SubmissionReadinessInput,
} from "./submissionReadiness";

function readyFixture(): SubmissionReadinessInput {
  return {
    project: {
      ndaStatus: "signed",
      reviewerId: "reviewer-1",
      conflictStatus: "clear",
      paymentStatus: "not_required",
    },
    report: {
      generatedBy: "author-1",
      engineVersion: "2.5.0",
      promptPackVersion: "p1",
      modelId: "model-1",
      taxonomyVersion: "t1",
    },
    signerId: "reviewer-1",
    documents: [
      {
        id: "tender-1",
        type: "tender",
        redactionStatus: "included",
        sha256: "abc",
        extractionStatus: "extracted",
        contentText:
          "The bidder shall submit a valid tax clearance certificate.",
      },
      {
        id: "bid-1",
        type: "bid",
        redactionStatus: "included",
        sha256: "def",
        extractionStatus: "extracted",
        contentText: "Tax clearance certificate TCC-123 is valid.",
      },
    ],
    requirements: [
      {
        id: "req-1",
        isMandatory: true,
        reviewStatus: "confirmed",
        sourceDocId: "tender-1",
        pageRef: "12",
      },
    ],
    evidence: [
      {
        id: "ev-1",
        requirementId: "req-1",
        evidenceStatus: "present",
        suggested: false,
        documentId: "bid-1",
        excerpt: "Tax clearance certificate TCC-123 is valid.",
      },
    ],
    defects: [],
    boqChecks: [],
    unsupportedClaimIds: [],
    requiresRedTeam: false,
    redTeamApproved: true,
  };
}

test("submission-ready fixture passes every server-side invariant", () => {
  assert.deepEqual(evaluateSubmissionReadiness(readyFixture()), {
    ready: true,
    blockers: [],
  });
});

test("one open likely-fatal defect blocks readiness with no override", () => {
  const input = readyFixture();
  input.defects.push({
    id: "defect-1",
    severity: "likely_fatal",
    status: "open",
  });
  const result = evaluateSubmissionReadiness(input);
  assert.equal(result.ready, false);
  assert.ok(
    result.blockers.some((blocker) => blocker.code === "fatal_defect_open"),
  );
});

test("suggested requirements and suggested defects block human-review completion", () => {
  const input = readyFixture();
  input.requirements.push({
    id: "req-2",
    isMandatory: false,
    reviewStatus: "suggested",
    sourceDocId: "tender-1",
    pageRef: "13",
  });
  input.defects.push({
    id: "defect-2",
    severity: "cosmetic",
    status: "suggested",
  });
  const codes = evaluateSubmissionReadiness(input).blockers.map(
    (blocker) => blocker.code,
  );
  assert.ok(codes.includes("requirements_unreviewed"));
  assert.ok(codes.includes("defects_unreviewed"));
});

test("mandatory evidence must be reviewer-confirmed, not an AI suggestion", () => {
  const input = readyFixture();
  input.evidence[0]!.suggested = true;
  const result = evaluateSubmissionReadiness(input);
  assert.ok(
    result.blockers.some(
      (blocker) => blocker.code === "mandatory_evidence_missing",
    ),
  );
});

test("reviewed present evidence must cite an in-scope document with an exact excerpt", () => {
  const missingDocument = readyFixture();
  missingDocument.evidence[0]!.documentId = null;
  let codes = evaluateSubmissionReadiness(missingDocument).blockers.map(
    (blocker) => blocker.code,
  );
  assert.ok(codes.includes("evidence_citation_unresolvable"));
  assert.ok(codes.includes("mandatory_evidence_missing"));

  const paraphrase = readyFixture();
  paraphrase.evidence[0]!.excerpt =
    "The tax clearance certificate appears to be valid.";
  codes = evaluateSubmissionReadiness(paraphrase).blockers.map(
    (blocker) => blocker.code,
  );
  assert.ok(codes.includes("evidence_citation_unresolvable"));
  assert.ok(codes.includes("mandatory_evidence_missing"));

  const excluded = readyFixture();
  excluded.documents[1]!.redactionStatus = "excluded";
  codes = evaluateSubmissionReadiness(excluded).blockers.map(
    (blocker) => blocker.code,
  );
  assert.ok(codes.includes("evidence_citation_unresolvable"));
});

test("not-applicable evidence resolves a mandatory item only with grounded reviewer rationale", () => {
  const input = readyFixture();
  input.evidence[0]!.evidenceStatus = "not_applicable";
  input.evidence[0]!.documentId = null;
  input.evidence[0]!.excerpt = null;
  let codes = evaluateSubmissionReadiness(input).blockers.map(
    (blocker) => blocker.code,
  );
  assert.ok(codes.includes("evidence_citation_unresolvable"));
  assert.ok(codes.includes("mandatory_evidence_missing"));

  input.evidence[0]!.documentId = "bid-1";
  input.evidence[0]!.excerpt = "Tax clearance certificate TCC-123 is valid.";
  codes = evaluateSubmissionReadiness(input).blockers.map(
    (blocker) => blocker.code,
  );
  assert.equal(codes.includes("evidence_citation_unresolvable"), false);
  assert.equal(codes.includes("mandatory_evidence_missing"), false);
});

test("engine requirements retain and re-verify their exact source quote", () => {
  const input = readyFixture();
  input.requirements[0]!.origin = "engine";
  input.requirements[0]!.mergedCitations = JSON.stringify([
    {
      sourceDocId: "tender-1",
      pageRef: "12",
      text: "The bidder shall submit a valid tax clearance certificate.",
    },
  ]);
  assert.equal(
    evaluateSubmissionReadiness(input).blockers.some(
      (blocker) => blocker.code === "citation_unresolvable",
    ),
    false,
  );

  input.requirements[0]!.mergedCitations = JSON.stringify([
    {
      sourceDocId: "tender-1",
      pageRef: "12",
      text: "The bidder may submit a tax clearance certificate.",
    },
  ]);
  assert.ok(
    evaluateSubmissionReadiness(input).blockers.some(
      (blocker) => blocker.code === "citation_unresolvable",
    ),
  );
});

test("a pending AI responsiveness narrative blocks release", () => {
  const input = readyFixture();
  input.project.responsivenessSuggested = true;
  const result = evaluateSubmissionReadiness(input);
  assert.ok(
    result.blockers.some(
      (blocker) => blocker.code === "responsiveness_review_unapproved",
    ),
  );
});

test("report generation and independent sign-off require different actors", () => {
  const input = readyFixture();
  input.signerId = "author-1";
  const result = evaluateSubmissionReadiness(input);
  assert.ok(
    result.blockers.some(
      (blocker) => blocker.code === "reviewer_not_independent",
    ),
  );
});

test("every confirmed requirement needs a source document and page or clause", () => {
  const input = readyFixture();
  input.requirements[0]!.pageRef = null;
  input.requirements[0]!.clauseRef = null;
  const result = evaluateSubmissionReadiness(input);
  assert.ok(
    result.blockers.some((blocker) => blocker.code === "citation_unresolvable"),
  );
});

test("BOQ presence requires a completed run with no flagged exceptions", () => {
  const input = readyFixture();
  input.documents.push({
    id: "boq-1",
    type: "boq",
    redactionStatus: "included",
    sha256: "ghi",
    extractionStatus: "extracted",
  });
  let result = evaluateSubmissionReadiness(input);
  assert.ok(
    result.blockers.some((blocker) => blocker.code === "boq_not_verified"),
  );
  input.boqChecks.push({ id: "check-1", status: "flagged" });
  result = evaluateSubmissionReadiness(input);
  assert.ok(
    result.blockers.some((blocker) => blocker.code === "boq_exception_open"),
  );
});
