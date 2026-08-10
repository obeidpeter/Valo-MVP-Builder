import assert from "node:assert/strict";
import test from "node:test";
import { sha256Text, type ExactCitation, type SourceDocument } from "./domain";
import { tailorVerifiedPersonnelAndExperience } from "./personnelTailoring";

const accepted = {
  state: "accepted" as const,
  reviewerId: "owner-1",
  reviewedAt: "2026-08-10T10:00:00.000Z",
};
function source(
  id: string,
  kind: SourceDocument["kind"],
  content: string,
): SourceDocument {
  return {
    sourceId: id,
    versionId: "v1",
    kind,
    title: id,
    content,
    contentSha256: sha256Text(content),
    capturedAt: "2026-08-09T10:00:00.000Z",
    authority: "authoritative",
    origin: `record:${id}`,
  };
}
function cite(item: SourceDocument): ExactCitation {
  return {
    sourceId: item.sourceId,
    sourceVersionId: item.versionId,
    contentSha256: item.contentSha256,
    startOffset: 0,
    endOffset: item.content.length,
    quote: item.content,
  };
}
const criterionSource = source(
  "criterion",
  "solicitation",
  "Lead engineer must have bridge engineering experience.",
);
const cvSource = source(
  "cv-amina",
  "company_evidence",
  "Person Amina Bello delivered three bridge engineering projects and is available from 2026-08-01.",
);
const base = {
  asOfDate: "2026-08-10",
  sources: [criterionSource, cvSource],
  criteria: [
    {
      externalId: "lead-engineer",
      label: "Lead engineer",
      tags: ["bridge", "engineering"],
      citations: [cite(criterionSource)],
      review: accepted,
    },
  ],
  candidates: [
    {
      externalId: "amina",
      displayName: "Amina Bello",
      kind: "person" as const,
      tags: ["bridge", "engineering"],
      availableFrom: "2026-08-01",
      citations: [cite(cvSource)],
      ownerReview: accepted,
    },
  ],
};

test("proposes only source-verified current candidates", () => {
  const first = tailorVerifiedPersonnelAndExperience(base);
  const proposalId = first.proposals[0]?.proposalId;
  assert.ok(proposalId);
  const ready = tailorVerifiedPersonnelAndExperience({
    ...base,
    proposalReviews: { [proposalId]: accepted },
  });
  assert.equal(ready.status, "ready");
  assert.deepEqual(ready.proposals[0]?.matchedTags, ["bridge", "engineering"]);
  assert.equal(ready.employmentOrCredentialAttestation, "not_granted");
});

test("does not select unavailable people", () => {
  const futureCv = source(
    "cv-amina-future",
    "company_evidence",
    "Person Amina Bello delivered three bridge engineering projects and is available from 2026-09-01.",
  );
  const result = tailorVerifiedPersonnelAndExperience({
    ...base,
    sources: [criterionSource, futureCv],
    candidates: [
      {
        ...base.candidates[0],
        availableFrom: "2026-09-01",
        citations: [cite(futureCv)],
      },
    ],
  });
  assert.equal(result.proposals.length, 0);
  assert.deepEqual(result.uncoveredCriterionIds, ["lead-engineer"]);
  assert.equal(result.status, "review_required");
});

test("blocks unverified candidate evidence", () => {
  const result = tailorVerifiedPersonnelAndExperience({
    ...base,
    sources: [
      criterionSource,
      { ...cvSource, authority: "unverified" as const },
    ],
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.proposals.length, 0);
});

test("does not match uncited tags", () => {
  const result = tailorVerifiedPersonnelAndExperience({
    ...base,
    candidates: [
      { ...base.candidates[0], tags: ["bridge", "nuclear-engineering"] },
    ],
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.proposals.length, 0);
  assert.equal(
    result.issues.some(
      (issue) => issue.code === "candidate_match_terms_not_cited",
    ),
    true,
  );
});

test("a proposal review cannot transfer after candidate availability ownership changes", () => {
  const first = tailorVerifiedPersonnelAndExperience(base);
  const proposalId = first.proposals[0]?.proposalId;
  assert.ok(proposalId);
  const changed = tailorVerifiedPersonnelAndExperience({
    ...base,
    candidates: [
      {
        ...base.candidates[0],
        ownerReview: { ...accepted, reviewerId: "owner-2" },
      },
    ],
    proposalReviews: { [proposalId]: accepted },
  });
  assert.notEqual(changed.proposals[0]?.proposalId, proposalId);
  assert.equal(changed.status, "blocked");
});
