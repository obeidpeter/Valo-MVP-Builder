import {
  deterministicId,
  hasBlockers,
  isIsoDate,
  isValidId,
  reviewIsAccepted,
  sortIssues,
  UNREVIEWED,
  uniqueIds,
  validateCitations,
  validateHumanReview,
  validateSources,
  type DomainIssue,
  type ExactCitation,
  type GroundedCitation,
  type HumanReview,
  type SourceDocument,
} from "./domain";

export interface OpportunityInput {
  readonly externalId: string;
  readonly title: string;
  readonly procuringEntity: string;
  readonly category: string;
  readonly region: string;
  readonly publishedDate: string;
  readonly submissionDeadline: string;
  readonly citations: readonly ExactCitation[];
  readonly review: HumanReview;
}

export interface SupplierCapabilityInput {
  readonly externalId: string;
  readonly label: string;
  readonly category: string;
  readonly regions: readonly string[];
  readonly allRegions: boolean;
  readonly citations: readonly ExactCitation[];
  readonly review: HumanReview;
}

export interface OpportunityRadarPolicy {
  readonly policyId: string;
  readonly minimumLeadDays: number;
  readonly weights: {
    readonly category: number;
    readonly region: number;
    readonly leadTime: number;
  };
}

export interface SupplierBidCapacityInput {
  readonly activeBidCount: number;
  readonly maximumConcurrentBids: number;
  readonly review: HumanReview;
}

export interface OpportunityRadarInput {
  readonly asOfDate: string;
  readonly sources: readonly SourceDocument[];
  readonly opportunities: readonly OpportunityInput[];
  readonly capabilities: readonly SupplierCapabilityInput[];
  readonly capacity: SupplierBidCapacityInput;
  readonly policy: OpportunityRadarPolicy;
  /** Reviews are keyed by the exact recommendation ID returned on a prior run. */
  readonly recommendationReviews?: Readonly<Record<string, HumanReview>>;
}

export interface OpportunityRecord extends OpportunityInput {
  readonly opportunityId: string;
  readonly citations: readonly GroundedCitation[];
}

export interface SupplierCapabilityRecord extends SupplierCapabilityInput {
  readonly capabilityId: string;
  readonly citations: readonly GroundedCitation[];
}

export type OpportunityDisposition =
  | "candidate"
  | "closed"
  | "source_not_accepted"
  | "capability_gap"
  | "region_gap"
  | "insufficient_lead_time"
  | "capacity_unavailable";

export interface OpportunityScoreReason {
  readonly code: "category_match" | "region_match" | "lead_time";
  readonly points: number;
  readonly maximumPoints: number;
}

export interface OpportunityRecommendation {
  readonly recommendationId: string;
  readonly opportunityId: string;
  readonly disposition: OpportunityDisposition;
  /** A transparent policy score, never a probability of winning. */
  readonly fitScore?: number;
  readonly scoreReasons: readonly OpportunityScoreReason[];
  readonly matchedCapabilityIds: readonly string[];
  readonly leadDays: number;
  readonly review: HumanReview;
  readonly actionable: boolean;
}

export interface OpportunityRadarResult {
  readonly radarId: string;
  readonly status: "blocked" | "review_required" | "ready";
  readonly readyForUse: boolean;
  readonly opportunities: readonly OpportunityRecord[];
  readonly capabilities: readonly SupplierCapabilityRecord[];
  readonly recommendations: readonly OpportunityRecommendation[];
  readonly issues: readonly DomainIssue[];
  readonly scoringNotice: "fit_score_is_not_win_probability";
}

function daysBetween(from: string, to: string): number {
  return Math.floor(
    (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) /
      86_400_000,
  );
}

function officialOpportunityCitations(
  citations: readonly GroundedCitation[],
): boolean {
  return citations.every(
    (citation) =>
      citation.sourceKind === "official_opportunity" &&
      citation.sourceAuthority === "authoritative",
  );
}

function capabilityCitations(citations: readonly GroundedCitation[]): boolean {
  return citations.every(
    (citation) =>
      citation.sourceKind === "company_evidence" &&
      citation.sourceAuthority !== "unverified",
  );
}

/**
 * Produces deterministic opportunity screening for human decision-makers. It
 * never estimates win probability, makes a bid/no-bid decision, or submits a
 * response.
 */
export function screenOpportunities(
  input: OpportunityRadarInput,
): OpportunityRadarResult {
  const sourceSet = validateSources(input.sources);
  const issues: DomainIssue[] = [...sourceSet.issues];
  if (!isIsoDate(input.asOfDate)) {
    issues.push({
      code: "invalid_radar_date",
      severity: "blocker",
      path: "asOfDate",
      message: "Opportunity screening requires a valid ISO calendar date.",
    });
  }
  if (
    !isValidId(input.policy.policyId) ||
    !Number.isInteger(input.policy.minimumLeadDays) ||
    input.policy.minimumLeadDays < 0
  ) {
    issues.push({
      code: "invalid_opportunity_policy",
      severity: "blocker",
      path: "policy",
      message:
        "The policy needs a stable ID and non-negative integer lead time.",
    });
  }
  const weights = Object.values(input.policy.weights);
  if (
    weights.some((weight) => !Number.isInteger(weight) || weight < 0) ||
    weights.reduce((sum, weight) => sum + weight, 0) !== 100
  ) {
    issues.push({
      code: "invalid_opportunity_weights",
      severity: "blocker",
      path: "policy.weights",
      message: "Non-negative integer fit weights must total exactly 100.",
    });
  }
  if (
    !Number.isInteger(input.capacity.activeBidCount) ||
    !Number.isInteger(input.capacity.maximumConcurrentBids) ||
    input.capacity.activeBidCount < 0 ||
    input.capacity.maximumConcurrentBids < 1
  ) {
    issues.push({
      code: "invalid_bid_capacity",
      severity: "blocker",
      path: "capacity",
      message: "Bid capacity must contain valid non-negative integer counts.",
    });
  }
  issues.push(...validateHumanReview(input.capacity.review, "capacity.review"));
  issues.push(...uniqueIds(input.opportunities, "opportunities"));
  issues.push(...uniqueIds(input.capabilities, "capabilities"));

  const opportunities: OpportunityRecord[] = [];
  input.opportunities.forEach((opportunity, index) => {
    const path = `opportunities[${index}]`;
    const local = validateCitations(
      opportunity.citations,
      sourceSet.byKey,
      `${path}.citations`,
    );
    issues.push(
      ...local.issues,
      ...validateHumanReview(opportunity.review, `${path}.review`),
    );
    if (
      !opportunity.title.trim() ||
      !opportunity.procuringEntity.trim() ||
      !isValidId(opportunity.category) ||
      !isValidId(opportunity.region) ||
      !isIsoDate(opportunity.publishedDate) ||
      !isIsoDate(opportunity.submissionDeadline) ||
      opportunity.publishedDate > opportunity.submissionDeadline
    ) {
      issues.push({
        code: "invalid_opportunity_record",
        severity: "blocker",
        path,
        message:
          "Opportunity identity, classification, and date fields are invalid.",
      });
    }
    if (
      local.citations.length > 0 &&
      !officialOpportunityCitations(local.citations)
    ) {
      issues.push({
        code: "opportunity_source_invalid",
        severity: "blocker",
        path: `${path}.citations`,
        message:
          "Opportunities require authoritative official-opportunity citations.",
      });
    }
    if (
      !local.issues.length &&
      local.citations.length > 0 &&
      officialOpportunityCitations(local.citations) &&
      opportunity.title.trim() &&
      opportunity.procuringEntity.trim() &&
      isValidId(opportunity.externalId) &&
      isValidId(opportunity.category) &&
      isValidId(opportunity.region) &&
      isIsoDate(opportunity.publishedDate) &&
      isIsoDate(opportunity.submissionDeadline) &&
      opportunity.publishedDate <= opportunity.submissionDeadline
    ) {
      opportunities.push({
        ...opportunity,
        opportunityId: deterministicId("opp", {
          externalId: opportunity.externalId,
          title: opportunity.title,
          procuringEntity: opportunity.procuringEntity,
          category: opportunity.category,
          region: opportunity.region,
          publishedDate: opportunity.publishedDate,
          submissionDeadline: opportunity.submissionDeadline,
          citationIds: local.citations.map((citation) => citation.citationId),
        }),
        citations: local.citations,
      });
    }
  });

  const capabilities: SupplierCapabilityRecord[] = [];
  input.capabilities.forEach((capability, index) => {
    const path = `capabilities[${index}]`;
    const local = validateCitations(
      capability.citations,
      sourceSet.byKey,
      `${path}.citations`,
    );
    issues.push(
      ...local.issues,
      ...validateHumanReview(capability.review, `${path}.review`),
    );
    if (
      !capability.label.trim() ||
      !isValidId(capability.category) ||
      capability.regions.some((region) => !isValidId(region)) ||
      new Set(capability.regions).size !== capability.regions.length ||
      (!capability.allRegions && capability.regions.length === 0)
    ) {
      issues.push({
        code: "invalid_supplier_capability",
        severity: "blocker",
        path,
        message: "Capability classification or region coverage is invalid.",
      });
    }
    if (local.citations.length > 0 && !capabilityCitations(local.citations)) {
      issues.push({
        code: "capability_source_invalid",
        severity: "blocker",
        path: `${path}.citations`,
        message: "Capabilities require verified company-evidence citations.",
      });
    }
    if (
      !local.issues.length &&
      local.citations.length > 0 &&
      capabilityCitations(local.citations) &&
      capability.label.trim() &&
      isValidId(capability.externalId) &&
      isValidId(capability.category) &&
      capability.regions.every(isValidId) &&
      new Set(capability.regions).size === capability.regions.length &&
      (capability.allRegions || capability.regions.length > 0)
    ) {
      capabilities.push({
        ...capability,
        regions: [...capability.regions].sort(),
        capabilityId: deterministicId("cap", {
          externalId: capability.externalId,
          label: capability.label,
          category: capability.category,
          regions: [...capability.regions].sort(),
          allRegions: capability.allRegions,
          citationIds: local.citations.map((citation) => citation.citationId),
        }),
        citations: local.citations,
      });
    }
  });

  opportunities.sort((left, right) =>
    left.opportunityId.localeCompare(right.opportunityId),
  );
  capabilities.sort((left, right) =>
    left.capabilityId.localeCompare(right.capabilityId),
  );
  const recommendations: OpportunityRecommendation[] = opportunities.map(
    (opportunity) => {
      const leadDays = daysBetween(
        input.asOfDate,
        opportunity.submissionDeadline,
      );
      const acceptedCapabilities = capabilities.filter((capability) =>
        reviewIsAccepted(capability.review),
      );
      const allCategoryMatches = capabilities.filter(
        (capability) => capability.category === opportunity.category,
      );
      const categoryMatches = acceptedCapabilities.filter(
        (capability) => capability.category === opportunity.category,
      );
      const regionMatches = categoryMatches.filter(
        (capability) =>
          capability.allRegions ||
          capability.regions.includes(opportunity.region),
      );
      const categoryPoints = categoryMatches.length
        ? input.policy.weights.category
        : 0;
      const regionPoints = regionMatches.length
        ? input.policy.weights.region
        : 0;
      const leadPoints =
        leadDays >= input.policy.minimumLeadDays
          ? input.policy.weights.leadTime
          : 0;
      const sourceAccepted =
        reviewIsAccepted(opportunity.review) &&
        reviewIsAccepted(input.capacity.review) &&
        !(
          allCategoryMatches.length > 0 &&
          allCategoryMatches.every(
            (capability) => !reviewIsAccepted(capability.review),
          )
        );
      let disposition: OpportunityDisposition;
      if (!sourceAccepted) disposition = "source_not_accepted";
      else if (leadDays < 0) disposition = "closed";
      else if (
        input.capacity.activeBidCount >= input.capacity.maximumConcurrentBids
      )
        disposition = "capacity_unavailable";
      else if (categoryMatches.length === 0) disposition = "capability_gap";
      else if (regionMatches.length === 0) disposition = "region_gap";
      else if (leadDays < input.policy.minimumLeadDays)
        disposition = "insufficient_lead_time";
      else disposition = "candidate";
      const scoreReasons: OpportunityScoreReason[] = [
        {
          code: "category_match",
          points: categoryPoints,
          maximumPoints: input.policy.weights.category,
        },
        {
          code: "region_match",
          points: regionPoints,
          maximumPoints: input.policy.weights.region,
        },
        {
          code: "lead_time",
          points: leadPoints,
          maximumPoints: input.policy.weights.leadTime,
        },
      ];
      const recommendationId = deterministicId("opprec", {
        opportunityId: opportunity.opportunityId,
        disposition,
        fitScore: sourceAccepted
          ? categoryPoints + regionPoints + leadPoints
          : undefined,
        capabilityIds: regionMatches
          .map((capability) => capability.capabilityId)
          .sort(),
        policyId: input.policy.policyId,
        capacity: [
          input.capacity.activeBidCount,
          input.capacity.maximumConcurrentBids,
        ],
        asOfDate: input.asOfDate,
      });
      const review =
        input.recommendationReviews?.[recommendationId] ?? UNREVIEWED;
      issues.push(
        ...validateHumanReview(
          review,
          `recommendationReviews.${recommendationId}`,
        ),
      );
      return {
        recommendationId,
        opportunityId: opportunity.opportunityId,
        disposition,
        fitScore: sourceAccepted
          ? categoryPoints + regionPoints + leadPoints
          : undefined,
        scoreReasons,
        matchedCapabilityIds: regionMatches
          .map((capability) => capability.capabilityId)
          .sort(),
        leadDays,
        review,
        actionable: disposition === "candidate" && reviewIsAccepted(review),
      };
    },
  );
  recommendations.sort(
    (left, right) =>
      (right.fitScore ?? -1) - (left.fitScore ?? -1) ||
      left.recommendationId.localeCompare(right.recommendationId),
  );
  const recommendationIds = new Set(
    recommendations.map((recommendation) => recommendation.recommendationId),
  );
  Object.keys(input.recommendationReviews ?? {}).forEach((recommendationId) => {
    if (!recommendationIds.has(recommendationId)) {
      issues.push({
        code: "orphan_recommendation_review",
        severity: "blocker",
        path: `recommendationReviews.${recommendationId}`,
        message:
          "A review may only apply to a recommendation generated by this exact screening.",
      });
    }
  });
  const sortedIssues = sortIssues(issues);
  const globallyBlocked = hasBlockers(sortedIssues);
  const finalizedRecommendations = recommendations.map((recommendation) => ({
    ...recommendation,
    actionable: !globallyBlocked && recommendation.actionable,
  }));
  const recommendationReviewsComplete = recommendations.every(
    (recommendation) => recommendation.review.state !== "unreviewed",
  );
  const readyForUse = !globallyBlocked && recommendationReviewsComplete;
  return {
    radarId: deterministicId("oppradar", {
      asOfDate: input.asOfDate,
      policyId: input.policy.policyId,
      recommendationIds: recommendations
        .map((recommendation) => recommendation.recommendationId)
        .sort(),
    }),
    status: globallyBlocked
      ? "blocked"
      : readyForUse
        ? "ready"
        : "review_required",
    readyForUse,
    opportunities,
    capabilities,
    recommendations: finalizedRecommendations,
    issues: sortedIssues,
    scoringNotice: "fit_score_is_not_win_probability",
  };
}
