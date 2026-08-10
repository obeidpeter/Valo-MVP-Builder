import {
  deterministicId,
  hasBlockers,
  reviewIsAccepted,
  sortIssues,
  UNREVIEWED,
  validateCitation,
  validateHumanReview,
  uniqueIds,
  type DomainIssue,
  type ExactCitation,
  type GroundedCitation,
  type HumanReview,
  type SourceDocument,
} from "./domain";
import {
  NEXT_CAPABILITY_MAX_ITEMS,
  boundedNextCapabilityRecordKeys,
  nextCapabilitySafety,
  validateNextCapabilityCollection,
  validateNextCapabilitySources,
  validateNextCapabilityText,
  type NextCapabilitySafetyEnvelope,
} from "./nextCapabilityContracts";

export type ContractDocumentStage =
  | "solicitation"
  | "submitted_bid"
  | "clarification"
  | "award"
  | "draft_contract";

export interface ContractClauseInput {
  readonly externalId: string;
  readonly stage: ContractDocumentStage;
  readonly topic: string;
  readonly text: string;
  readonly citation: ExactCitation;
  readonly review: HumanReview;
}

export interface ContractDeviationInput {
  readonly sources: readonly SourceDocument[];
  readonly clauses: readonly ContractClauseInput[];
  /** Explicit full-document snapshots to compare; defaults to earliest/latest supplied stages. */
  readonly baselineStage?: ContractDocumentStage;
  readonly comparisonStage?: ContractDocumentStage;
  readonly deviationReviews?: Readonly<Record<string, HumanReview>>;
}

export interface ContractDeviationRecord {
  readonly deviationId: string;
  readonly topic: string;
  readonly baselineStage: ContractDocumentStage;
  readonly comparisonStage: ContractDocumentStage;
  readonly baselineText: string;
  readonly comparisonText: string;
  readonly classification: "changed" | "omitted" | "new_obligation";
  readonly citations: readonly GroundedCitation[];
  readonly review: HumanReview;
  readonly acceptedAsTerm: false;
}

export interface ContractDeviationResult {
  readonly comparisonId: string;
  readonly status: "blocked" | "review_required" | "ready";
  readonly readyForUse: boolean;
  readonly deviations: readonly ContractDeviationRecord[];
  readonly issues: readonly DomainIssue[];
  readonly safety: NextCapabilitySafetyEnvelope;
  readonly contractualAcceptanceAuthority: "none";
}

const STAGE_ORDER: readonly ContractDocumentStage[] = [
  "solicitation",
  "submitted_bid",
  "clarification",
  "award",
  "draft_contract",
];

function citationSupportsStage(
  stage: ContractDocumentStage,
  citation: GroundedCitation,
): boolean {
  if (citation.sourceAuthority === "unverified") return false;
  const origin = citation.sourceOrigin.toLowerCase();
  if (stage === "solicitation") {
    return (
      citation.sourceKind === "solicitation" || origin.includes("solicitation")
    );
  }
  if (stage === "clarification") {
    return (
      citation.sourceKind === "addendum" || origin.includes("clarification")
    );
  }
  if (stage === "submitted_bid") {
    return /submitted[_-]?bid/u.test(origin);
  }
  if (stage === "award") return origin.includes("award");
  return /(?:draft[_-]?)?contract/u.test(origin);
}

/** Compares reviewed clauses without accepting terms or communicating a redline. */
export function compareTenderToContract(
  input: ContractDeviationInput,
): ContractDeviationResult {
  const { sourceSet, issues: sourceIssues } = validateNextCapabilitySources(
    input.sources,
    "Tender-to-contract sources",
  );
  const clauseInputs = input.clauses.slice(0, NEXT_CAPABILITY_MAX_ITEMS);
  const issues: DomainIssue[] = [
    ...sourceIssues,
    ...validateNextCapabilityCollection(input.clauses, "clauses", "Clauses"),
    ...uniqueIds(clauseInputs, "clauses"),
  ];
  const clauses = clauseInputs.flatMap((clause, index) => {
    const path = `clauses[${index}]`;
    const citation = validateCitation(
      clause.citation,
      sourceSet.byKey,
      `${path}.citation`,
    );
    const local = [
      ...citation.issues,
      ...validateHumanReview(clause.review, `${path}.review`),
      ...validateNextCapabilityText(
        clause.topic,
        `${path}.topic`,
        "Clause topic",
      ),
      ...validateNextCapabilityText(clause.text, `${path}.text`, "Clause text"),
    ];
    if (!STAGE_ORDER.includes(clause.stage)) {
      local.push({
        code: "invalid_contract_stage",
        severity: "blocker" as const,
        path: `${path}.stage`,
        message: "The contract comparison stage is not recognized.",
      });
    }
    if (
      citation.citation &&
      !citation.citation.quote.includes(clause.text.trim())
    ) {
      local.push({
        code: "contract_clause_not_exact",
        severity: "blocker" as const,
        path: `${path}.text`,
        message: "Clause text must occur exactly in its cited source quote.",
      });
    }
    if (
      citation.citation &&
      (!citationSupportsStage(clause.stage, citation.citation) ||
        !citation.citation.quote
          .toLowerCase()
          .includes(clause.topic.trim().toLowerCase()))
    ) {
      local.push({
        code: "contract_clause_metadata_not_grounded",
        severity: "blocker" as const,
        path,
        message:
          "Clause topic and reviewed document stage must match verified source provenance.",
      });
    }
    issues.push(...local);
    return local.some((issue) => issue.severity === "blocker") ||
      !citation.citation ||
      !reviewIsAccepted(clause.review)
      ? []
      : [{ ...clause, citation: citation.citation }];
  });

  const suppliedStages = STAGE_ORDER.filter((stage) =>
    clauses.some((clause) => clause.stage === stage),
  );
  const baselineStage = input.baselineStage ?? suppliedStages[0];
  const comparisonStage = input.comparisonStage ?? suppliedStages.at(-1);
  if (
    !baselineStage ||
    !comparisonStage ||
    !STAGE_ORDER.includes(baselineStage) ||
    !STAGE_ORDER.includes(comparisonStage) ||
    STAGE_ORDER.indexOf(baselineStage) >= STAGE_ORDER.indexOf(comparisonStage)
  ) {
    issues.push({
      code: "invalid_contract_comparison_window",
      severity: "blocker",
      path: "comparisonStage",
      message:
        "Contract deviation review requires an earlier baseline and a later comparison stage.",
    });
  } else if (
    !clauses.some((clause) => clause.stage === baselineStage) ||
    !clauses.some((clause) => clause.stage === comparisonStage)
  ) {
    issues.push({
      code: "contract_comparison_snapshot_missing",
      severity: "blocker",
      path: "clauses",
      message:
        "Both compared document stages require at least one reviewed, source-grounded clause snapshot.",
    });
  }

  const byTopic = new Map<string, typeof clauses>();
  for (const clause of clauses) {
    const key = clause.topic.trim().toLowerCase();
    byTopic.set(key, [...(byTopic.get(key) ?? []), clause]);
  }
  const deviations: ContractDeviationRecord[] = [];
  for (const [topicKey, topicClauses] of byTopic) {
    if (!baselineStage || !comparisonStage) continue;
    const baselines = topicClauses.filter(
      (clause) => clause.stage === baselineStage,
    );
    const comparisons = topicClauses.filter(
      (clause) => clause.stage === comparisonStage,
    );
    if (baselines.length > 1 || comparisons.length > 1) {
      issues.push({
        code: "ambiguous_contract_topic_stage",
        severity: "blocker",
        path: `clauses.${topicKey}`,
        message:
          "Each topic may have at most one reviewed clause in each compared document snapshot.",
      });
      continue;
    }
    const baseline = baselines[0];
    const comparison = comparisons[0];
    if (!baseline && !comparison) continue;
    const normalizedBaseline =
      baseline?.text.trim().replace(/\s+/gu, " ") ?? "";
    const normalizedComparison =
      comparison?.text.trim().replace(/\s+/gu, " ") ?? "";
    if (normalizedBaseline === normalizedComparison) continue;
    const classification = !baseline
      ? "new_obligation"
      : !comparison
        ? "omitted"
        : "changed";
    const citations = [baseline?.citation, comparison?.citation].filter(
      (citation): citation is GroundedCitation => Boolean(citation),
    );
    const clauseReviews = [baseline?.review, comparison?.review].filter(
      (review): review is HumanReview => Boolean(review),
    );
    const externalIds = [baseline?.externalId, comparison?.externalId].filter(
      (externalId): externalId is string => Boolean(externalId),
    );
    const deviationId = deterministicId("deviation", {
      topicKey,
      baselineStage,
      comparisonStage,
      baselineText: normalizedBaseline,
      comparisonText: normalizedComparison,
      citationIds: citations.map((citation) => citation.citationId),
      clauseReviews,
      externalIds,
    });
    const review = input.deviationReviews?.[deviationId] ?? UNREVIEWED;
    issues.push(
      ...validateHumanReview(review, `deviationReviews.${deviationId}`),
    );
    deviations.push({
      deviationId,
      topic: baseline?.topic ?? comparison!.topic,
      baselineStage,
      comparisonStage,
      baselineText: baseline?.text ?? "",
      comparisonText: comparison?.text ?? "",
      classification,
      citations,
      review,
      acceptedAsTerm: false,
    });
  }
  deviations.sort((left, right) =>
    left.deviationId.localeCompare(right.deviationId),
  );
  const deviationReviewKeys = boundedNextCapabilityRecordKeys(
    input.deviationReviews,
    "deviationReviews",
    "Deviation reviews",
  );
  issues.push(...deviationReviewKeys.issues);
  for (const deviationId of deviationReviewKeys.keys) {
    if (
      !deviations.some((deviation) => deviation.deviationId === deviationId)
    ) {
      issues.push({
        code: "orphan_deviation_review",
        severity: "blocker",
        path: `deviationReviews.${deviationId}`,
        message: "A review must bind to a deviation in this exact comparison.",
      });
    }
  }
  const comparisonId = deterministicId("contractcmp", {
    baselineStage,
    comparisonStage,
    deviationIds: deviations.map((deviation) => deviation.deviationId),
  });
  const sortedIssues = sortIssues(issues);
  const blocked = hasBlockers(sortedIssues);
  const readyForUse =
    !blocked &&
    deviations.length > 0 &&
    deviations.every((deviation) => reviewIsAccepted(deviation.review));
  return {
    comparisonId,
    status: blocked ? "blocked" : readyForUse ? "ready" : "review_required",
    readyForUse,
    deviations,
    issues: sortedIssues,
    safety: nextCapabilitySafety(),
    contractualAcceptanceAuthority: "none",
  };
}
