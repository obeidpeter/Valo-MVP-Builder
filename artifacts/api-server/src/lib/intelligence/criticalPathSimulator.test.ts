import assert from "node:assert/strict";
import test from "node:test";
import { sha256Text, type ExactCitation, type SourceDocument } from "./domain";
import { simulatePursuitCriticalPath } from "./criticalPathSimulator";
import { NEXT_CAPABILITY_MAX_ITEMS } from "./nextCapabilityContracts";

const accepted = {
  state: "accepted" as const,
  reviewerId: "planner-1",
  reviewedAt: "2026-08-10T10:00:00.000Z",
};
const technical =
  "Technical response duration 5 days, target 2026-08-20, dependencies none, resource writer-1.";
const commercial =
  "Commercial response duration 3 days, target 2026-08-22, depends on technical, resource writer-1.";
const technicalIndependent =
  "Technical response duration 5 days, target 2026-08-20, dependencies none, resource writer-1 (independent scenario).";
const commercialIndependent =
  "Commercial response duration 3 days, target 2026-08-22, dependencies none, resource writer-1 (independent scenario).";
const technicalCycle =
  "Technical response duration 5 days, target 2026-08-20, depends on commercial, resource writer-1 (cycle scenario).";
const commercialCycle =
  "Commercial response duration 3 days, target 2026-08-22, depends on technical, resource writer-1 (cycle scenario).";
const finalReview =
  "Final review duration 1 days, target 2026-08-24, depends on commercial and technical, resource writer-2.";
const content = [
  technical,
  commercial,
  technicalIndependent,
  commercialIndependent,
  technicalCycle,
  commercialCycle,
  finalReview,
].join(" ");
const source: SourceDocument = {
  sourceId: "plan-source",
  versionId: "v1",
  kind: "solicitation",
  title: "Tender plan",
  content,
  contentSha256: sha256Text(content),
  capturedAt: "2026-08-09T10:00:00.000Z",
  authority: "authoritative",
  origin: "tender:plan",
};
function cite(quote: string): ExactCitation {
  const startOffset = content.indexOf(quote);
  return {
    sourceId: source.sourceId,
    sourceVersionId: source.versionId,
    contentSha256: source.contentSha256,
    startOffset,
    endOffset: startOffset + quote.length,
    quote,
  };
}
const milestones = [
  {
    externalId: "technical",
    label: "Technical response",
    durationDays: 5,
    targetFinishDate: "2026-08-20",
    dependencyExternalIds: [],
    resourceId: "writer-1",
    citation: cite(technical),
    review: accepted,
  },
  {
    externalId: "commercial",
    label: "Commercial response",
    durationDays: 3,
    targetFinishDate: "2026-08-22",
    dependencyExternalIds: ["technical"],
    resourceId: "writer-1",
    citation: cite(commercial),
    review: accepted,
  },
];

test("builds a deterministic dependency schedule without changing tasks", () => {
  const first = simulatePursuitCriticalPath({
    asOfDate: "2026-08-10",
    sources: [source],
    milestones,
  });
  const reviews = Object.fromEntries(
    first.proposals.map((proposal) => [proposal.proposalId, accepted]),
  );
  const ready = simulatePursuitCriticalPath({
    asOfDate: "2026-08-10",
    sources: [source],
    milestones,
    scenarioReviews: reviews,
  });
  assert.equal(ready.status, "ready");
  assert.equal(ready.proposals[1]?.earliestStartDate, "2026-08-15");
  assert.equal(
    ready.proposals.every((proposal) => proposal.changesApplied === false),
    true,
  );
  assert.equal(ready.taskMutationAuthority, "none");
});

test("surfaces overlapping resource scenarios for review", () => {
  const result = simulatePursuitCriticalPath({
    asOfDate: "2026-08-10",
    sources: [source],
    milestones: [
      {
        ...milestones[0],
        dependencyExternalIds: [],
        citation: cite(technicalIndependent),
      },
      {
        ...milestones[1],
        dependencyExternalIds: [],
        citation: cite(commercialIndependent),
      },
    ],
  });
  assert.equal(result.resourceConflicts.length, 1);
  assert.equal(result.status, "review_required");
});

test("fails closed on dependency cycles", () => {
  const result = simulatePursuitCriticalPath({
    asOfDate: "2026-08-10",
    sources: [source],
    milestones: [
      {
        ...milestones[0],
        dependencyExternalIds: ["commercial"],
        citation: cite(technicalCycle),
      },
      {
        ...milestones[1],
        dependencyExternalIds: ["technical"],
        citation: cite(commercialCycle),
      },
    ],
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.proposals.length, 0);
  assert.equal(
    result.issues.some((issue) => issue.code === "milestone_dependency_cycle"),
    true,
  );
});

test("blocks schedule fields that are not present in the exact citation", () => {
  const result = simulatePursuitCriticalPath({
    asOfDate: "2026-08-10",
    sources: [source],
    milestones: [{ ...milestones[0], durationDays: 10 }],
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.proposals.length, 0);
  assert.equal(
    result.issues.some((issue) => issue.code === "milestone_fields_not_cited"),
    true,
  );
});

test("dependency order does not change a proposal or its review subject", () => {
  const finalMilestone = {
    externalId: "final-review",
    label: "Final review",
    durationDays: 1,
    targetFinishDate: "2026-08-24",
    dependencyExternalIds: ["technical", "commercial"],
    resourceId: "writer-2",
    citation: cite(finalReview),
    review: accepted,
  };
  const first = simulatePursuitCriticalPath({
    asOfDate: "2026-08-10",
    sources: [source],
    milestones: [...milestones, finalMilestone],
  });
  const permuted = simulatePursuitCriticalPath({
    asOfDate: "2026-08-10",
    sources: [source],
    milestones: [
      ...milestones,
      {
        ...finalMilestone,
        dependencyExternalIds: ["commercial", "technical"],
      },
    ],
  });
  assert.equal(
    first.proposals.find(
      (proposal) => proposal.milestoneExternalId === "final-review",
    )?.proposalId,
    permuted.proposals.find(
      (proposal) => proposal.milestoneExternalId === "final-review",
    )?.proposalId,
  );
});

test("numeric and resource prefixes cannot satisfy exact schedule fields", () => {
  const prefixText =
    "Technical response duration 10 days, target 2026-08-20, dependencies none, resource writer-10.";
  const prefixSource: SourceDocument = {
    ...source,
    sourceId: "prefix-plan",
    content: prefixText,
    contentSha256: sha256Text(prefixText),
  };
  const result = simulatePursuitCriticalPath({
    asOfDate: "2026-08-10",
    sources: [prefixSource],
    milestones: [
      {
        ...milestones[0],
        durationDays: 1,
        citation: {
          sourceId: prefixSource.sourceId,
          sourceVersionId: prefixSource.versionId,
          contentSha256: prefixSource.contentSha256,
          startOffset: 0,
          endOffset: prefixText.length,
          quote: prefixText,
        },
      },
    ],
  });
  assert.equal(result.status, "blocked");
  assert.equal(
    result.issues.some((issue) => issue.code === "milestone_fields_not_cited"),
    true,
  );
});

test("a schedule review cannot transfer to a different milestone reviewer", () => {
  const first = simulatePursuitCriticalPath({
    asOfDate: "2026-08-10",
    sources: [source],
    milestones,
  });
  const proposalId = first.proposals[0]?.proposalId;
  assert.ok(proposalId);
  const changed = simulatePursuitCriticalPath({
    asOfDate: "2026-08-10",
    sources: [source],
    milestones: [
      { ...milestones[0], review: { ...accepted, reviewerId: "planner-2" } },
      milestones[1],
    ],
    scenarioReviews: { [proposalId]: accepted },
  });
  assert.notEqual(changed.proposals[0]?.proposalId, proposalId);
  assert.equal(changed.status, "blocked");
});

test("resource-conflict fan-out is bounded and fails closed", () => {
  const labels = Array.from(
    { length: NEXT_CAPABILITY_MAX_ITEMS },
    (_, index) => `milestone-${index.toString().padStart(3, "0")}`,
  );
  const overlapText = `${labels.join(" ")} duration 1 day, target 2026-08-20, dependencies none, resource shared-writer.`;
  const overlapSource: SourceDocument = {
    ...source,
    sourceId: "overlap-plan",
    content: overlapText,
    contentSha256: sha256Text(overlapText),
  };
  const overlapCitation: ExactCitation = {
    sourceId: overlapSource.sourceId,
    sourceVersionId: overlapSource.versionId,
    contentSha256: overlapSource.contentSha256,
    startOffset: 0,
    endOffset: overlapText.length,
    quote: overlapText,
  };

  const result = simulatePursuitCriticalPath({
    asOfDate: "2026-08-10",
    sources: [overlapSource],
    milestones: labels.map((label) => ({
      externalId: label,
      label,
      durationDays: 1,
      targetFinishDate: "2026-08-20",
      dependencyExternalIds: [],
      resourceId: "shared-writer",
      citation: overlapCitation,
      review: accepted,
    })),
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.resourceConflicts.length, NEXT_CAPABILITY_MAX_ITEMS);
  assert.equal(
    result.issues.some(
      (issue) => issue.code === "resource_conflict_limit_exceeded",
    ),
    true,
  );
});
