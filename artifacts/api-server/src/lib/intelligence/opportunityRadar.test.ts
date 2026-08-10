import assert from "node:assert/strict";
import test from "node:test";
import { sha256Text, type ExactCitation, type SourceDocument } from "./domain";
import {
  screenOpportunities,
  type OpportunityRadarInput,
} from "./opportunityRadar";

const accepted = {
  state: "accepted" as const,
  reviewerId: "bd-director-1",
  reviewedAt: "2026-08-10T12:00:00.000Z",
};

function source(
  sourceId: string,
  kind: SourceDocument["kind"],
  content: string,
): SourceDocument {
  return {
    sourceId,
    versionId: "v1",
    kind,
    title: sourceId,
    content,
    contentSha256: sha256Text(content),
    capturedAt: "2026-08-10T08:00:00.000Z",
    authority: "authoritative",
    origin: `official:${sourceId}`,
  };
}

function cite(document: SourceDocument, quote: string): ExactCitation {
  const startOffset = document.content.indexOf(quote);
  return {
    sourceId: document.sourceId,
    sourceVersionId: document.versionId,
    contentSha256: document.contentSha256,
    startOffset,
    endOffset: startOffset + quote.length,
    quote,
  };
}

const advert = source(
  "official-advert-1",
  "official_opportunity",
  "Federal Roads Agency invites bids for road rehabilitation in FCT, closing 2026-08-30.",
);
const capabilityEvidence = source(
  "road-project-reference",
  "company_evidence",
  "ACME completed road rehabilitation works in the Federal Capital Territory.",
);

const validInput: OpportunityRadarInput = {
  asOfDate: "2026-08-10",
  sources: [advert, capabilityEvidence],
  opportunities: [
    {
      externalId: "advert-001",
      title: "Road rehabilitation",
      procuringEntity: "Federal Roads Agency",
      category: "road_works",
      region: "fct",
      publishedDate: "2026-08-01",
      submissionDeadline: "2026-08-30",
      citations: [cite(advert, advert.content)],
      review: accepted,
    },
  ],
  capabilities: [
    {
      externalId: "capability-road-works",
      label: "Road rehabilitation delivery",
      category: "road_works",
      regions: ["fct"],
      allRegions: false,
      citations: [cite(capabilityEvidence, capabilityEvidence.content)],
      review: accepted,
    },
  ],
  capacity: {
    activeBidCount: 1,
    maximumConcurrentBids: 3,
    review: accepted,
  },
  policy: {
    policyId: "radar-policy-v1",
    minimumLeadDays: 14,
    weights: { category: 50, region: 20, leadTime: 30 },
  },
};

test("a grounded fit is scored transparently but never auto-actionable", () => {
  const result = screenOpportunities(validInput);
  assert.equal(result.status, "review_required");
  assert.equal(result.readyForUse, false);
  assert.equal(result.recommendations[0]?.disposition, "candidate");
  assert.equal(result.recommendations[0]?.fitScore, 100);
  assert.equal(result.recommendations[0]?.actionable, false);
  assert.equal(result.recommendations[0]?.review.state, "unreviewed");
  assert.equal(result.scoringNotice, "fit_score_is_not_win_probability");
  assert.equal(result.issues.length, 0);
});

test("a named human may accept only the exact generated recommendation", () => {
  const proposed = screenOpportunities(validInput);
  const recommendationId = proposed.recommendations[0]?.recommendationId;
  assert.ok(recommendationId);
  const result = screenOpportunities({
    ...validInput,
    recommendationReviews: { [recommendationId]: accepted },
  });
  assert.equal(result.status, "ready");
  assert.equal(result.readyForUse, true);
  assert.equal(result.recommendations[0]?.actionable, true);
});

test("unreviewed capability evidence cannot produce a capability-gap assertion", () => {
  const result = screenOpportunities({
    ...validInput,
    capabilities: [
      { ...validInput.capabilities[0], review: { state: "unreviewed" } },
    ],
  });
  assert.equal(result.recommendations[0]?.disposition, "source_not_accepted");
  assert.equal(result.recommendations[0]?.fitScore, undefined);
  assert.equal(result.recommendations[0]?.actionable, false);
});

test("unverified opportunity sources fail closed", () => {
  const result = screenOpportunities({
    ...validInput,
    sources: [{ ...advert, authority: "unverified" }, capabilityEvidence],
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.readyForUse, false);
  assert.equal(result.opportunities.length, 0);
  assert.equal(
    result.issues.some((issue) => issue.code === "opportunity_source_invalid"),
    true,
  );
});

test("a global provenance blocker suppresses an otherwise accepted action", () => {
  const proposed = screenOpportunities(validInput);
  const recommendationId = proposed.recommendations[0]?.recommendationId;
  assert.ok(recommendationId);
  const invalidExtraSource: SourceDocument = {
    ...capabilityEvidence,
    sourceId: "invalid-extra-source",
    contentSha256: "0".repeat(64),
  };
  const result = screenOpportunities({
    ...validInput,
    sources: [...validInput.sources, invalidExtraSource],
    recommendationReviews: { [recommendationId]: accepted },
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.recommendations[0]?.actionable, false);
});

test("an approval cannot transfer after the recommendation inputs change", () => {
  const first = screenOpportunities(validInput);
  const firstId = first.recommendations[0]?.recommendationId;
  assert.ok(firstId);
  const changed = screenOpportunities({
    ...validInput,
    policy: { ...validInput.policy, minimumLeadDays: 25 },
    recommendationReviews: { [firstId]: accepted },
  });
  assert.equal(changed.status, "blocked");
  assert.equal(changed.readyForUse, false);
  assert.equal(
    changed.issues.some(
      (issue) => issue.code === "orphan_recommendation_review",
    ),
    true,
  );
});

test("closed opportunities remain non-actionable even after review", () => {
  const closedInput: OpportunityRadarInput = {
    ...validInput,
    asOfDate: "2026-09-01",
  };
  const proposed = screenOpportunities(closedInput);
  const recommendationId = proposed.recommendations[0]?.recommendationId;
  assert.ok(recommendationId);
  const reviewed = screenOpportunities({
    ...closedInput,
    recommendationReviews: { [recommendationId]: accepted },
  });
  assert.equal(reviewed.recommendations[0]?.disposition, "closed");
  assert.equal(reviewed.recommendations[0]?.actionable, false);
  assert.equal(reviewed.status, "ready");
});
