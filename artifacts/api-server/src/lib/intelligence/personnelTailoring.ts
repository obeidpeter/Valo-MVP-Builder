import {
  deterministicId,
  hasBlockers,
  isIsoDate,
  reviewIsAccepted,
  sortIssues,
  UNREVIEWED,
  validateCitations,
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

export interface TailoringCriterionInput {
  readonly externalId: string;
  readonly label: string;
  readonly tags: readonly string[];
  readonly citations: readonly ExactCitation[];
  readonly review: HumanReview;
}

export interface VerifiedCandidateInput {
  readonly externalId: string;
  readonly displayName: string;
  readonly kind: "person" | "past_project";
  readonly tags: readonly string[];
  readonly availableFrom?: string;
  readonly citations: readonly ExactCitation[];
  readonly ownerReview: HumanReview;
}

export interface PersonnelTailoringInput {
  readonly asOfDate: string;
  readonly sources: readonly SourceDocument[];
  readonly criteria: readonly TailoringCriterionInput[];
  readonly candidates: readonly VerifiedCandidateInput[];
  readonly proposalReviews?: Readonly<Record<string, HumanReview>>;
}

export interface TailoredCandidateProposal {
  readonly proposalId: string;
  readonly criterionExternalId: string;
  readonly candidateExternalId: string;
  readonly candidateKind: VerifiedCandidateInput["kind"];
  readonly matchedTags: readonly string[];
  readonly citations: readonly GroundedCitation[];
  readonly review: HumanReview;
  readonly usable: boolean;
}

export interface PersonnelTailoringResult {
  readonly tailoringId: string;
  readonly status: "blocked" | "review_required" | "ready";
  readonly readyForUse: boolean;
  readonly proposals: readonly TailoredCandidateProposal[];
  readonly uncoveredCriterionIds: readonly string[];
  readonly issues: readonly DomainIssue[];
  readonly safety: NextCapabilitySafetyEnvelope;
  readonly employmentOrCredentialAttestation: "not_granted";
}

function normalizedTags(tags: readonly string[]): string[] {
  return [
    ...new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean)),
  ].sort();
}

const MAX_TAGS_PER_ITEM = 50;

function citationTextContains(
  citations: readonly GroundedCitation[],
  value: string,
): boolean {
  const needle = value.trim().toLowerCase();
  return (
    needle.length > 0 &&
    citations.some((citation) => citation.quote.toLowerCase().includes(needle))
  );
}

/** Selects only verified people/projects; it never embellishes a CV or availability claim. */
export function tailorVerifiedPersonnelAndExperience(
  input: PersonnelTailoringInput,
): PersonnelTailoringResult {
  const { sourceSet, issues: sourceIssues } = validateNextCapabilitySources(
    input.sources,
    "Personnel-tailoring sources",
  );
  const criterionInputs = input.criteria.slice(0, NEXT_CAPABILITY_MAX_ITEMS);
  const candidateInputs = input.candidates.slice(0, NEXT_CAPABILITY_MAX_ITEMS);
  const issues: DomainIssue[] = [
    ...sourceIssues,
    ...validateNextCapabilityCollection(input.criteria, "criteria", "Criteria"),
    ...validateNextCapabilityCollection(
      input.candidates,
      "candidates",
      "Candidates",
    ),
    ...uniqueIds(criterionInputs, "criteria"),
    ...uniqueIds(candidateInputs, "candidates"),
  ];
  if (!isIsoDate(input.asOfDate)) {
    issues.push({
      code: "invalid_tailoring_date",
      severity: "blocker",
      path: "asOfDate",
      message: "Tailoring requires a valid ISO calendar date.",
    });
  }

  const eligibleCriteria = criterionInputs.flatMap((criterion, index) => {
    const path = `criteria[${index}]`;
    issues.push(
      ...validateNextCapabilityCollection(
        criterion.citations,
        `${path}.citations`,
        "Criterion citations",
      ),
      ...validateNextCapabilityCollection(
        criterion.tags,
        `${path}.tags`,
        "Criterion tags",
        MAX_TAGS_PER_ITEM,
      ),
    );
    const citations = validateCitations(
      criterion.citations.slice(0, NEXT_CAPABILITY_MAX_ITEMS),
      sourceSet.byKey,
      `${path}.citations`,
    );
    const local = [
      ...citations.issues,
      ...validateHumanReview(criterion.review, `${path}.review`),
      ...validateNextCapabilityText(
        criterion.label,
        `${path}.label`,
        "Criterion label",
      ),
    ];
    const tags = normalizedTags(criterion.tags.slice(0, MAX_TAGS_PER_ITEM));
    criterion.tags.slice(0, MAX_TAGS_PER_ITEM).forEach((tag, tagIndex) => {
      local.push(
        ...validateNextCapabilityText(
          tag,
          `${path}.tags[${tagIndex}]`,
          "Criterion tag",
          { maximum: 128 },
        ),
      );
    });
    if (
      citations.citations.some(
        (citation) =>
          citation.sourceAuthority !== "authoritative" ||
          !new Set(["solicitation", "addendum"]).has(citation.sourceKind),
      )
    ) {
      local.push({
        code: "criterion_source_not_authoritative",
        severity: "blocker" as const,
        path: `${path}.citations`,
        message:
          "Tailoring criteria require authoritative solicitation or addendum sources.",
      });
    }
    if (
      !citationTextContains(citations.citations, criterion.label) ||
      tags.length === 0 ||
      tags.some((tag) => !citationTextContains(citations.citations, tag))
    ) {
      local.push({
        code: "criterion_match_terms_not_cited",
        severity: "blocker" as const,
        path,
        message:
          "The criterion label and every matching tag must occur in its exact tender citations.",
      });
    }
    issues.push(...local);
    return local.some((issue) => issue.severity === "blocker") ||
      !reviewIsAccepted(criterion.review)
      ? []
      : [
          {
            ...criterion,
            tags,
            citations: citations.citations,
          },
        ];
  });

  const eligibleCandidates = candidateInputs.flatMap((candidate, index) => {
    const path = `candidates[${index}]`;
    issues.push(
      ...validateNextCapabilityCollection(
        candidate.citations,
        `${path}.citations`,
        "Candidate citations",
      ),
      ...validateNextCapabilityCollection(
        candidate.tags,
        `${path}.tags`,
        "Candidate tags",
        MAX_TAGS_PER_ITEM,
      ),
    );
    const citations = validateCitations(
      candidate.citations.slice(0, NEXT_CAPABILITY_MAX_ITEMS),
      sourceSet.byKey,
      `${path}.citations`,
    );
    const local = [
      ...citations.issues,
      ...validateHumanReview(candidate.ownerReview, `${path}.ownerReview`),
      ...validateNextCapabilityText(
        candidate.displayName,
        `${path}.displayName`,
        "Candidate name",
      ),
    ];
    const tags = normalizedTags(candidate.tags.slice(0, MAX_TAGS_PER_ITEM));
    candidate.tags.slice(0, MAX_TAGS_PER_ITEM).forEach((tag, tagIndex) => {
      local.push(
        ...validateNextCapabilityText(
          tag,
          `${path}.tags[${tagIndex}]`,
          "Candidate tag",
          { maximum: 128 },
        ),
      );
    });
    if (candidate.availableFrom && !isIsoDate(candidate.availableFrom)) {
      local.push({
        code: "invalid_candidate_availability_date",
        severity: "blocker" as const,
        path: `${path}.availableFrom`,
        message: "Candidate availability must be a valid ISO calendar date.",
      });
    } else if (
      candidate.availableFrom &&
      candidate.availableFrom > input.asOfDate
    ) {
      local.push({
        code: "candidate_not_currently_available",
        severity: "warning" as const,
        path: `${path}.availableFrom`,
        message:
          "The candidate is not verified as available on the tailoring date.",
      });
    }
    if (
      !citationTextContains(citations.citations, candidate.displayName) ||
      tags.length === 0 ||
      tags.some((tag) => !citationTextContains(citations.citations, tag)) ||
      (candidate.availableFrom != null &&
        !citationTextContains(citations.citations, candidate.availableFrom)) ||
      !citations.citations.some((citation) =>
        candidate.kind === "person"
          ? /\b(person|personnel|employee|consultant|engineer|specialist)\b/iu.test(
              citation.quote,
            )
          : /\bproject\b/iu.test(citation.quote),
      )
    ) {
      local.push({
        code: "candidate_match_terms_not_cited",
        severity: "blocker" as const,
        path,
        message:
          "The candidate name and every matching tag must occur in verified evidence citations.",
      });
    }
    if (
      citations.citations.some(
        (citation) =>
          citation.sourceKind !== "company_evidence" ||
          citation.sourceAuthority === "unverified",
      )
    ) {
      local.push({
        code: "candidate_source_not_verified",
        severity: "blocker" as const,
        path: `${path}.citations`,
        message: "Candidate facts require verified company-evidence sources.",
      });
    }
    issues.push(...local);
    const unavailable =
      candidate.availableFrom != null &&
      candidate.availableFrom > input.asOfDate;
    return local.some((issue) => issue.severity === "blocker") ||
      unavailable ||
      !reviewIsAccepted(candidate.ownerReview)
      ? []
      : [
          {
            ...candidate,
            tags,
            citations: citations.citations,
          },
        ];
  });

  const proposals: TailoredCandidateProposal[] = [];
  let proposalLimitExceeded = false;
  proposalLoop: for (const criterion of eligibleCriteria) {
    for (const candidate of eligibleCandidates) {
      const matchedTags = criterion.tags.filter((tag) =>
        candidate.tags.includes(tag),
      );
      if (matchedTags.length === 0) continue;
      if (proposals.length >= NEXT_CAPABILITY_MAX_ITEMS) {
        proposalLimitExceeded = true;
        break proposalLoop;
      }
      const proposalId = deterministicId("tailor", {
        criterion: {
          externalId: criterion.externalId,
          label: criterion.label,
          tags: criterion.tags,
          citationIds: criterion.citations.map(
            (citation) => citation.citationId,
          ),
          review: criterion.review,
        },
        candidate: {
          externalId: candidate.externalId,
          displayName: candidate.displayName,
          kind: candidate.kind,
          tags: candidate.tags,
          availableFrom: candidate.availableFrom,
          citationIds: candidate.citations.map(
            (citation) => citation.citationId,
          ),
          ownerReview: candidate.ownerReview,
        },
        matchedTags,
      });
      const review = input.proposalReviews?.[proposalId] ?? UNREVIEWED;
      issues.push(
        ...validateHumanReview(review, `proposalReviews.${proposalId}`),
      );
      proposals.push({
        proposalId,
        criterionExternalId: criterion.externalId,
        candidateExternalId: candidate.externalId,
        candidateKind: candidate.kind,
        matchedTags,
        citations: [...criterion.citations, ...candidate.citations].sort(
          (left, right) => left.citationId.localeCompare(right.citationId),
        ),
        review,
        usable: reviewIsAccepted(review),
      });
    }
  }
  if (proposalLimitExceeded) {
    issues.push({
      code: "capability_item_limit_exceeded",
      severity: "blocker",
      path: "proposals",
      message: `Tailored proposals exceed the deterministic limit of ${NEXT_CAPABILITY_MAX_ITEMS} items.`,
    });
  }
  proposals.sort(
    (left, right) =>
      left.criterionExternalId.localeCompare(right.criterionExternalId) ||
      right.matchedTags.length - left.matchedTags.length ||
      left.proposalId.localeCompare(right.proposalId),
  );
  const uncoveredCriterionIds = eligibleCriteria
    .filter(
      (criterion) =>
        !proposals.some(
          (proposal) => proposal.criterionExternalId === criterion.externalId,
        ),
    )
    .map((criterion) => criterion.externalId)
    .sort();
  const proposalReviewKeys = boundedNextCapabilityRecordKeys(
    input.proposalReviews,
    "proposalReviews",
    "Proposal reviews",
  );
  issues.push(...proposalReviewKeys.issues);
  for (const proposalId of proposalReviewKeys.keys) {
    if (!proposals.some((proposal) => proposal.proposalId === proposalId)) {
      issues.push({
        code: "orphan_tailoring_review",
        severity: "blocker",
        path: `proposalReviews.${proposalId}`,
        message:
          "A review must bind to a proposal generated by this exact tailoring run.",
      });
    }
  }
  const tailoringId = deterministicId("tailoring", {
    asOfDate: input.asOfDate,
    proposalIds: proposals.map((proposal) => proposal.proposalId),
  });
  const sortedIssues = sortIssues(issues);
  const blocked = hasBlockers(sortedIssues);
  const readyForUse =
    !blocked &&
    proposals.length > 0 &&
    uncoveredCriterionIds.length === 0 &&
    proposals.every((proposal) => reviewIsAccepted(proposal.review));
  return {
    tailoringId,
    status: blocked ? "blocked" : readyForUse ? "ready" : "review_required",
    readyForUse,
    proposals: proposals.map((proposal) => ({
      ...proposal,
      usable: readyForUse && proposal.usable,
    })),
    uncoveredCriterionIds,
    issues: sortedIssues,
    safety: nextCapabilitySafety(2),
    employmentOrCredentialAttestation: "not_granted",
  };
}
