import assert from "node:assert/strict";
import test from "node:test";
import type { BoundedSourceCitation } from "./boundedMvpContracts";
import {
  suggestSourceBackedClarifications,
  type ClarificationRequirement,
} from "./boundedMvpClarifications";

const scope = { organisationId: "org-a", projectId: "project-a" };
function citation(statement: string): BoundedSourceCitation {
  return {
    ...scope,
    documentId: "tender",
    documentVersionId: "tender-v1",
    sourceSha256: "e".repeat(64),
    pageNumber: 1,
    quote: statement,
    canonicalPageText: statement,
    lifecycleState: "active",
  };
}

function requirement(
  id: string,
  statement: string,
  value: string | null,
  overrides: Partial<ClarificationRequirement> = {},
): ClarificationRequirement {
  return {
    id,
    topic: "Delivery period",
    statement,
    value,
    reviewState: "accepted",
    citation: citation(statement),
    ...overrides,
  };
}

test("proposes source-backed conflict and ambiguity questions without sending", () => {
  const result = suggestSourceBackedClarifications({
    ...scope,
    requirements: [
      requirement("one", "Delivery shall occur within 14 days.", "14 days"),
      requirement("two", "Delivery shall occur within 30 days.", "30 days"),
      requirement(
        "three",
        "A shorter period may be required as applicable.",
        null,
      ),
    ],
  });

  const reasons = result.suggestions.map((suggestion) => suggestion.reason);
  assert.equal(reasons.includes("conflicting_source_values"), true);
  assert.equal(reasons.includes("ambiguous_source_wording"), true);
  assert.equal(reasons.includes("missing_explicit_value"), true);
  for (const suggestion of result.suggestions) {
    assert.equal(suggestion.recipient, null);
    assert.equal(suggestion.deliveryStatus, "not_sent");
    assert.equal(suggestion.safety.authoritativeStateChange, false);
  }
});

test("excludes proposed, foreign, and non-source-backed requirements", () => {
  const foreignCitation = citation("Delivery is within 7 days.");
  foreignCitation.projectId = "project-b";
  const result = suggestSourceBackedClarifications({
    ...scope,
    requirements: [
      requirement("proposed", "Delivery is TBC.", null, {
        reviewState: "proposed",
      }),
      requirement("foreign", "Delivery is within 7 days.", "7 days", {
        citation: foreignCitation,
      }),
      requirement("invented", "Delivery is within 3 days.", "3 days", {
        citation: citation("Delivery is within 30 days."),
      }),
    ],
  });

  assert.deepEqual(result.suggestions, []);
  assert.deepEqual(
    result.excludedRequirements.map((excluded) => excluded.reason),
    ["not_accepted", "citation_invalid", "statement_not_in_source_quote"],
  );
});
