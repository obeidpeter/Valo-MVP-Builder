import {
  deterministicId,
  hasBlockers,
  reviewIsAccepted,
  sortIssues,
  UNREVIEWED,
  validateCitations,
  validateHumanReview,
  type DomainIssue,
  type ExactCitation,
  type GroundedCitation,
  type HumanReview,
  type SourceDocument,
  type SubjectReview,
  resolveSubjectReview,
  uniqueIds,
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

export type NigerianContentCategory =
  | "personnel"
  | "equipment"
  | "facility"
  | "subcontracting"
  | "training";

export interface NigerianContentFactInput {
  readonly externalId: string;
  readonly category: NigerianContentCategory;
  readonly statement: string;
  readonly quantifiedValue?: number;
  readonly quantifiedUnit?: "count" | "percent" | "days" | "hours";
  readonly citations: readonly ExactCitation[];
  readonly availabilityReview: HumanReview;
}

export interface NigerianContentComposerInput {
  readonly sources: readonly SourceDocument[];
  readonly facts: readonly NigerianContentFactInput[];
  readonly lineReviews?: Readonly<Record<string, HumanReview>>;
  readonly planReview?: SubjectReview;
}

export interface NigerianContentPlanLine {
  readonly lineId: string;
  readonly category: NigerianContentCategory;
  readonly statement: string;
  readonly quantifiedValue?: number;
  readonly quantifiedUnit?: NigerianContentFactInput["quantifiedUnit"];
  readonly citations: readonly GroundedCitation[];
  readonly review: HumanReview;
  readonly usable: boolean;
}

export interface NigerianContentPlanResult {
  readonly planId: string;
  readonly status: "blocked" | "review_required" | "ready";
  readonly readyForUse: boolean;
  readonly lines: readonly NigerianContentPlanLine[];
  readonly planReview: HumanReview;
  readonly issues: readonly DomainIssue[];
  readonly safety: NextCapabilitySafetyEnvelope;
  readonly commitmentAuthority: "none";
}

const CATEGORIES = new Set<NigerianContentCategory>([
  "personnel",
  "equipment",
  "facility",
  "subcontracting",
  "training",
]);
const QUANTITY_UNITS = new Set<
  NonNullable<NigerianContentFactInput["quantifiedUnit"]>
>(["count", "percent", "days", "hours"]);
const MAX_COUNT = 1_000_000_000;
const MAX_DAYS = 3_650;
const MAX_HOURS = 87_600;
const CATEGORY_TERMS: Readonly<Record<NigerianContentCategory, RegExp>> = {
  personnel:
    /\b(personnel|staff|employee|engineers?|specialists?|workforce)\b/iu,
  equipment: /\b(equipment|machinery|vehicles?|tools?)\b/iu,
  facility: /\b(facility|facilities|office|plant|warehouse|yard)\b/iu,
  subcontracting: /\b(subcontract(?:or|ing)?|supplier|vendor|partner)\b/iu,
  training: /\b(training|course|apprentice|skills? development)\b/iu,
};

/**
 * Composes a reviewable Nigerian-content schedule from verified company facts.
 * It never invents capacity, binds a supplier, or makes an external commitment.
 */
export function composeNigerianContentPlan(
  input: NigerianContentComposerInput,
): NigerianContentPlanResult {
  const { sourceSet, issues: sourceIssues } = validateNextCapabilitySources(
    input.sources,
    "Nigerian-content sources",
  );
  const factInputs = input.facts.slice(0, NEXT_CAPABILITY_MAX_ITEMS);
  const issues: DomainIssue[] = [
    ...sourceIssues,
    ...validateNextCapabilityCollection(input.facts, "facts", "Facts"),
    ...uniqueIds(factInputs, "facts"),
  ];
  const lines: NigerianContentPlanLine[] = [];

  factInputs.forEach((fact, index) => {
    const path = `facts[${index}]`;
    issues.push(
      ...validateNextCapabilityCollection(
        fact.citations,
        `${path}.citations`,
        "Fact citations",
      ),
    );
    const citations = validateCitations(
      fact.citations.slice(0, NEXT_CAPABILITY_MAX_ITEMS),
      sourceSet.byKey,
      `${path}.citations`,
    );
    const localIssues: DomainIssue[] = [
      ...citations.issues,
      ...validateHumanReview(
        fact.availabilityReview,
        `${path}.availabilityReview`,
      ),
      ...validateNextCapabilityText(
        fact.statement,
        `${path}.statement`,
        "Statement",
      ),
    ];
    if (!CATEGORIES.has(fact.category)) {
      localIssues.push({
        code: "invalid_nigerian_content_category",
        severity: "blocker",
        path: `${path}.category`,
        message: "Nigerian-content facts must use a recognized category.",
      });
    } else if (!CATEGORY_TERMS[fact.category].test(fact.statement)) {
      localIssues.push({
        code: "nigerian_content_category_not_cited",
        severity: "blocker",
        path: `${path}.category`,
        message:
          "The selected Nigerian-content category must be stated in the exact cited fact.",
      });
    }
    if (
      fact.quantifiedValue != null &&
      (!Number.isFinite(fact.quantifiedValue) ||
        fact.quantifiedValue < 0 ||
        fact.quantifiedValue > MAX_COUNT ||
        (fact.quantifiedUnit === "count" &&
          !Number.isSafeInteger(fact.quantifiedValue)) ||
        (fact.quantifiedUnit === "percent" && fact.quantifiedValue > 100) ||
        (fact.quantifiedUnit === "days" && fact.quantifiedValue > MAX_DAYS) ||
        (fact.quantifiedUnit === "hours" && fact.quantifiedValue > MAX_HOURS))
    ) {
      localIssues.push({
        code: "invalid_nigerian_content_quantity",
        severity: "blocker",
        path: `${path}.quantifiedValue`,
        message:
          "Quantified values must be finite and bounded; counts must be safe whole numbers, percentages cannot exceed 100, and durations cannot exceed ten years.",
      });
    }
    if ((fact.quantifiedValue == null) !== (fact.quantifiedUnit == null)) {
      localIssues.push({
        code: "incomplete_nigerian_content_quantity",
        severity: "blocker",
        path,
        message: "A quantified value and its unit must be supplied together.",
      });
    }
    if (
      fact.quantifiedUnit != null &&
      !QUANTITY_UNITS.has(fact.quantifiedUnit)
    ) {
      localIssues.push({
        code: "invalid_nigerian_content_unit",
        severity: "blocker",
        path: `${path}.quantifiedUnit`,
        message: "Quantified plan facts must use a recognized closed-set unit.",
      });
    }
    if (
      fact.quantifiedValue != null &&
      fact.quantifiedUnit != null &&
      !statementContainsQuantity(
        fact.statement,
        fact.quantifiedValue,
        fact.quantifiedUnit,
      )
    ) {
      localIssues.push({
        code: "nigerian_content_quantity_not_cited",
        severity: "blocker",
        path: `${path}.quantifiedValue`,
        message:
          "A quantified value and unit must be stated in the exact cited plan fact.",
      });
    }
    if (
      citations.citations.some(
        (citation) =>
          citation.sourceKind !== "company_evidence" ||
          citation.sourceAuthority === "unverified",
      )
    ) {
      localIssues.push({
        code: "nigerian_content_source_not_verified",
        severity: "blocker",
        path: `${path}.citations`,
        message: "Plan facts require verified company-evidence sources.",
      });
    }
    if (
      citations.citations.length > 0 &&
      !citations.citations.some((citation) =>
        citation.quote.includes(fact.statement.trim()),
      )
    ) {
      localIssues.push({
        code: "nigerian_content_statement_not_exact",
        severity: "blocker",
        path: `${path}.statement`,
        message:
          "The proposed statement must occur exactly in a cited source quote.",
      });
    }
    issues.push(...localIssues);
    if (localIssues.some((issue) => issue.severity === "blocker")) return;

    const lineId = deterministicId("ngcline", {
      externalId: fact.externalId,
      category: fact.category,
      statement: fact.statement,
      quantifiedValue: fact.quantifiedValue,
      quantifiedUnit: fact.quantifiedUnit,
      citationIds: citations.citations.map((citation) => citation.citationId),
      availabilityReview: fact.availabilityReview,
    });
    const review = input.lineReviews?.[lineId] ?? UNREVIEWED;
    issues.push(...validateHumanReview(review, `lineReviews.${lineId}`));
    lines.push({
      lineId,
      category: fact.category,
      statement: fact.statement,
      quantifiedValue: fact.quantifiedValue,
      quantifiedUnit: fact.quantifiedUnit,
      citations: citations.citations,
      review,
      usable:
        reviewIsAccepted(fact.availabilityReview) && reviewIsAccepted(review),
    });
  });

  lines.sort((left, right) => left.lineId.localeCompare(right.lineId));
  const planId = deterministicId("ngcplan", {
    lines: lines.map((line) => ({ lineId: line.lineId, review: line.review })),
  });
  const planReview = resolveSubjectReview(
    planId,
    input.planReview,
    "planReview",
  );
  issues.push(...planReview.issues);
  const lineReviewKeys = boundedNextCapabilityRecordKeys(
    input.lineReviews,
    "lineReviews",
    "Plan-line reviews",
  );
  issues.push(...lineReviewKeys.issues);
  for (const reviewedId of lineReviewKeys.keys) {
    if (!lines.some((line) => line.lineId === reviewedId)) {
      issues.push({
        code: "orphan_nigerian_content_review",
        severity: "blocker",
        path: `lineReviews.${reviewedId}`,
        message: "A line review must bind to a line in this exact plan.",
      });
    }
  }
  const sortedIssues = sortIssues(issues);
  const blocked = hasBlockers(sortedIssues);
  const readyForUse =
    !blocked &&
    lines.length > 0 &&
    lines.every((line) => line.usable) &&
    reviewIsAccepted(planReview.review);
  return {
    planId,
    status: blocked ? "blocked" : readyForUse ? "ready" : "review_required",
    readyForUse,
    lines: lines.map((line) => ({
      ...line,
      usable: readyForUse && line.usable,
    })),
    planReview: planReview.review,
    issues: sortedIssues,
    safety: nextCapabilitySafety(2),
    commitmentAuthority: "none",
  };
}

function statementContainsQuantity(
  statement: string,
  value: number,
  unit: NonNullable<NigerianContentFactInput["quantifiedUnit"]>,
): boolean {
  const normalized = statement.toLowerCase();
  const valueText = String(value).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const hasValue = new RegExp(`(^|[^0-9.])${valueText}([^0-9.]|$)`, "u").test(
    normalized,
  );
  if (!hasValue) return false;
  const followedBy = (suffix: string) =>
    new RegExp(`${valueText}\\s*(?:${suffix})\\b`, "u").test(normalized);
  if (unit === "percent") {
    return (
      new RegExp(`${valueText}\\s*%`, "u").test(normalized) ||
      followedBy("percent")
    );
  }
  if (unit === "days") return followedBy("days?");
  if (unit === "hours") return followedBy("hours?");
  return !new RegExp(
    `${valueText}\\s*(?:%|percent\\b|days?\\b|hours?\\b)`,
    "u",
  ).test(normalized);
}
