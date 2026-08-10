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

export const CONSORTIUM_ROLES = [
  "lead",
  "technical",
  "commercial",
  "financial",
  "local_content",
  "guarantor",
] as const;

export type ConsortiumRole = (typeof CONSORTIUM_ROLES)[number];

export const RESPONSIBILITY_KINDS = [
  "primary",
  "supporting",
  "joint_and_several",
] as const;

export type ResponsibilityKind = (typeof RESPONSIBILITY_KINDS)[number];

export interface TenderConsortiumObligationInput {
  readonly externalId: string;
  readonly label: string;
  readonly requiredRoles: readonly ConsortiumRole[];
  readonly jointAndSeveralRequired: boolean;
  readonly citations: readonly ExactCitation[];
  readonly review: HumanReview;
}

export interface ConsortiumMemberInput {
  readonly externalId: string;
  readonly legalName: string;
  readonly eligibleRoles: readonly ConsortiumRole[];
  /** Exact company-evidence wording establishing this member's provenance. */
  readonly companyEvidenceStatement: string;
  readonly citations: readonly ExactCitation[];
  readonly review: HumanReview;
}

export interface ResponsibilityAllocationInput {
  readonly externalId: string;
  readonly obligationExternalId: string;
  readonly memberExternalId: string;
  readonly role: ConsortiumRole;
  readonly responsibility: ResponsibilityKind;
  readonly rationale: string;
  /** Must reuse an exact citation range from the referenced obligation. */
  readonly citations: readonly ExactCitation[];
  readonly review: HumanReview;
}

export interface ConsortiumResponsibilityInput {
  readonly sources: readonly SourceDocument[];
  readonly obligations: readonly TenderConsortiumObligationInput[];
  readonly members: readonly ConsortiumMemberInput[];
  readonly allocations: readonly ResponsibilityAllocationInput[];
  readonly matrixReview?: SubjectReview;
}

export interface TenderConsortiumObligationRecord extends TenderConsortiumObligationInput {
  readonly obligationId: string;
  readonly citations: readonly GroundedCitation[];
}

export interface ConsortiumMemberRecord extends ConsortiumMemberInput {
  readonly memberId: string;
  readonly citations: readonly GroundedCitation[];
}

export interface ResponsibilityAllocationRecord extends ResponsibilityAllocationInput {
  readonly allocationId: string;
  readonly obligationId: string;
  readonly memberId: string;
  readonly citations: readonly GroundedCitation[];
}

export interface ConsortiumObligationCoverage {
  readonly obligationId: string;
  readonly allocationIds: readonly string[];
  readonly missingRoles: readonly ConsortiumRole[];
  readonly jointAndSeveralCovered: boolean;
  readonly state:
    | "missing_allocation"
    | "pending_review"
    | "constraint_gap"
    | "covered";
}

export interface ConsortiumResponsibilityResult {
  readonly matrixId: string;
  readonly status: "blocked" | "incomplete" | "review_required" | "ready";
  readonly readyForInternalPlanningUse: boolean;
  readonly obligations: readonly TenderConsortiumObligationRecord[];
  readonly members: readonly ConsortiumMemberRecord[];
  readonly allocations: readonly ResponsibilityAllocationRecord[];
  readonly coverage: readonly ConsortiumObligationCoverage[];
  readonly unallocatedMemberIds: readonly string[];
  readonly review: HumanReview;
  readonly issues: readonly DomainIssue[];
  readonly partnerCommitmentConfirmed: false;
  readonly consortiumAgreementGenerated: false;
  readonly legalAgreementAuthorized: false;
  readonly safety: NextCapabilitySafetyEnvelope;
}

function normalized(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replaceAll("_", " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function containsPositivePhrase(text: string, value: string): boolean {
  const haystack = normalized(text);
  const sought = normalized(value);
  let offset = haystack.indexOf(sought);
  while (offset >= 0) {
    const before = offset === 0 ? "" : (haystack[offset - 1] ?? "");
    const after = haystack[offset + sought.length] ?? "";
    const bounded =
      !/[\p{L}\p{N}_]/u.test(before) && !/[\p{L}\p{N}_]/u.test(after);
    const prefix = haystack.slice(Math.max(0, offset - 64), offset);
    const suffix = haystack.slice(
      offset + sought.length,
      offset + sought.length + 48,
    );
    const negatedBefore =
      /\b(?:no|never|without|ineligible(?:\s+for)?|excluded(?:\s+from)?|prohibited(?:\s+from)?|not(?:\s+[\p{L}\p{N}_-]+){0,3})\s+$/u.test(
        prefix,
      );
    const negatedAfter =
      /^\s+(?:is\s+|are\s+)?(?:not|never|ineligible|excluded|prohibited)\b/u.test(
        suffix,
      );
    if (bounded && !negatedBefore && !negatedAfter) return true;
    offset = haystack.indexOf(sought, offset + 1);
  }
  return false;
}

function isTenderCitation(citations: readonly GroundedCitation[]): boolean {
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

function isCompanyEvidenceCitation(
  citations: readonly GroundedCitation[],
): boolean {
  return (
    citations.length > 0 &&
    citations.every(
      (citation) =>
        citation.sourceKind === "company_evidence" &&
        citation.sourceAuthority !== "unverified",
    )
  );
}

function validateBoundedRoles(
  roles: readonly ConsortiumRole[],
  path: string,
  label: string,
): {
  readonly roles: readonly ConsortiumRole[];
  readonly issues: readonly DomainIssue[];
} {
  const issues: DomainIssue[] = [
    ...validateNextCapabilityCollection(roles, path, label),
  ];
  const bounded = roles.slice(0, NEXT_CAPABILITY_MAX_ITEMS);
  if (bounded.length === 0) {
    issues.push({
      code: "consortium_role_required",
      severity: "blocker",
      path,
      message: `${label} requires at least one role.`,
    });
  }
  if (new Set(bounded).size !== bounded.length) {
    issues.push({
      code: "duplicate_consortium_role",
      severity: "blocker",
      path,
      message: `${label} may not repeat a role.`,
    });
  }
  if (bounded.some((role) => !CONSORTIUM_ROLES.includes(role))) {
    issues.push({
      code: "invalid_consortium_role",
      severity: "blocker",
      path,
      message: `${label} must use the closed consortium-role set.`,
    });
  }
  return { roles: bounded, issues };
}

/**
 * Builds a reviewed allocation proposal from cited tender obligations and
 * cited company records. An allocation is never evidence of partner consent,
 * a commitment, a consortium agreement, or legal acceptance of liability.
 */
export function buildConsortiumResponsibilityMatrix(
  input: ConsortiumResponsibilityInput,
): ConsortiumResponsibilityResult {
  const sourceValidation = validateNextCapabilitySources(
    input.sources,
    "Consortium source documents",
  );
  const sourceSet = sourceValidation.sourceSet;
  const issues: DomainIssue[] = [...sourceValidation.issues];
  issues.push(
    ...validateNextCapabilityCollection(
      input.obligations,
      "obligations",
      "Tender consortium obligations",
    ),
    ...validateNextCapabilityCollection(
      input.members,
      "members",
      "Consortium members",
    ),
    ...validateNextCapabilityCollection(
      input.allocations,
      "allocations",
      "Responsibility allocations",
    ),
  );
  const obligationInputs = input.obligations.slice(
    0,
    NEXT_CAPABILITY_MAX_ITEMS,
  );
  const memberInputs = input.members.slice(0, NEXT_CAPABILITY_MAX_ITEMS);
  const allocationInputs = input.allocations.slice(
    0,
    NEXT_CAPABILITY_MAX_ITEMS,
  );
  issues.push(
    ...uniqueIds(obligationInputs, "obligations"),
    ...uniqueIds(memberInputs, "members"),
    ...uniqueIds(allocationInputs, "allocations"),
  );

  const obligations: TenderConsortiumObligationRecord[] = [];
  obligationInputs.forEach((obligation, index) => {
    const path = `obligations[${index}]`;
    issues.push(
      ...validateNextCapabilityCollection(
        obligation.citations,
        `${path}.citations`,
        "Obligation citations",
      ),
    );
    const local = validateCitations(
      obligation.citations.slice(0, NEXT_CAPABILITY_MAX_ITEMS),
      sourceSet.byKey,
      `${path}.citations`,
    );
    const textIssues = validateNextCapabilityText(
      obligation.label,
      `${path}.label`,
      "Obligation label",
    );
    const roleResult = validateBoundedRoles(
      obligation.requiredRoles,
      `${path}.requiredRoles`,
      "Required roles",
    );
    issues.push(
      ...local.issues,
      ...textIssues,
      ...roleResult.issues,
      ...validateHumanReview(obligation.review, `${path}.review`),
    );
    if (local.citations.length && !isTenderCitation(local.citations)) {
      issues.push({
        code: "consortium_obligation_source_invalid",
        severity: "blocker",
        path: `${path}.citations`,
        message:
          "Consortium obligations require authoritative solicitation or addendum citations.",
      });
    }
    const factsCited = local.citations.some((citation) => {
      const quoted = normalized(citation.quote);
      const jointAndSeveralCited = obligation.jointAndSeveralRequired
        ? containsPositivePhrase(quoted, "joint and several")
        : quoted.includes("joint and several not required") ||
          quoted.includes("no joint and several");
      return (
        quoted.includes(normalized(obligation.label)) &&
        roleResult.roles.every((role) =>
          containsPositivePhrase(quoted, role),
        ) &&
        jointAndSeveralCited
      );
    });
    if (local.citations.length && !factsCited) {
      issues.push({
        code: "consortium_obligation_facts_not_cited",
        severity: "blocker",
        path: `${path}.citations`,
        message:
          "Cited tender text must contain the obligation label, required roles, and an explicit joint-and-several requirement or exclusion.",
      });
    }
    if (
      isValidId(obligation.externalId) &&
      textIssues.length === 0 &&
      roleResult.issues.length === 0 &&
      local.issues.length === 0 &&
      isTenderCitation(local.citations) &&
      factsCited
    ) {
      const requiredRoles = [...roleResult.roles].sort();
      obligations.push({
        ...obligation,
        requiredRoles,
        obligationId: deterministicId("consob", {
          externalId: obligation.externalId,
          label: obligation.label,
          requiredRoles,
          jointAndSeveralRequired: obligation.jointAndSeveralRequired,
          citations: local.citations,
        }),
        citations: local.citations,
      });
    }
  });
  obligations.sort((left, right) =>
    left.obligationId.localeCompare(right.obligationId),
  );
  const obligationByExternalId = new Map(
    obligations.map((obligation) => [obligation.externalId, obligation]),
  );

  const members: ConsortiumMemberRecord[] = [];
  memberInputs.forEach((member, index) => {
    const path = `members[${index}]`;
    issues.push(
      ...validateNextCapabilityCollection(
        member.citations,
        `${path}.citations`,
        "Member citations",
      ),
    );
    const local = validateCitations(
      member.citations.slice(0, NEXT_CAPABILITY_MAX_ITEMS),
      sourceSet.byKey,
      `${path}.citations`,
    );
    const textIssues = [
      ...validateNextCapabilityText(
        member.legalName,
        `${path}.legalName`,
        "Member legal name",
      ),
      ...validateNextCapabilityText(
        member.companyEvidenceStatement,
        `${path}.companyEvidenceStatement`,
        "Member company-evidence statement",
      ),
    ];
    const roleResult = validateBoundedRoles(
      member.eligibleRoles,
      `${path}.eligibleRoles`,
      "Eligible roles",
    );
    issues.push(
      ...local.issues,
      ...textIssues,
      ...roleResult.issues,
      ...validateHumanReview(member.review, `${path}.review`),
    );
    if (local.citations.length && !isCompanyEvidenceCitation(local.citations)) {
      issues.push({
        code: "consortium_member_source_invalid",
        severity: "blocker",
        path: `${path}.citations`,
        message:
          "Member provenance requires authoritative or corroborating company evidence.",
      });
    }
    const provenanceCited = local.citations.some((citation) => {
      const quoted = normalized(citation.quote);
      return (
        quoted.includes(normalized(member.legalName)) &&
        quoted.includes(normalized(member.companyEvidenceStatement)) &&
        roleResult.roles.every((role) => containsPositivePhrase(quoted, role))
      );
    });
    if (local.citations.length && !provenanceCited) {
      issues.push({
        code: "consortium_member_provenance_not_cited",
        severity: "blocker",
        path: `${path}.citations`,
        message:
          "Company evidence must contain the legal name, evidence statement, and every proposed eligible role.",
      });
    }
    if (
      isValidId(member.externalId) &&
      textIssues.length === 0 &&
      roleResult.issues.length === 0 &&
      local.issues.length === 0 &&
      isCompanyEvidenceCitation(local.citations) &&
      provenanceCited
    ) {
      const eligibleRoles = [...roleResult.roles].sort();
      members.push({
        ...member,
        eligibleRoles,
        memberId: deterministicId("consmem", {
          externalId: member.externalId,
          legalName: member.legalName,
          eligibleRoles,
          companyEvidenceStatement: member.companyEvidenceStatement,
          citations: local.citations,
        }),
        citations: local.citations,
      });
    }
  });
  members.sort((left, right) => left.memberId.localeCompare(right.memberId));
  const memberByExternalId = new Map(
    members.map((member) => [member.externalId, member]),
  );

  const allocations: ResponsibilityAllocationRecord[] = [];
  allocationInputs.forEach((allocation, index) => {
    const path = `allocations[${index}]`;
    const obligation = obligationByExternalId.get(
      allocation.obligationExternalId,
    );
    const member = memberByExternalId.get(allocation.memberExternalId);
    issues.push(
      ...validateNextCapabilityCollection(
        allocation.citations,
        `${path}.citations`,
        "Allocation citations",
      ),
    );
    const local = validateCitations(
      allocation.citations.slice(0, NEXT_CAPABILITY_MAX_ITEMS),
      sourceSet.byKey,
      `${path}.citations`,
    );
    const textIssues = validateNextCapabilityText(
      allocation.rationale,
      `${path}.rationale`,
      "Allocation rationale",
    );
    issues.push(
      ...local.issues,
      ...textIssues,
      ...validateHumanReview(allocation.review, `${path}.review`),
    );
    if (!obligation) {
      issues.push({
        code: "allocation_obligation_reference_missing",
        severity: "blocker",
        path: `${path}.obligationExternalId`,
        message: "Every allocation must reference a valid cited obligation.",
      });
    }
    if (!member) {
      issues.push({
        code: "allocation_member_reference_missing",
        severity: "blocker",
        path: `${path}.memberExternalId`,
        message: "Every allocation must reference a valid cited member.",
      });
    }
    if (!CONSORTIUM_ROLES.includes(allocation.role)) {
      issues.push({
        code: "invalid_allocation_role",
        severity: "blocker",
        path: `${path}.role`,
        message: "An allocation role must use the closed consortium-role set.",
      });
    }
    if (!RESPONSIBILITY_KINDS.includes(allocation.responsibility)) {
      issues.push({
        code: "invalid_responsibility_kind",
        severity: "blocker",
        path: `${path}.responsibility`,
        message: "Responsibility must use the closed proposal-only set.",
      });
    }
    if (member && !member.eligibleRoles.includes(allocation.role)) {
      issues.push({
        code: "allocation_outside_member_role",
        severity: "blocker",
        path: `${path}.role`,
        message:
          "A proposed allocation may not exceed the member's cited, reviewed role set.",
      });
    }
    const obligationCitationIds = new Set(
      obligation?.citations.map((citation) => citation.citationId) ?? [],
    );
    const anchoredToObligation =
      local.citations.length > 0 &&
      local.citations.every(
        (citation) =>
          isTenderCitation([citation]) &&
          obligationCitationIds.has(citation.citationId),
      );
    const rationaleCited = local.citations.some((citation) =>
      normalized(citation.quote).includes(normalized(allocation.rationale)),
    );
    if (local.citations.length && !anchoredToObligation) {
      issues.push({
        code: "allocation_citation_not_obligation_bound",
        severity: "blocker",
        path: `${path}.citations`,
        message:
          "An allocation must reuse an exact citation range from its specific tender obligation.",
      });
    }
    if (local.citations.length && !rationaleCited) {
      issues.push({
        code: "allocation_rationale_not_cited",
        severity: "blocker",
        path: `${path}.citations`,
        message:
          "The allocation rationale must occur in an exact citation bound to the referenced obligation.",
      });
    }
    if (
      obligation &&
      member &&
      isValidId(allocation.externalId) &&
      textIssues.length === 0 &&
      local.issues.length === 0 &&
      CONSORTIUM_ROLES.includes(allocation.role) &&
      RESPONSIBILITY_KINDS.includes(allocation.responsibility) &&
      member.eligibleRoles.includes(allocation.role) &&
      anchoredToObligation &&
      rationaleCited
    ) {
      allocations.push({
        ...allocation,
        allocationId: deterministicId("consalloc", {
          externalId: allocation.externalId,
          obligationId: obligation.obligationId,
          memberId: member.memberId,
          role: allocation.role,
          responsibility: allocation.responsibility,
          rationale: allocation.rationale,
          citations: local.citations,
        }),
        obligationId: obligation.obligationId,
        memberId: member.memberId,
        citations: local.citations,
      });
    }
  });
  allocations.sort((left, right) =>
    left.allocationId.localeCompare(right.allocationId),
  );

  const primaryKeys = new Set<string>();
  allocations.forEach((allocation) => {
    if (allocation.responsibility !== "primary") return;
    const key = `${allocation.obligationId}\u0000${allocation.role}`;
    if (primaryKeys.has(key)) {
      issues.push({
        code: "ambiguous_primary_responsibility",
        severity: "blocker",
        path: `allocations.${allocation.obligationExternalId}`,
        message:
          "An obligation role may have only one proposed primary member.",
      });
    }
    primaryKeys.add(key);
  });

  const coverage: ConsortiumObligationCoverage[] = obligations.map(
    (obligation) => {
      const candidates = allocations.filter(
        (allocation) => allocation.obligationId === obligation.obligationId,
      );
      const accepted = candidates.filter((allocation) =>
        reviewIsAccepted(allocation.review),
      );
      const acceptedCovering = accepted.filter(
        (allocation) =>
          allocation.responsibility === "primary" ||
          allocation.responsibility === "joint_and_several",
      );
      const missingRoles = obligation.requiredRoles
        .filter(
          (role) =>
            !acceptedCovering.some((allocation) => allocation.role === role),
        )
        .sort();
      const jointAndSeveralCovered =
        !obligation.jointAndSeveralRequired ||
        (accepted.length > 0 &&
          accepted.length === candidates.length &&
          accepted.every(
            (allocation) => allocation.responsibility === "joint_and_several",
          ));
      const referencedMembers = candidates
        .map((allocation) =>
          members.find((member) => member.memberId === allocation.memberId),
        )
        .filter((member): member is ConsortiumMemberRecord => Boolean(member));
      const pending =
        !reviewIsAccepted(obligation.review) ||
        candidates.some((allocation) => !reviewIsAccepted(allocation.review)) ||
        referencedMembers.some((member) => !reviewIsAccepted(member.review));
      const state: ConsortiumObligationCoverage["state"] =
        candidates.length === 0
          ? "missing_allocation"
          : pending
            ? "pending_review"
            : missingRoles.length > 0 || !jointAndSeveralCovered
              ? "constraint_gap"
              : "covered";
      return {
        obligationId: obligation.obligationId,
        allocationIds: candidates
          .map((allocation) => allocation.allocationId)
          .sort(),
        missingRoles,
        jointAndSeveralCovered,
        state,
      };
    },
  );
  coverage.sort((left, right) =>
    left.obligationId.localeCompare(right.obligationId),
  );
  const allocatedMemberIds = new Set(
    allocations.map((allocation) => allocation.memberId),
  );
  const unallocatedMemberIds = members
    .filter((member) => !allocatedMemberIds.has(member.memberId))
    .map((member) => member.memberId)
    .sort();

  const matrixId = deterministicId("consmatrix", {
    obligations: obligations.map((obligation) => [
      obligation.obligationId,
      obligation.review,
    ]),
    members: members.map((member) => [member.memberId, member.review]),
    allocations: allocations.map((allocation) => [
      allocation.allocationId,
      allocation.review,
    ]),
    coverage,
    unallocatedMemberIds,
  });
  const matrixReviewResult = resolveSubjectReview(
    matrixId,
    input.matrixReview,
    "matrixReview",
  );
  issues.push(...matrixReviewResult.issues);
  const sortedIssues = sortIssues(issues);
  const complete =
    obligations.length > 0 &&
    members.length > 0 &&
    unallocatedMemberIds.length === 0 &&
    coverage.length === obligations.length &&
    coverage.every((entry) => entry.state === "covered");
  const readyForInternalPlanningUse =
    !hasBlockers(sortedIssues) &&
    complete &&
    reviewIsAccepted(matrixReviewResult.review);
  const status: ConsortiumResponsibilityResult["status"] = hasBlockers(
    sortedIssues,
  )
    ? "blocked"
    : !complete && coverage.every((entry) => entry.state !== "pending_review")
      ? "incomplete"
      : readyForInternalPlanningUse
        ? "ready"
        : "review_required";
  return {
    matrixId,
    status,
    readyForInternalPlanningUse,
    obligations,
    members,
    allocations,
    coverage,
    unallocatedMemberIds,
    review: matrixReviewResult.review,
    issues: sortedIssues,
    partnerCommitmentConfirmed: false,
    consortiumAgreementGenerated: false,
    legalAgreementAuthorized: false,
    safety: nextCapabilitySafety(2),
  };
}
