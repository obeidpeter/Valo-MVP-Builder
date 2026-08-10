import assert from "node:assert/strict";
import test from "node:test";
import {
  planGroundedCopilotAnswer,
  type GroundedCopilotFact,
} from "./boundedMvpGroundedCopilot";
import type { BoundedSourceCitation } from "./boundedMvpContracts";

const scope = { organisationId: "org-a", projectId: "project-a" };
const sourceSha256 = "a".repeat(64);

function citation(
  quote: string,
  overrides: Partial<BoundedSourceCitation> = {},
): BoundedSourceCitation {
  return {
    ...scope,
    documentId: "document-1",
    documentVersionId: "document-1-v1",
    sourceSha256,
    pageNumber: 4,
    quote,
    canonicalPageText: `Tender conditions. ${quote} End of page.`,
    lifecycleState: "active",
    ...overrides,
  };
}

function fact(
  overrides: Partial<GroundedCopilotFact> = {},
): GroundedCopilotFact {
  return {
    id: "fact-deadline",
    statement: "Submission deadline is 30 September 2026 at 12:00 WAT.",
    topicTags: ["deadline", "submission"],
    reviewState: "accepted",
    allowedRoles: ["reviewer"],
    citation: citation(
      "Submission deadline is 30 September 2026 at 12:00 WAT.",
    ),
    ...overrides,
  };
}

test("plans only extractive accepted facts with exact active citations", () => {
  const result = planGroundedCopilotAnswer({
    ...scope,
    role: "reviewer",
    query: "What is the submission deadline?",
    facts: [
      fact(),
      fact({
        id: "proposed",
        reviewState: "proposed",
      }),
      fact({
        id: "foreign",
        citation: citation(
          "Submission deadline is 30 September 2026 at 12:00 WAT.",
          {
            organisationId: "org-b",
          },
        ),
      }),
      fact({
        id: "restricted",
        allowedRoles: ["administrator"],
      }),
    ],
  });

  assert.equal(result.status, "plan_ready");
  assert.deepEqual(
    result.plannedClaims.map((claim) => claim.factId),
    ["fact-deadline"],
  );
  assert.equal(result.plannedClaims[0]?.exactClaimText, fact().statement);
  assert.equal(result.safety.externalAction, "none");
  assert.equal(result.safety.authoritativeStateChange, false);
  assert.equal(result.excludedFacts.length, 3);
});

test("abstains rather than synthesising when no grounded fact matches", () => {
  const result = planGroundedCopilotAnswer({
    ...scope,
    role: "reviewer",
    query: "Who is the procuring entity?",
    facts: [fact()],
  });

  assert.equal(result.status, "abstain");
  assert.equal(result.abstentionReason, "no_grounded_fact_matches");
  assert.deepEqual(result.plannedClaims, []);
});

test("rejects a fact whose statement is not present in its source quote", () => {
  const result = planGroundedCopilotAnswer({
    ...scope,
    role: "reviewer",
    query: "What is the submission deadline?",
    facts: [fact({ statement: "Submission deadline is tomorrow." })],
  });

  assert.equal(result.status, "abstain");
  assert.deepEqual(result.excludedFacts[0]?.reasons, [
    "statement_not_in_source_quote",
  ]);
});
