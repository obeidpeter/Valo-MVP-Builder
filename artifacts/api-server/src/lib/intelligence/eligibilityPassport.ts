import {
  deterministicId,
  hasBlockers,
  isIsoDate,
  isValidId,
  resolveSubjectReview,
  reviewIsAccepted,
  sortIssues,
  uniqueIds,
  validateCitations,
  validateHumanReview,
  validateSources,
  type DomainIssue,
  type ExactCitation,
  type GroundedCitation,
  type HumanReview,
  type SourceDocument,
  type SubjectReview,
} from "./domain";

export interface EligibilityRequirementInput {
  readonly externalId: string;
  readonly description: string;
  readonly evidenceKind: string;
  readonly mandatory: boolean;
  readonly requiresCurrentOnSubmissionDate: boolean;
  readonly requiresExactLegalEntityMatch: boolean;
  readonly citations: readonly ExactCitation[];
  readonly review: HumanReview;
}

export interface EligibilityArtifactInput {
  readonly externalId: string;
  readonly evidenceKind: string;
  readonly label: string;
  readonly issuer: string;
  readonly legalEntityName?: string;
  readonly validFrom?: string;
  readonly validUntil?: string;
  readonly citations: readonly ExactCitation[];
  readonly review: HumanReview;
}

export interface EligibilityPassportInput {
  readonly legalEntityName: string;
  readonly submissionDate: string;
  readonly sources: readonly SourceDocument[];
  /** Requirements must be extracted from this tender; no global list is inferred. */
  readonly requirements: readonly EligibilityRequirementInput[];
  readonly artifacts: readonly EligibilityArtifactInput[];
  readonly passportReview?: SubjectReview;
}

export interface EligibilityRequirementRecord extends EligibilityRequirementInput {
  readonly requirementId: string;
  readonly citations: readonly GroundedCitation[];
}

export interface EligibilityArtifactRecord extends EligibilityArtifactInput {
  readonly artifactId: string;
  readonly validity: "current" | "expired" | "not_yet_valid" | "undated";
  readonly citations: readonly GroundedCitation[];
}

export type EligibilityCriterionStatus =
  | "met"
  | "missing"
  | "pending_review"
  | "expired"
  | "not_yet_valid"
  | "validity_unknown"
  | "identity_mismatch";

export interface EligibilityCriterionResult {
  readonly requirementId: string;
  readonly status: EligibilityCriterionStatus;
  readonly selectedArtifactId?: string;
  readonly candidateArtifactIds: readonly string[];
}

export interface EligibilityPassportResult {
  readonly passportId: string;
  readonly status: "blocked" | "incomplete" | "review_required" | "ready";
  readonly readyForSubmissionUse: boolean;
  readonly requirements: readonly EligibilityRequirementRecord[];
  readonly artifacts: readonly EligibilityArtifactRecord[];
  readonly criteria: readonly EligibilityCriterionResult[];
  readonly review: HumanReview;
  readonly issues: readonly DomainIssue[];
}

function artifactValidity(
  submissionDate: string,
  validFrom?: string,
  validUntil?: string,
): EligibilityArtifactRecord["validity"] {
  if (!validFrom && !validUntil) return "undated";
  if (validFrom && submissionDate < validFrom) return "not_yet_valid";
  if (validUntil && submissionDate > validUntil) return "expired";
  return "current";
}

function citationsHaveAllowedSource(
  citations: readonly GroundedCitation[],
  allowedKinds: readonly SourceDocument["kind"][],
  requireAuthoritative: boolean,
): boolean {
  return citations.every(
    (citation) =>
      allowedKinds.includes(citation.sourceKind) &&
      (!requireAuthoritative || citation.sourceAuthority === "authoritative") &&
      citation.sourceAuthority !== "unverified",
  );
}

/**
 * Evaluates only eligibility criteria explicitly supplied from the tender.
 * A passport cannot become ready until all mandatory criteria are met and a
 * named human accepts the exact deterministic passport ID.
 */
export function evaluateEligibilityPassport(
  input: EligibilityPassportInput,
): EligibilityPassportResult {
  const sourceSet = validateSources(input.sources);
  const issues: DomainIssue[] = [...sourceSet.issues];
  if (!input.legalEntityName.trim()) {
    issues.push({
      code: "legal_entity_name_required",
      severity: "blocker",
      path: "legalEntityName",
      message: "A canonical legal-entity name is required.",
    });
  }
  if (!isIsoDate(input.submissionDate)) {
    issues.push({
      code: "invalid_submission_date",
      severity: "blocker",
      path: "submissionDate",
      message: "Eligibility evaluation requires a valid ISO submission date.",
    });
  }
  if (input.requirements.length === 0) {
    issues.push({
      code: "tender_requirements_required",
      severity: "blocker",
      path: "requirements",
      message:
        "A passport may not infer eligibility without tender-cited requirements.",
    });
  }
  issues.push(...uniqueIds(input.requirements, "requirements"));
  issues.push(...uniqueIds(input.artifacts, "artifacts"));

  const requirements: EligibilityRequirementRecord[] = [];
  input.requirements.forEach((requirement, index) => {
    const path = `requirements[${index}]`;
    const local = validateCitations(
      requirement.citations,
      sourceSet.byKey,
      `${path}.citations`,
    );
    issues.push(
      ...local.issues,
      ...validateHumanReview(requirement.review, `${path}.review`),
    );
    if (
      !requirement.description.trim() ||
      !isValidId(requirement.evidenceKind)
    ) {
      issues.push({
        code: "invalid_eligibility_requirement",
        severity: "blocker",
        path,
        message:
          "A requirement needs a description and stable evidence-kind ID.",
      });
    }
    if (
      local.citations.length > 0 &&
      !citationsHaveAllowedSource(
        local.citations,
        ["solicitation", "addendum"],
        true,
      )
    ) {
      issues.push({
        code: "eligibility_requirement_source_invalid",
        severity: "blocker",
        path: `${path}.citations`,
        message:
          "Eligibility requirements require authoritative tender or addendum citations.",
      });
    }
    if (
      !local.issues.length &&
      local.citations.length > 0 &&
      citationsHaveAllowedSource(
        local.citations,
        ["solicitation", "addendum"],
        true,
      ) &&
      requirement.description.trim() &&
      isValidId(requirement.externalId) &&
      isValidId(requirement.evidenceKind)
    ) {
      requirements.push({
        ...requirement,
        requirementId: deterministicId("eligreq", {
          externalId: requirement.externalId,
          description: requirement.description,
          evidenceKind: requirement.evidenceKind,
          mandatory: requirement.mandatory,
          requiresCurrentOnSubmissionDate:
            requirement.requiresCurrentOnSubmissionDate,
          requiresExactLegalEntityMatch:
            requirement.requiresExactLegalEntityMatch,
          citationIds: local.citations.map((citation) => citation.citationId),
        }),
        citations: local.citations,
      });
    }
  });

  const artifacts: EligibilityArtifactRecord[] = [];
  input.artifacts.forEach((artifact, index) => {
    const path = `artifacts[${index}]`;
    const local = validateCitations(
      artifact.citations,
      sourceSet.byKey,
      `${path}.citations`,
    );
    issues.push(
      ...local.issues,
      ...validateHumanReview(artifact.review, `${path}.review`),
    );
    if (
      !artifact.label.trim() ||
      !artifact.issuer.trim() ||
      !isValidId(artifact.evidenceKind)
    ) {
      issues.push({
        code: "invalid_eligibility_artifact",
        severity: "blocker",
        path,
        message:
          "An artifact needs a label, issuer, and stable evidence-kind ID.",
      });
    }
    if (
      local.citations.length > 0 &&
      !citationsHaveAllowedSource(local.citations, ["company_evidence"], false)
    ) {
      issues.push({
        code: "eligibility_artifact_source_invalid",
        severity: "blocker",
        path: `${path}.citations`,
        message:
          "Eligibility artifacts require verified company-evidence citations.",
      });
    }
    if (artifact.validFrom && !isIsoDate(artifact.validFrom)) {
      issues.push({
        code: "invalid_artifact_date",
        severity: "blocker",
        path: `${path}.validFrom`,
        message: "Artifact validity dates must be ISO calendar dates.",
      });
    }
    if (artifact.validUntil && !isIsoDate(artifact.validUntil)) {
      issues.push({
        code: "invalid_artifact_date",
        severity: "blocker",
        path: `${path}.validUntil`,
        message: "Artifact validity dates must be ISO calendar dates.",
      });
    }
    if (
      artifact.validFrom &&
      artifact.validUntil &&
      artifact.validFrom > artifact.validUntil
    ) {
      issues.push({
        code: "invalid_artifact_date_range",
        severity: "blocker",
        path,
        message: "Artifact validity start may not be after its end.",
      });
    }
    if (
      !local.issues.length &&
      local.citations.length > 0 &&
      citationsHaveAllowedSource(
        local.citations,
        ["company_evidence"],
        false,
      ) &&
      artifact.label.trim() &&
      artifact.issuer.trim() &&
      isValidId(artifact.externalId) &&
      isValidId(artifact.evidenceKind) &&
      (!artifact.validFrom || isIsoDate(artifact.validFrom)) &&
      (!artifact.validUntil || isIsoDate(artifact.validUntil)) &&
      (!artifact.validFrom ||
        !artifact.validUntil ||
        artifact.validFrom <= artifact.validUntil)
    ) {
      artifacts.push({
        ...artifact,
        artifactId: deterministicId("eligart", {
          externalId: artifact.externalId,
          evidenceKind: artifact.evidenceKind,
          label: artifact.label,
          issuer: artifact.issuer,
          legalEntityName: artifact.legalEntityName,
          validFrom: artifact.validFrom,
          validUntil: artifact.validUntil,
          citationIds: local.citations.map((citation) => citation.citationId),
        }),
        validity: artifactValidity(
          input.submissionDate,
          artifact.validFrom,
          artifact.validUntil,
        ),
        citations: local.citations,
      });
    }
  });

  requirements.sort((left, right) =>
    left.requirementId.localeCompare(right.requirementId),
  );
  artifacts.sort((left, right) =>
    left.artifactId.localeCompare(right.artifactId),
  );
  const criteria: EligibilityCriterionResult[] = requirements.map(
    (requirement) => {
      const candidates = artifacts
        .filter(
          (artifact) => artifact.evidenceKind === requirement.evidenceKind,
        )
        .sort((left, right) => left.artifactId.localeCompare(right.artifactId));
      const candidateArtifactIds = candidates.map(
        (artifact) => artifact.artifactId,
      );
      if (!reviewIsAccepted(requirement.review)) {
        return {
          requirementId: requirement.requirementId,
          status: "pending_review",
          candidateArtifactIds,
        };
      }
      if (candidates.length === 0) {
        return {
          requirementId: requirement.requirementId,
          status: "missing",
          candidateArtifactIds,
        };
      }
      const acceptedCandidates = candidates.filter((artifact) =>
        reviewIsAccepted(artifact.review),
      );
      const acceptable = acceptedCandidates.find((artifact) => {
        if (
          requirement.requiresExactLegalEntityMatch &&
          artifact.legalEntityName !== input.legalEntityName
        ) {
          return false;
        }
        if (!requirement.requiresCurrentOnSubmissionDate) return true;
        return artifact.validUntil != null && artifact.validity === "current";
      });
      if (acceptable) {
        return {
          requirementId: requirement.requirementId,
          status: "met",
          selectedArtifactId: acceptable.artifactId,
          candidateArtifactIds,
        };
      }
      if (candidates.some((artifact) => !reviewIsAccepted(artifact.review))) {
        return {
          requirementId: requirement.requirementId,
          status: "pending_review",
          candidateArtifactIds,
        };
      }
      const entityMatching = acceptedCandidates.filter(
        (artifact) =>
          !requirement.requiresExactLegalEntityMatch ||
          artifact.legalEntityName === input.legalEntityName,
      );
      if (entityMatching.length === 0) {
        return {
          requirementId: requirement.requirementId,
          status: "identity_mismatch",
          candidateArtifactIds,
        };
      }
      if (
        requirement.requiresCurrentOnSubmissionDate &&
        entityMatching.some((artifact) => artifact.validUntil == null)
      ) {
        return {
          requirementId: requirement.requirementId,
          status: "validity_unknown",
          candidateArtifactIds,
        };
      }
      if (
        entityMatching.some((artifact) => artifact.validity === "not_yet_valid")
      ) {
        return {
          requirementId: requirement.requirementId,
          status: "not_yet_valid",
          candidateArtifactIds,
        };
      }
      return {
        requirementId: requirement.requirementId,
        status: "expired",
        candidateArtifactIds,
      };
    },
  );
  criteria.sort((left, right) =>
    left.requirementId.localeCompare(right.requirementId),
  );
  const passportId = deterministicId("eligpass", {
    legalEntityName: input.legalEntityName,
    submissionDate: input.submissionDate,
    requirementIds: requirements.map(
      (requirement) => requirement.requirementId,
    ),
    artifactIds: artifacts.map((artifact) => artifact.artifactId),
    criteria: criteria.map(({ requirementId, status, selectedArtifactId }) => ({
      requirementId,
      status,
      selectedArtifactId,
    })),
  });
  const passportReviewResult = resolveSubjectReview(
    passportId,
    input.passportReview,
    "passportReview",
  );
  issues.push(...passportReviewResult.issues);
  const sortedIssues = sortIssues(issues);
  const mandatoryIncomplete = criteria.some((criterion) => {
    const requirement = requirements.find(
      (item) => item.requirementId === criterion.requirementId,
    );
    return requirement?.mandatory && criterion.status !== "met";
  });
  const readyForSubmissionUse =
    !hasBlockers(sortedIssues) &&
    !mandatoryIncomplete &&
    reviewIsAccepted(passportReviewResult.review);
  const status: EligibilityPassportResult["status"] = hasBlockers(sortedIssues)
    ? "blocked"
    : mandatoryIncomplete
      ? "incomplete"
      : readyForSubmissionUse
        ? "ready"
        : "review_required";
  return {
    passportId,
    status,
    readyForSubmissionUse,
    requirements,
    artifacts,
    criteria,
    review: passportReviewResult.review,
    issues: sortedIssues,
  };
}
