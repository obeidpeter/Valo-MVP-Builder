import {
  assertBoundedItems,
  assertBoundedText,
  boundedProposalSafety,
  isBoundedCitationValid,
  normalizeBoundedText,
  type BoundedScope,
  type BoundedSourceCitation,
  type ProposalSafetyEnvelope,
} from "./boundedMvpContracts";

export interface GroundedCopilotFact {
  id: string;
  statement: string;
  topicTags?: readonly string[];
  reviewState: "accepted" | "proposed" | "rejected" | "superseded";
  allowedRoles: readonly string[];
  citation: BoundedSourceCitation;
}

export type GroundedCopilotExclusionReason =
  | "duplicate_fact_id"
  | "fact_not_accepted"
  | "role_not_permitted"
  | "citation_invalid"
  | "statement_not_in_source_quote"
  | "not_relevant";

export interface GroundedCopilotPlannedClaim {
  factId: string;
  exactClaimText: string;
  citation: BoundedSourceCitation;
  matchedQueryTerms: string[];
}

export interface GroundedCopilotPlanInput extends BoundedScope {
  role: string;
  query: string;
  facts: readonly GroundedCopilotFact[];
  maxClaims?: number;
}

export interface GroundedCopilotPlan {
  status: "plan_ready" | "abstain";
  answerMode: "extractive_claim_plan";
  queryTerms: string[];
  plannedClaims: GroundedCopilotPlannedClaim[];
  excludedFacts: Array<{
    factId: string;
    reasons: GroundedCopilotExclusionReason[];
  }>;
  abstentionReason?:
    | "query_has_no_meaningful_terms"
    | "no_grounded_fact_matches";
  safety: ProposalSafetyEnvelope;
}

const MAX_QUERY_CHARS = 1_000;
const MAX_FACTS = 500;
const MAX_CLAIMS = 10;
const WORDS = /[\p{L}\p{N}]{2,}/gu;
const STOP_WORDS = new Set([
  "about",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "can",
  "do",
  "does",
  "for",
  "from",
  "has",
  "have",
  "how",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "was",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "will",
  "with",
]);

function terms(value: string): string[] {
  const matches =
    normalizeBoundedText(value).toLocaleLowerCase().match(WORDS) ?? [];
  return [...new Set(matches.filter((word) => !STOP_WORDS.has(word)))].sort();
}

/**
 * Plans an extractive, citation-backed answer without calling a model. It does
 * not compose prose: every planned claim is an accepted statement that occurs
 * in an active, in-scope source quote and is visible to the caller's role.
 */
export function planGroundedCopilotAnswer(
  input: GroundedCopilotPlanInput,
): GroundedCopilotPlan {
  assertBoundedText("Copilot query", input.query, MAX_QUERY_CHARS);
  assertBoundedItems("Copilot facts", input.facts, MAX_FACTS);

  const queryTerms = terms(input.query);
  const requestedLimit = input.maxClaims ?? 5;
  if (!Number.isFinite(requestedLimit) || requestedLimit < 1) {
    throw new RangeError("Copilot maxClaims must be a positive finite number.");
  }
  const limit = Math.min(MAX_CLAIMS, Math.trunc(requestedLimit));
  const excludedFacts: GroundedCopilotPlan["excludedFacts"] = [];
  const candidates: Array<GroundedCopilotPlannedClaim & { score: number }> = [];
  const seenFactIds = new Set<string>();

  for (const fact of [...input.facts].sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    if (seenFactIds.has(fact.id)) {
      excludedFacts.push({ factId: fact.id, reasons: ["duplicate_fact_id"] });
      continue;
    }
    seenFactIds.add(fact.id);
    const reasons: GroundedCopilotExclusionReason[] = [];
    if (fact.reviewState !== "accepted") reasons.push("fact_not_accepted");
    if (!fact.allowedRoles.includes(input.role))
      reasons.push("role_not_permitted");
    if (!isBoundedCitationValid(fact.citation, input)) {
      reasons.push("citation_invalid");
    }
    if (
      !normalizeBoundedText(fact.citation.quote).includes(
        normalizeBoundedText(fact.statement),
      )
    ) {
      reasons.push("statement_not_in_source_quote");
    }

    const factTerms = new Set(
      terms(`${fact.statement} ${(fact.topicTags ?? []).join(" ")}`),
    );
    const matchedQueryTerms = queryTerms.filter((term) => factTerms.has(term));
    if (queryTerms.length > 0 && matchedQueryTerms.length === 0) {
      reasons.push("not_relevant");
    }

    if (reasons.length > 0) {
      excludedFacts.push({ factId: fact.id, reasons });
      continue;
    }
    candidates.push({
      factId: fact.id,
      exactClaimText: fact.statement,
      citation: fact.citation,
      matchedQueryTerms,
      score: matchedQueryTerms.length,
    });
  }

  const plannedClaims = candidates
    .sort(
      (left, right) =>
        right.score - left.score || left.factId.localeCompare(right.factId),
    )
    .slice(0, limit)
    .map(({ score: _score, ...claim }) => claim);

  const abstentionReason =
    queryTerms.length === 0
      ? "query_has_no_meaningful_terms"
      : plannedClaims.length === 0
        ? "no_grounded_fact_matches"
        : undefined;

  return {
    status: abstentionReason ? "abstain" : "plan_ready",
    answerMode: "extractive_claim_plan",
    queryTerms,
    plannedClaims: abstentionReason ? [] : plannedClaims,
    excludedFacts,
    ...(abstentionReason ? { abstentionReason } : {}),
    safety: boundedProposalSafety(),
  };
}
