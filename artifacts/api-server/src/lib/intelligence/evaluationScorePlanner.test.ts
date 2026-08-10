import assert from "node:assert/strict";
import { test } from "node:test";
import { sha256Text, type HumanReview, type SourceDocument } from "./domain";
import {
  buildEvaluationScorePlan,
  type EvaluationScorePlannerInput,
} from "./evaluationScorePlanner";

const ACCEPTED: HumanReview = {
  state: "accepted",
  reviewerId: "reviewer-1",
  reviewedAt: "2026-08-10T10:00:00.000Z",
};

function source(
  sourceId: string,
  versionId: string,
  kind: SourceDocument["kind"],
  content: string,
  authority: SourceDocument["authority"] = "authoritative",
): SourceDocument {
  return {
    sourceId,
    versionId,
    kind,
    title: `${sourceId}.pdf`,
    content,
    contentSha256: sha256Text(content),
    capturedAt: "2026-08-10T09:00:00.000Z",
    authority,
    origin: "controlled-test-fixture",
  };
}

function citation(item: SourceDocument, quote: string) {
  const startOffset = item.content.indexOf(quote);
  assert.notEqual(startOffset, -1);
  return {
    sourceId: item.sourceId,
    sourceVersionId: item.versionId,
    contentSha256: item.contentSha256,
    startOffset,
    endOffset: startOffset + quote.length,
    quote,
  };
}

function fixture(): EvaluationScorePlannerInput {
  const tender = source(
    "tender-score",
    "v1",
    "solicitation",
    "Mandatory criterion: Comparable project experience carries 60 points.",
  );
  const evidence = source(
    "completion-record",
    "v4",
    "company_evidence",
    "Project Alpha completion certificate supports comparable experience. The accepted record matches the published experience row.",
    "corroborating",
  );
  return {
    sources: [tender, evidence],
    criteria: [
      {
        externalId: "experience",
        label: "Comparable project experience",
        publishedMaxPoints: 60,
        mandatory: true,
        citations: [
          citation(
            tender,
            "Mandatory criterion: Comparable project experience carries 60 points.",
          ),
        ],
        review: ACCEPTED,
      },
    ],
    mappings: [
      {
        externalId: "alpha-map",
        criterionExternalId: "experience",
        evidenceLabel: "Project Alpha completion certificate",
        documentedSupportedPoints: 60,
        rationale: "The accepted record matches the published experience row.",
        citations: [
          citation(
            evidence,
            "Project Alpha completion certificate supports comparable experience. The accepted record matches the published experience row.",
          ),
        ],
        review: ACCEPTED,
      },
    ],
  };
}

test("projects only published points and requires acceptance of the exact plan", () => {
  const input = fixture();
  const proposed = buildEvaluationScorePlan(input);
  assert.equal(proposed.status, "review_required");
  assert.equal(proposed.publishedMaximumPoints, 60);
  assert.equal(proposed.documentedSupportedPoints, 60);
  assert.equal(proposed.mandatoryGapCount, 0);
  assert.equal(proposed.awardProbability, null);
  assert.equal(proposed.evaluatorBehaviourPrediction, false);
  assert.equal(proposed.awardDecisionAuthorized, false);
  assert.deepEqual(proposed.safety, {
    currentLevel: 0,
    targetCeilingLevel: 1,
    deterministicProjectionOnly: true,
    proposalOnly: true,
    requiresNamedHumanApproval: true,
    authoritativeStateChange: false,
    externalAction: "none",
    submissionAuthorized: false,
    legalDecisionAuthorized: false,
    commercialDecisionAuthorized: false,
  });

  const accepted = buildEvaluationScorePlan({
    ...input,
    planReview: { subjectId: proposed.planId, review: ACCEPTED },
  });
  assert.equal(accepted.status, "ready");
  assert.equal(accepted.readyForPlanningUse, true);
});

test("keeps an accepted evidence gap explicit without inventing score", () => {
  const input = { ...fixture(), mappings: [] };
  const proposed = buildEvaluationScorePlan(input);
  assert.equal(proposed.documentedSupportedPoints, 0);
  assert.equal(proposed.mandatoryGapCount, 1);
  assert.equal(proposed.projections[0]?.state, "unsupported");
  const accepted = buildEvaluationScorePlan({
    ...input,
    planReview: { subjectId: proposed.planId, review: ACCEPTED },
  });
  assert.equal(accepted.status, "ready");
  assert.equal(accepted.readyForPlanningUse, true);
});

test("fails closed for a mapping without company-evidence provenance", () => {
  const input = fixture();
  const tender = input.sources[0]!;
  const invalid = buildEvaluationScorePlan({
    ...input,
    mappings: [
      {
        ...input.mappings[0]!,
        citations: [
          citation(tender, "Comparable project experience carries 60 points."),
        ],
      },
    ],
  });
  assert.equal(invalid.status, "blocked");
  assert.equal(invalid.documentedSupportedPoints, 0);
  assert.ok(
    invalid.issues.some(
      (issue) => issue.code === "mapping_evidence_source_invalid",
    ),
  );
});

test("does not launder mapping provenance through a mixed citation set", () => {
  const input = fixture();
  const irrelevantCompanySource = source(
    "irrelevant-company-record",
    "v1",
    "company_evidence",
    "Registered office record only.",
    "corroborating",
  );
  const result = buildEvaluationScorePlan({
    ...input,
    sources: [...input.sources, irrelevantCompanySource],
    mappings: [
      {
        ...input.mappings[0]!,
        evidenceLabel: "Comparable project experience",
        citations: [
          input.criteria[0]!.citations[0]!,
          citation(irrelevantCompanySource, irrelevantCompanySource.content),
        ],
      },
    ],
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.mappings.length, 0);
  assert.ok(
    result.issues.some(
      (issue) => issue.code === "mapping_evidence_source_invalid",
    ),
  );
});

test("requires the published mandatory state to match its exact citation", () => {
  const input = fixture();
  const result = buildEvaluationScorePlan({
    ...input,
    criteria: [{ ...input.criteria[0]!, mandatory: false }],
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.criteria.length, 0);
  assert.ok(
    result.issues.some((issue) => issue.code === "criterion_facts_not_cited"),
  );
});

test("rejects a supported-point value absent from the published criterion", () => {
  const input = fixture();
  const result = buildEvaluationScorePlan({
    ...input,
    mappings: [
      {
        ...input.mappings[0]!,
        documentedSupportedPoints: 42,
      },
    ],
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.documentedSupportedPoints, 0);
  assert.ok(
    result.issues.some(
      (issue) => issue.code === "mapping_points_not_published",
    ),
  );
});

test("does not treat an unrelated number in the criterion citation as supported points", () => {
  const input = fixture();
  const tender = source(
    "tender-score-with-unrelated-number",
    "v1",
    "solicitation",
    "Mandatory criterion: Comparable project experience carries 60 points. Submit 42 printed copies.",
  );
  const result = buildEvaluationScorePlan({
    ...input,
    sources: [tender, input.sources[1]!],
    criteria: [
      {
        ...input.criteria[0]!,
        citations: [citation(tender, tender.content)],
      },
    ],
    mappings: [
      {
        ...input.mappings[0]!,
        documentedSupportedPoints: 42,
      },
    ],
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.mappings.length, 0);
  assert.ok(
    result.issues.some(
      (issue) => issue.code === "mapping_points_not_published",
    ),
  );
});

test("requires a mapping rationale in the same exact evidence citation", () => {
  const input = fixture();
  const result = buildEvaluationScorePlan({
    ...input,
    mappings: [
      {
        ...input.mappings[0]!,
        rationale: "An uncited scoring rationale.",
      },
    ],
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.mappings.length, 0);
  assert.ok(
    result.issues.some(
      (issue) => issue.code === "mapping_evidence_fact_not_cited",
    ),
  );
});

test("blocks multiple point mappings without exact published subcriteria", () => {
  const input = fixture();
  const result = buildEvaluationScorePlan({
    ...input,
    mappings: [
      input.mappings[0]!,
      { ...input.mappings[0]!, externalId: "alpha-map-copy" },
    ],
  });
  assert.equal(result.status, "blocked");
  assert.ok(
    result.issues.some(
      (issue) => issue.code === "multiple_score_mappings_require_breakdown",
    ),
  );
});

test("identity is deterministic across source and input order", () => {
  const input = fixture();
  const baseline = buildEvaluationScorePlan(input);
  const reordered = buildEvaluationScorePlan({
    ...input,
    sources: [...input.sources].reverse(),
    criteria: [...input.criteria].reverse(),
    mappings: [...input.mappings].reverse(),
  });
  assert.equal(reordered.planId, baseline.planId);
  assert.deepEqual(reordered.projections, baseline.projections);
});

test("a review cannot transfer to a changed score plan", () => {
  const input = fixture();
  const baseline = buildEvaluationScorePlan(input);
  const changed = buildEvaluationScorePlan({
    ...input,
    criteria: [
      {
        ...input.criteria[0]!,
        publishedMaxPoints: 50,
      },
    ],
    mappings: [
      {
        ...input.mappings[0]!,
        documentedSupportedPoints: 50,
      },
    ],
    planReview: { subjectId: baseline.planId, review: ACCEPTED },
  });
  assert.equal(changed.status, "blocked");
  assert.equal(changed.readyForPlanningUse, false);
  assert.ok(
    changed.issues.some((issue) => issue.code === "review_subject_mismatch"),
  );
});

test("a plan approval cannot transfer to a different named item reviewer", () => {
  const input = fixture();
  const baseline = buildEvaluationScorePlan(input);
  const changed = buildEvaluationScorePlan({
    ...input,
    criteria: [
      {
        ...input.criteria[0]!,
        review: { ...ACCEPTED, reviewerId: "different-reviewer" },
      },
    ],
    planReview: { subjectId: baseline.planId, review: ACCEPTED },
  });
  assert.equal(changed.status, "blocked");
  assert.ok(
    changed.issues.some((issue) => issue.code === "review_subject_mismatch"),
  );
});
