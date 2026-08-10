import {
  deterministicId,
  hasBlockers,
  isValidId,
  resolveSubjectReview,
  reviewIsAccepted,
  sortIssues,
  uniqueIds,
  validateCitations,
  validateHumanReview,
  type DomainIssue,
  type ExactCitation,
  type GroundedCitation,
  type HumanReview,
  type SourceDocument,
  type SubjectReview,
} from "./domain";
import {
  NEXT_CAPABILITY_MAX_ITEMS,
  nextCapabilitySafety,
  validateNextCapabilityCollection,
  validateNextCapabilitySources,
  validateNextCapabilityText,
  type NextCapabilitySafetyEnvelope,
} from "./nextCapabilityContracts";

export interface PublishedEvaluationCriterionInput {
  readonly externalId: string;
  readonly label: string;
  readonly publishedMaxPoints: number;
  readonly mandatory: boolean;
  readonly publishedMinimumPoints?: number;
  readonly citations: readonly ExactCitation[];
  readonly review: HumanReview;
}

export interface EvaluationEvidenceMappingInput {
  readonly externalId: string;
  readonly criterionExternalId: string;
  readonly evidenceLabel: string;
  readonly documentedSupportedPoints: number;
  readonly rationale: string;
  readonly citations: readonly ExactCitation[];
  readonly review: HumanReview;
}

export interface EvaluationScorePlannerInput {
  readonly sources: readonly SourceDocument[];
  readonly criteria: readonly PublishedEvaluationCriterionInput[];
  readonly mappings: readonly EvaluationEvidenceMappingInput[];
  readonly planReview?: SubjectReview;
}

export interface PublishedEvaluationCriterionRecord extends PublishedEvaluationCriterionInput {
  readonly criterionId: string;
  readonly citations: readonly GroundedCitation[];
}

export interface EvaluationEvidenceMappingRecord extends EvaluationEvidenceMappingInput {
  readonly mappingId: string;
  readonly criterionId: string;
  readonly citations: readonly GroundedCitation[];
}

export interface EvaluationCriterionProjection {
  readonly criterionId: string;
  readonly state:
    | "pending_review"
    | "unsupported"
    | "partially_supported"
    | "fully_supported";
  readonly publishedMaxPoints: number;
  readonly documentedSupportedPoints: number;
  readonly documentedGapPoints: number;
  readonly mappingIds: readonly string[];
}

export interface EvaluationScorePlannerResult {
  readonly planId: string;
  readonly status: "blocked" | "incomplete" | "review_required" | "ready";
  readonly readyForPlanningUse: boolean;
  readonly publishedMaximumPoints: number;
  readonly documentedSupportedPoints: number;
  readonly mandatoryGapCount: number;
  readonly criteria: readonly PublishedEvaluationCriterionRecord[];
  readonly mappings: readonly EvaluationEvidenceMappingRecord[];
  readonly projections: readonly EvaluationCriterionProjection[];
  readonly review: HumanReview;
  readonly issues: readonly DomainIssue[];
  readonly awardProbability: null;
  readonly evaluatorBehaviourPrediction: false;
  readonly awardDecisionAuthorized: false;
  readonly safety: NextCapabilitySafetyEnvelope;
}

const MAX_POINTS = 1_000_000;

function validPoints(value: number, allowZero: boolean): boolean {
  return (
    Number.isSafeInteger(value) &&
    value >= (allowZero ? 0 : 1) &&
    value <= MAX_POINTS
  );
}

function normalized(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim().toLowerCase();
}

function citesPublishedPointRelationship(
  text: string,
  label: string,
  points: number,
): boolean {
  return text.includes(normalized(`${label} carries ${points} points`));
}

function isPublishedCriterionCitation(
  citations: readonly GroundedCitation[],
): boolean {
  return (
    citations.length > 0 &&
    citations.every(
      (citation) =>
        citation.sourceAuthority === "authoritative" &&
        (citation.sourceKind === "solicitation" ||
          citation.sourceKind === "addendum"),
    )
  );
}

function isEvidenceCitation(citations: readonly GroundedCitation[]): boolean {
  return (
    citations.length > 0 &&
    citations.every(
      (citation) =>
        citation.sourceKind === "company_evidence" &&
        citation.sourceAuthority !== "unverified",
    )
  );
}

function citesMandatoryState(text: string, mandatory: boolean): boolean {
  return mandatory
    ? /\bmandatory\b/u.test(text) &&
        !/\b(?:non[- ]mandatory|not mandatory)\b/u.test(text)
    : /\b(?:optional|non[- ]mandatory|not mandatory)\b/u.test(text);
}

/**
 * Projects only points disclosed by the authority and supported by accepted,
 * cited evidence mappings. It never predicts an award, evaluator discretion,
 * or points that are not present in the published scoring method.
 */
export function buildEvaluationScorePlan(
  input: EvaluationScorePlannerInput,
): EvaluationScorePlannerResult {
  const sourceValidation = validateNextCapabilitySources(
    input.sources,
    "Evaluation source documents",
  );
  const sourceSet = sourceValidation.sourceSet;
  const issues: DomainIssue[] = [
    ...sourceValidation.issues,
    ...validateNextCapabilityCollection(
      input.criteria,
      "criteria",
      "Published evaluation criteria",
    ),
    ...validateNextCapabilityCollection(
      input.mappings,
      "mappings",
      "Evaluation evidence mappings",
    ),
  ];
  const criterionInputs = input.criteria.slice(0, NEXT_CAPABILITY_MAX_ITEMS);
  const mappingInputs = input.mappings.slice(0, NEXT_CAPABILITY_MAX_ITEMS);
  issues.push(
    ...uniqueIds(criterionInputs, "criteria"),
    ...uniqueIds(mappingInputs, "mappings"),
  );

  const criteria: PublishedEvaluationCriterionRecord[] = [];
  criterionInputs.forEach((criterion, index) => {
    const path = `criteria[${index}]`;
    const citationIssues = validateNextCapabilityCollection(
      criterion.citations,
      `${path}.citations`,
      "Criterion citations",
    );
    const local = validateCitations(
      criterion.citations.slice(0, NEXT_CAPABILITY_MAX_ITEMS),
      sourceSet.byKey,
      `${path}.citations`,
    );
    const textIssues = validateNextCapabilityText(
      criterion.label,
      `${path}.label`,
      "Criterion label",
    );
    issues.push(
      ...citationIssues,
      ...local.issues,
      ...textIssues,
      ...validateHumanReview(criterion.review, `${path}.review`),
    );
    if (!validPoints(criterion.publishedMaxPoints, false)) {
      issues.push({
        code: "invalid_published_points",
        severity: "blocker",
        path: `${path}.publishedMaxPoints`,
        message:
          "Published maximum points must be a positive safe integer within the deterministic limit.",
      });
    }
    if (
      criterion.publishedMinimumPoints !== undefined &&
      (!validPoints(criterion.publishedMinimumPoints, true) ||
        criterion.publishedMinimumPoints > criterion.publishedMaxPoints)
    ) {
      issues.push({
        code: "invalid_published_threshold",
        severity: "blocker",
        path: `${path}.publishedMinimumPoints`,
        message:
          "A published threshold must be a non-negative safe integer no greater than the criterion maximum.",
      });
    }
    if (
      local.citations.length &&
      !isPublishedCriterionCitation(local.citations)
    ) {
      issues.push({
        code: "criterion_source_not_authoritative",
        severity: "blocker",
        path: `${path}.citations`,
        message:
          "Scoring criteria require authoritative solicitation or addendum citations.",
      });
    }
    const publishedFactsCited = local.citations.some((citation) => {
      const publishedText = normalized(citation.quote);
      return (
        citesPublishedPointRelationship(
          publishedText,
          criterion.label,
          criterion.publishedMaxPoints,
        ) &&
        citesMandatoryState(publishedText, criterion.mandatory) &&
        (criterion.publishedMinimumPoints === undefined ||
          publishedText.includes(
            normalized(`minimum ${criterion.publishedMinimumPoints} points`),
          ))
      );
    });
    if (local.citations.length && !publishedFactsCited) {
      issues.push({
        code: "criterion_facts_not_cited",
        severity: "blocker",
        path: `${path}.citations`,
        message:
          "Criterion label, mandatory state, maximum points, and any threshold must occur in the cited published scoring text.",
      });
    }
    const valid =
      isValidId(criterion.externalId) &&
      citationIssues.length === 0 &&
      textIssues.length === 0 &&
      local.issues.length === 0 &&
      isPublishedCriterionCitation(local.citations) &&
      publishedFactsCited &&
      validPoints(criterion.publishedMaxPoints, false) &&
      (criterion.publishedMinimumPoints === undefined ||
        (validPoints(criterion.publishedMinimumPoints, true) &&
          criterion.publishedMinimumPoints <= criterion.publishedMaxPoints));
    if (valid) {
      criteria.push({
        ...criterion,
        criterionId: deterministicId("scorecrit", {
          externalId: criterion.externalId,
          label: criterion.label,
          publishedMaxPoints: criterion.publishedMaxPoints,
          mandatory: criterion.mandatory,
          publishedMinimumPoints: criterion.publishedMinimumPoints,
          citationIds: local.citations.map((citation) => citation.citationId),
        }),
        citations: local.citations,
      });
    }
  });
  criteria.sort((left, right) =>
    left.criterionId.localeCompare(right.criterionId),
  );
  const criterionByExternalId = new Map(
    criteria.map((criterion) => [criterion.externalId, criterion]),
  );

  const mappings: EvaluationEvidenceMappingRecord[] = [];
  mappingInputs.forEach((mapping, index) => {
    const path = `mappings[${index}]`;
    const criterion = criterionByExternalId.get(mapping.criterionExternalId);
    const citationIssues = validateNextCapabilityCollection(
      mapping.citations,
      `${path}.citations`,
      "Evidence mapping citations",
    );
    const local = validateCitations(
      mapping.citations.slice(0, NEXT_CAPABILITY_MAX_ITEMS),
      sourceSet.byKey,
      `${path}.citations`,
    );
    const textIssues = [
      ...validateNextCapabilityText(
        mapping.evidenceLabel,
        `${path}.evidenceLabel`,
        "Evidence label",
      ),
      ...validateNextCapabilityText(
        mapping.rationale,
        `${path}.rationale`,
        "Evidence mapping rationale",
      ),
    ];
    issues.push(
      ...citationIssues,
      ...local.issues,
      ...textIssues,
      ...validateHumanReview(mapping.review, `${path}.review`),
    );
    if (!criterion) {
      issues.push({
        code: "criterion_reference_missing",
        severity: "blocker",
        path: `${path}.criterionExternalId`,
        message: "Every mapping must reference a valid published criterion.",
      });
    }
    if (!validPoints(mapping.documentedSupportedPoints, false)) {
      issues.push({
        code: "invalid_supported_points",
        severity: "blocker",
        path: `${path}.documentedSupportedPoints`,
        message:
          "Documented supported points must be a positive safe integer within the deterministic limit.",
      });
    } else if (
      criterion &&
      mapping.documentedSupportedPoints > criterion.publishedMaxPoints
    ) {
      issues.push({
        code: "mapping_points_exceed_criterion",
        severity: "blocker",
        path: `${path}.documentedSupportedPoints`,
        message:
          "A mapping cannot claim more points than the authority published for its criterion.",
      });
    }
    if (local.citations.length && !isEvidenceCitation(local.citations)) {
      issues.push({
        code: "mapping_evidence_source_invalid",
        severity: "blocker",
        path: `${path}.citations`,
        message:
          "A score mapping requires verified company-evidence provenance.",
      });
    }
    const evidenceClaimCited = local.citations.some((citation) => {
      const text = normalized(citation.quote);
      return (
        text.includes(normalized(mapping.evidenceLabel)) &&
        text.includes(normalized(mapping.rationale))
      );
    });
    if (local.citations.length && !evidenceClaimCited) {
      issues.push({
        code: "mapping_evidence_fact_not_cited",
        severity: "blocker",
        path: `${path}.citations`,
        message:
          "The mapped evidence label and rationale must occur together in one exact company-evidence citation.",
      });
    }
    const supportedPointsPublished =
      Boolean(criterion) &&
      (criterion?.citations ?? []).some((citation) =>
        citesPublishedPointRelationship(
          normalized(citation.quote),
          criterion?.label ?? "",
          mapping.documentedSupportedPoints,
        ),
      );
    if (criterion && !supportedPointsPublished) {
      issues.push({
        code: "mapping_points_not_published",
        severity: "blocker",
        path: `${path}.documentedSupportedPoints`,
        message:
          "Documented supported points must occur in the exact published criterion citation; the planner does not interpolate scores.",
      });
    }
    if (
      criterion &&
      isValidId(mapping.externalId) &&
      citationIssues.length === 0 &&
      textIssues.length === 0 &&
      local.issues.length === 0 &&
      isEvidenceCitation(local.citations) &&
      evidenceClaimCited &&
      supportedPointsPublished &&
      validPoints(mapping.documentedSupportedPoints, false) &&
      mapping.documentedSupportedPoints <= criterion.publishedMaxPoints
    ) {
      mappings.push({
        ...mapping,
        mappingId: deterministicId("scoremap", {
          externalId: mapping.externalId,
          criterionId: criterion.criterionId,
          evidenceLabel: mapping.evidenceLabel,
          documentedSupportedPoints: mapping.documentedSupportedPoints,
          rationale: mapping.rationale,
          citationIds: local.citations.map((citation) => citation.citationId),
        }),
        criterionId: criterion.criterionId,
        citations: local.citations,
      });
    }
  });
  mappings.sort((left, right) => left.mappingId.localeCompare(right.mappingId));

  const projections: EvaluationCriterionProjection[] = criteria.map(
    (criterion) => {
      const candidates = mappings.filter(
        (mapping) => mapping.criterionId === criterion.criterionId,
      );
      if (candidates.length > 1) {
        issues.push({
          code: "multiple_score_mappings_require_breakdown",
          severity: "blocker",
          path: `criteria.${criterion.externalId}`,
          message:
            "Multiple point-bearing mappings can double-count support; model exact published subcriteria before combining them.",
        });
      }
      const accepted = candidates.filter((mapping) =>
        reviewIsAccepted(mapping.review),
      );
      const rawSupported = accepted.reduce(
        (total, mapping) => total + mapping.documentedSupportedPoints,
        0,
      );
      if (rawSupported > criterion.publishedMaxPoints) {
        issues.push({
          code: "criterion_points_double_counted",
          severity: "blocker",
          path: `criteria.${criterion.externalId}`,
          message:
            "Accepted evidence mappings exceed the criterion maximum and may double-count support.",
        });
      }
      const supported = Math.min(rawSupported, criterion.publishedMaxPoints);
      const pending =
        !reviewIsAccepted(criterion.review) ||
        candidates.some((mapping) => !reviewIsAccepted(mapping.review));
      const state: EvaluationCriterionProjection["state"] = pending
        ? "pending_review"
        : supported === 0
          ? "unsupported"
          : supported < criterion.publishedMaxPoints
            ? "partially_supported"
            : "fully_supported";
      return {
        criterionId: criterion.criterionId,
        state,
        publishedMaxPoints: criterion.publishedMaxPoints,
        documentedSupportedPoints: supported,
        documentedGapPoints: criterion.publishedMaxPoints - supported,
        mappingIds: candidates.map((mapping) => mapping.mappingId).sort(),
      };
    },
  );
  projections.sort((left, right) =>
    left.criterionId.localeCompare(right.criterionId),
  );
  const planId = deterministicId("scoreplan", {
    criteria: criteria.map((criterion) => [
      criterion.criterionId,
      criterion.review,
    ]),
    mappings: mappings.map((mapping) => [mapping.mappingId, mapping.review]),
    projections,
  });
  const planReviewResult = resolveSubjectReview(
    planId,
    input.planReview,
    "planReview",
  );
  issues.push(...planReviewResult.issues);
  const sortedIssues = sortIssues(issues);
  const allInputsReviewed =
    criteria.length > 0 &&
    criteria.every((criterion) => reviewIsAccepted(criterion.review)) &&
    mappings.every((mapping) => reviewIsAccepted(mapping.review));
  const readyForPlanningUse =
    !hasBlockers(sortedIssues) &&
    allInputsReviewed &&
    reviewIsAccepted(planReviewResult.review);
  const status: EvaluationScorePlannerResult["status"] = hasBlockers(
    sortedIssues,
  )
    ? "blocked"
    : criteria.length === 0
      ? "incomplete"
      : readyForPlanningUse
        ? "ready"
        : "review_required";
  return {
    planId,
    status,
    readyForPlanningUse,
    publishedMaximumPoints: criteria.reduce(
      (total, criterion) => total + criterion.publishedMaxPoints,
      0,
    ),
    documentedSupportedPoints: projections.reduce(
      (total, projection) => total + projection.documentedSupportedPoints,
      0,
    ),
    mandatoryGapCount: projections.filter((projection) => {
      const criterion = criteria.find(
        (candidate) => candidate.criterionId === projection.criterionId,
      );
      return criterion?.mandatory && projection.documentedGapPoints > 0;
    }).length,
    criteria,
    mappings,
    projections,
    review: planReviewResult.review,
    issues: sortedIssues,
    awardProbability: null,
    evaluatorBehaviourPrediction: false,
    awardDecisionAuthorized: false,
    safety: nextCapabilitySafety(),
  };
}
