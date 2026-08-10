import {
  assertBoundedItems,
  boundedProposalSafety,
  isBoundedCitationValid,
  normalizeBoundedText,
  type BoundedScope,
  type BoundedSourceCitation,
  type ProposalSafetyEnvelope,
} from "./boundedMvpContracts";

export interface ClarificationRequirement {
  id: string;
  topic: string;
  statement: string;
  value?: string | null;
  reviewState: "accepted" | "proposed" | "rejected" | "superseded";
  citation: BoundedSourceCitation;
}

export interface ClarificationSuggestionInput extends BoundedScope {
  requirements: readonly ClarificationRequirement[];
}

export type ClarificationReason =
  | "conflicting_source_values"
  | "ambiguous_source_wording"
  | "missing_explicit_value";

export interface SourceBackedClarificationSuggestion {
  suggestionId: string;
  topic: string;
  reason: ClarificationReason;
  questionText: string;
  requirementIds: string[];
  citations: BoundedSourceCitation[];
  recipient: null;
  deliveryStatus: "not_sent";
  safety: ProposalSafetyEnvelope;
}

export interface ClarificationSuggestionResult {
  suggestions: SourceBackedClarificationSuggestion[];
  excludedRequirements: Array<{
    requirementId: string;
    reason:
      | "not_accepted"
      | "citation_invalid"
      | "statement_not_in_source_quote"
      | "value_not_in_source_statement";
  }>;
}

const MAX_REQUIREMENTS = 1_000;
const AMBIGUOUS_WORDING = [
  "and/or",
  "as applicable",
  "may be required",
  "not specified",
  "to be advised",
  "to be confirmed",
  "tbc",
  "where applicable",
] as const;

function safeExcerpt(value: string): string {
  const normalized = normalizeBoundedText(value).replace(
    /[\u0000-\u001f\u007f]/gu,
    " ",
  );
  return normalized.length <= 240
    ? normalized
    : `${normalized.slice(0, 237)}...`;
}

/**
 * Proposes clarification questions only from accepted, exact source-backed
 * statements. It never chooses a recipient, sends a message, or resolves the
 * ambiguity itself.
 */
export function suggestSourceBackedClarifications(
  input: ClarificationSuggestionInput,
): ClarificationSuggestionResult {
  assertBoundedItems(
    "Clarification requirements",
    input.requirements,
    MAX_REQUIREMENTS,
  );
  const excludedRequirements: ClarificationSuggestionResult["excludedRequirements"] =
    [];
  const eligible = input.requirements
    .filter((requirement) => {
      if (requirement.reviewState !== "accepted") {
        excludedRequirements.push({
          requirementId: requirement.id,
          reason: "not_accepted",
        });
        return false;
      }
      if (!isBoundedCitationValid(requirement.citation, input)) {
        excludedRequirements.push({
          requirementId: requirement.id,
          reason: "citation_invalid",
        });
        return false;
      }
      if (
        !normalizeBoundedText(requirement.citation.quote).includes(
          normalizeBoundedText(requirement.statement),
        )
      ) {
        excludedRequirements.push({
          requirementId: requirement.id,
          reason: "statement_not_in_source_quote",
        });
        return false;
      }
      if (
        normalizeBoundedText(requirement.value ?? "") &&
        !normalizeBoundedText(requirement.statement).includes(
          normalizeBoundedText(requirement.value ?? ""),
        )
      ) {
        excludedRequirements.push({
          requirementId: requirement.id,
          reason: "value_not_in_source_statement",
        });
        return false;
      }
      return true;
    })
    .sort((left, right) => left.id.localeCompare(right.id));

  const byTopic = new Map<string, ClarificationRequirement[]>();
  for (const requirement of eligible) {
    const topic = normalizeBoundedText(requirement.topic).toLocaleLowerCase();
    if (!topic) continue;
    byTopic.set(topic, [...(byTopic.get(topic) ?? []), requirement]);
  }

  const suggestions: SourceBackedClarificationSuggestion[] = [];
  const addSuggestion = (
    topicKey: string,
    reason: ClarificationReason,
    requirements: ClarificationRequirement[],
    questionText: string,
  ) => {
    suggestions.push({
      suggestionId: `clarification:${topicKey}:${reason}`,
      topic: requirements[0]?.topic ?? topicKey,
      reason,
      questionText,
      requirementIds: requirements.map((requirement) => requirement.id),
      citations: requirements.map((requirement) => requirement.citation),
      recipient: null,
      deliveryStatus: "not_sent",
      safety: boundedProposalSafety(),
    });
  };

  for (const [topicKey, requirements] of [...byTopic].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const valued = requirements.filter(
      (requirement) => normalizeBoundedText(requirement.value ?? "").length > 0,
    );
    const uniqueValues = new Map<string, ClarificationRequirement>();
    for (const requirement of valued) {
      const value = normalizeBoundedText(
        requirement.value ?? "",
      ).toLocaleLowerCase();
      if (!uniqueValues.has(value)) uniqueValues.set(value, requirement);
    }
    if (uniqueValues.size > 1) {
      const conflicts = [...uniqueValues.values()];
      addSuggestion(
        topicKey,
        "conflicting_source_values",
        conflicts,
        `Please clarify which cited statement governs "${safeExcerpt(requirements[0]?.topic ?? topicKey)}": ${conflicts
          .map((requirement) => `"${safeExcerpt(requirement.statement)}"`)
          .join(" or ")}.`,
      );
    }

    const ambiguous = requirements.filter((requirement) => {
      const statement = normalizeBoundedText(
        requirement.statement,
      ).toLocaleLowerCase();
      return AMBIGUOUS_WORDING.some((marker) => statement.includes(marker));
    });
    if (ambiguous.length > 0) {
      addSuggestion(
        topicKey,
        "ambiguous_source_wording",
        ambiguous,
        `Please clarify the cited wording for "${safeExcerpt(requirements[0]?.topic ?? topicKey)}": "${safeExcerpt(ambiguous[0]?.statement ?? "")}".`,
      );
    }

    const missingValues = requirements.filter(
      (requirement) => !normalizeBoundedText(requirement.value ?? ""),
    );
    if (missingValues.length > 0) {
      addSuggestion(
        topicKey,
        "missing_explicit_value",
        missingValues,
        `Please provide the explicit value governing "${safeExcerpt(requirements[0]?.topic ?? topicKey)}" in the cited statement: "${safeExcerpt(missingValues[0]?.statement ?? "")}".`,
      );
    }
  }

  return { suggestions, excludedRequirements };
}
