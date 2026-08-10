import assert from "node:assert/strict";
import test from "node:test";
import type { BoundedSourceCitation } from "./boundedMvpContracts";
import {
  proposeAwardToDeliveryHandoff,
  type SourceBackedAwardObligation,
} from "./boundedMvpAwardHandoff";

const scope = { organisationId: "org-a", projectId: "project-a" };
function citation(quote: string): BoundedSourceCitation {
  return {
    ...scope,
    documentId: "award-letter",
    documentVersionId: "award-letter-v1",
    sourceSha256: "1".repeat(64),
    pageNumber: 1,
    quote,
    canonicalPageText: quote,
    lifecycleState: "active",
  };
}

function obligation(
  id: string,
  title: string,
  quote: string,
  overrides: Partial<SourceBackedAwardObligation> = {},
): SourceBackedAwardObligation {
  return {
    id,
    title,
    kind: "deliverable",
    reviewState: "accepted",
    citation: citation(quote),
    ...overrides,
  };
}

test("creates only internal, source-backed draft task proposals", () => {
  const result = proposeAwardToDeliveryHandoff({
    ...scope,
    awardId: "award-1",
    asOfIso: "2026-09-01T00:00:00Z",
    obligations: [
      obligation(
        "kickoff",
        "Hold project kickoff",
        "Hold project kickoff by 15 September 2026. Owner: Amina Bello.",
        {
          dueDate: {
            dueAtIso: "2026-09-15T17:00:00Z",
            sourceDateText: "15 September 2026",
          },
          ownerCandidate: {
            userId: "user-amina",
            displayName: "Amina Bello",
            citation: citation("Owner: Amina Bello."),
          },
        },
      ),
      obligation(
        "report",
        "Submit inception report",
        "Submit inception report after project kickoff.",
        { dependsOnObligationIds: ["kickoff"] },
      ),
    ],
  });

  assert.equal(result.proposals.length, 2);
  assert.equal(result.proposals[0]?.proposedOwnerId, "user-amina");
  assert.deepEqual(result.proposals[1]?.dependsOnProposalIds, [
    "award-handoff:award-1:kickoff",
  ]);
  for (const proposal of result.proposals) {
    assert.equal(proposal.approvalState, "proposed");
    assert.equal(proposal.actionClass, "internal_draft_task");
    assert.equal(proposal.externalCommitment, false);
  }
  assert.equal(result.handoffAuthorized, false);
  assert.equal(result.safety.authoritativeStateChange, false);
});

test("excludes unaccepted and foreign obligations", () => {
  const foreignCitation = citation("Deliver training materials.");
  foreignCitation.organisationId = "org-b";
  const result = proposeAwardToDeliveryHandoff({
    ...scope,
    awardId: "award-1",
    asOfIso: "2026-09-01T00:00:00Z",
    obligations: [
      obligation("proposed", "Deliver draft", "Deliver draft.", {
        reviewState: "proposed",
      }),
      obligation(
        "foreign",
        "Deliver training materials",
        "Deliver training materials.",
        {
          citation: foreignCitation,
        },
      ),
    ],
  });

  assert.deepEqual(result.proposals, []);
  assert.deepEqual(
    result.issues.map((issue) => issue.code),
    ["obligation_not_accepted", "obligation_citation_invalid"],
  );
});

test("leaves unsupported dates, owners, and dependencies as review issues", () => {
  const result = proposeAwardToDeliveryHandoff({
    ...scope,
    awardId: "award-2",
    asOfIso: "2026-10-01T00:00:00Z",
    obligations: [
      obligation(
        "handoff",
        "Complete handoff",
        "Complete handoff. Owner is unassigned.",
        {
          dueDate: {
            dueAtIso: "2026-09-01T00:00:00Z",
            sourceDateText: "1 September 2026",
          },
          ownerCandidate: {
            userId: "invented-user",
            displayName: "Invented Owner",
            citation: citation("Owner is unassigned."),
          },
          dependsOnObligationIds: ["missing"],
        },
      ),
    ],
  });

  assert.equal(result.proposals[0]?.proposedDueAtIso, null);
  assert.equal(result.proposals[0]?.proposedOwnerId, null);
  const codes = result.issues.map((issue) => issue.code);
  assert.equal(codes.includes("due_date_not_in_source"), true);
  assert.equal(codes.includes("owner_candidate_invalid"), true);
  assert.equal(codes.includes("dependency_unknown"), true);
});
