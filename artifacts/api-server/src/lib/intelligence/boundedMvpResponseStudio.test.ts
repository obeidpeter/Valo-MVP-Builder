import assert from "node:assert/strict";
import test from "node:test";
import type { BoundedSourceCitation } from "./boundedMvpContracts";
import { validateCitationFirstResponse } from "./boundedMvpResponseStudio";

const scope = { organisationId: "org-a", projectId: "project-a" };

function citation(
  quote: string,
  overrides: Partial<BoundedSourceCitation> = {},
): BoundedSourceCitation {
  return {
    ...scope,
    documentId: "tender",
    documentVersionId: "tender-v2",
    sourceSha256: "b".repeat(64),
    pageNumber: 8,
    quote,
    canonicalPageText: `Heading. ${quote} Footer.`,
    lifecycleState: "active",
    ...overrides,
  };
}

test("exact and paraphrased factual claims remain human-review proposals", () => {
  const result = validateCitationFirstResponse({
    ...scope,
    claims: [
      {
        id: "claim-1",
        sectionId: "technical",
        text: "The warranty period is 24 months.",
        kind: "factual",
        supportMode: "exact_quote",
        citations: [citation("The warranty period is 24 months.")],
      },
      {
        id: "claim-2",
        sectionId: "technical",
        text: "The solution meets the stated warranty requirement.",
        kind: "factual",
        supportMode: "paraphrase",
        citations: [citation("The warranty period is 24 months.")],
      },
    ],
  });

  assert.equal(result.validationStatus, "eligible_for_human_review");
  assert.equal(result.citationCoverageComplete, true);
  assert.equal(result.releaseAuthorized, false);
  assert.deepEqual(
    result.findings.map((finding) => finding.code),
    ["semantic_support_requires_review"],
  );
});

test("blocks missing, foreign, and non-matching factual citations", () => {
  const result = validateCitationFirstResponse({
    ...scope,
    claims: [
      {
        id: "missing",
        sectionId: "one",
        text: "The deadline is Friday.",
        kind: "factual",
        citations: [],
      },
      {
        id: "foreign",
        sectionId: "one",
        text: "The deadline is Friday.",
        kind: "factual",
        supportMode: "exact_quote",
        citations: [
          citation("The deadline is Friday.", { projectId: "project-b" }),
        ],
      },
      {
        id: "mismatch",
        sectionId: "one",
        text: "The deadline is Friday.",
        kind: "factual",
        supportMode: "exact_quote",
        citations: [citation("The deadline is Monday.")],
      },
    ],
  });

  assert.equal(result.validationStatus, "blocked");
  assert.equal(result.citationCoverageComplete, false);
  const codes = result.findings.map((finding) => finding.code);
  assert.equal(codes.includes("factual_citation_missing"), true);
  assert.equal(codes.includes("citation_invalid"), true);
  assert.equal(codes.includes("exact_claim_not_in_quote"), true);
});

test("blocks unresolved response placeholders", () => {
  const result = validateCitationFirstResponse({
    ...scope,
    claims: [
      {
        id: "placeholder",
        sectionId: "commercial",
        text: "[Insert certificate number]",
        kind: "instructional",
        citations: [],
      },
    ],
  });
  assert.equal(result.validationStatus, "blocked");
  assert.equal(result.findings[0]?.code, "placeholder_text");
});
