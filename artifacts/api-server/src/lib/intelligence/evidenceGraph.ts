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

export interface EvidenceRequirementInput {
  readonly externalId: string;
  readonly statement: string;
  readonly mandatory: boolean;
  readonly citations: readonly ExactCitation[];
  readonly review: HumanReview;
}

export interface EvidenceItemInput {
  readonly externalId: string;
  readonly evidenceKind: string;
  readonly label: string;
  readonly validFrom?: string;
  readonly validUntil?: string;
  readonly citations: readonly ExactCitation[];
  readonly review: HumanReview;
}

export interface EvidenceLinkInput {
  readonly externalId: string;
  readonly requirementExternalId: string;
  readonly evidenceExternalId: string;
  readonly rationale: string;
  readonly citations: readonly ExactCitation[];
  readonly review: HumanReview;
}

export interface EvidenceGraphInput {
  readonly asOfDate: string;
  readonly sources: readonly SourceDocument[];
  readonly requirements: readonly EvidenceRequirementInput[];
  readonly evidence: readonly EvidenceItemInput[];
  readonly links: readonly EvidenceLinkInput[];
  readonly graphReview?: SubjectReview;
}

export interface EvidenceRequirementNode {
  readonly nodeId: string;
  readonly externalId: string;
  readonly statement: string;
  readonly mandatory: boolean;
  readonly citations: readonly GroundedCitation[];
  readonly review: HumanReview;
}

export interface EvidenceItemNode {
  readonly nodeId: string;
  readonly externalId: string;
  readonly evidenceKind: string;
  readonly label: string;
  readonly validFrom?: string;
  readonly validUntil?: string;
  readonly validity: "current" | "not_yet_valid" | "expired";
  readonly citations: readonly GroundedCitation[];
  readonly review: HumanReview;
}

export interface EvidenceGraphEdge {
  readonly edgeId: string;
  readonly externalId: string;
  readonly requirementNodeId: string;
  readonly evidenceNodeId: string;
  readonly rationale: string;
  readonly citations: readonly GroundedCitation[];
  readonly review: HumanReview;
  readonly usable: boolean;
}

export interface RequirementCoverage {
  readonly requirementNodeId: string;
  readonly status: "covered" | "uncovered" | "pending_review";
  readonly usableEvidenceNodeIds: readonly string[];
}

export interface EvidenceGraphResult {
  readonly graphId: string;
  readonly status: "blocked" | "needs_evidence" | "review_required" | "ready";
  readonly readyForUse: boolean;
  readonly requirements: readonly EvidenceRequirementNode[];
  readonly evidence: readonly EvidenceItemNode[];
  readonly edges: readonly EvidenceGraphEdge[];
  readonly coverage: readonly RequirementCoverage[];
  readonly review: HumanReview;
  readonly issues: readonly DomainIssue[];
}

function validityAt(
  asOfDate: string,
  validFrom?: string,
  validUntil?: string,
): EvidenceItemNode["validity"] {
  if (validFrom && asOfDate < validFrom) return "not_yet_valid";
  if (validUntil && asOfDate > validUntil) return "expired";
  return "current";
}

/**
 * Builds a deterministic, provenance-checked evidence graph. No link becomes
 * usable until the requirement, evidence item, and link have each been
 * accepted by a named human reviewer.
 */
export function buildEvidenceGraph(
  input: EvidenceGraphInput,
): EvidenceGraphResult {
  const sourceSet = validateSources(input.sources);
  const issues: DomainIssue[] = [...sourceSet.issues];
  if (!isIsoDate(input.asOfDate)) {
    issues.push({
      code: "invalid_as_of_date",
      severity: "blocker",
      path: "asOfDate",
      message: "Evidence evaluation requires a valid ISO calendar date.",
    });
  }
  issues.push(...uniqueIds(input.requirements, "requirements"));
  issues.push(...uniqueIds(input.evidence, "evidence"));
  issues.push(...uniqueIds(input.links, "links"));
  const requirements: EvidenceRequirementNode[] = [];
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
    if (!requirement.statement.trim()) {
      issues.push({
        code: "requirement_statement_required",
        severity: "blocker",
        path: `${path}.statement`,
        message: "An evidence requirement must contain a statement.",
      });
    }
    if (
      !local.issues.length &&
      requirement.statement.trim() &&
      isValidId(requirement.externalId)
    ) {
      requirements.push({
        nodeId: deterministicId("reqnode", {
          externalId: requirement.externalId,
          statement: requirement.statement,
          mandatory: requirement.mandatory,
          citationIds: local.citations.map((citation) => citation.citationId),
        }),
        externalId: requirement.externalId,
        statement: requirement.statement,
        mandatory: requirement.mandatory,
        citations: local.citations,
        review: requirement.review,
      });
    }
  });

  const evidence: EvidenceItemNode[] = [];
  input.evidence.forEach((item, index) => {
    const path = `evidence[${index}]`;
    const local = validateCitations(
      item.citations,
      sourceSet.byKey,
      `${path}.citations`,
    );
    issues.push(
      ...local.issues,
      ...validateHumanReview(item.review, `${path}.review`),
    );
    if (!item.label.trim() || !isValidId(item.evidenceKind)) {
      issues.push({
        code: "invalid_evidence_descriptor",
        severity: "blocker",
        path,
        message: "Evidence requires a label and stable evidence-kind ID.",
      });
    }
    if (item.validFrom && !isIsoDate(item.validFrom)) {
      issues.push({
        code: "invalid_evidence_date",
        severity: "blocker",
        path: `${path}.validFrom`,
        message: "Evidence validity dates must be ISO calendar dates.",
      });
    }
    if (item.validUntil && !isIsoDate(item.validUntil)) {
      issues.push({
        code: "invalid_evidence_date",
        severity: "blocker",
        path: `${path}.validUntil`,
        message: "Evidence validity dates must be ISO calendar dates.",
      });
    }
    if (item.validFrom && item.validUntil && item.validFrom > item.validUntil) {
      issues.push({
        code: "invalid_evidence_date_range",
        severity: "blocker",
        path,
        message: "Evidence validity start may not be after its end.",
      });
    }
    if (
      !local.issues.length &&
      item.label.trim() &&
      isValidId(item.externalId) &&
      isValidId(item.evidenceKind) &&
      (!item.validFrom || isIsoDate(item.validFrom)) &&
      (!item.validUntil || isIsoDate(item.validUntil)) &&
      (!item.validFrom || !item.validUntil || item.validFrom <= item.validUntil)
    ) {
      evidence.push({
        nodeId: deterministicId("evnode", {
          externalId: item.externalId,
          kind: item.evidenceKind,
          label: item.label,
          validFrom: item.validFrom,
          validUntil: item.validUntil,
          citationIds: local.citations.map((citation) => citation.citationId),
        }),
        externalId: item.externalId,
        evidenceKind: item.evidenceKind,
        label: item.label,
        validFrom: item.validFrom,
        validUntil: item.validUntil,
        validity: validityAt(input.asOfDate, item.validFrom, item.validUntil),
        citations: local.citations,
        review: item.review,
      });
    }
  });

  const requirementByExternalId = new Map(
    requirements.map((item) => [item.externalId, item]),
  );
  const evidenceByExternalId = new Map(
    evidence.map((item) => [item.externalId, item]),
  );
  const edges: EvidenceGraphEdge[] = [];
  input.links.forEach((link, index) => {
    const path = `links[${index}]`;
    const local = validateCitations(
      link.citations,
      sourceSet.byKey,
      `${path}.citations`,
    );
    issues.push(
      ...local.issues,
      ...validateHumanReview(link.review, `${path}.review`),
    );
    const requirement = requirementByExternalId.get(link.requirementExternalId);
    const item = evidenceByExternalId.get(link.evidenceExternalId);
    if (!requirement || !item) {
      issues.push({
        code: "evidence_link_target_missing",
        severity: "blocker",
        path,
        message:
          "Every link must reference a valid requirement and evidence item.",
      });
    }
    if (!link.rationale.trim()) {
      issues.push({
        code: "evidence_link_rationale_required",
        severity: "blocker",
        path: `${path}.rationale`,
        message: "Every proposed evidence link requires a rationale.",
      });
    }
    if (
      requirement &&
      item &&
      !local.issues.length &&
      link.rationale.trim() &&
      isValidId(link.externalId)
    ) {
      const usable =
        item.validity === "current" &&
        reviewIsAccepted(requirement.review) &&
        reviewIsAccepted(item.review) &&
        reviewIsAccepted(link.review);
      edges.push({
        edgeId: deterministicId("evedge", {
          externalId: link.externalId,
          requirementNodeId: requirement.nodeId,
          evidenceNodeId: item.nodeId,
          rationale: link.rationale,
          citationIds: local.citations.map((citation) => citation.citationId),
        }),
        externalId: link.externalId,
        requirementNodeId: requirement.nodeId,
        evidenceNodeId: item.nodeId,
        rationale: link.rationale,
        citations: local.citations,
        review: link.review,
        usable,
      });
    }
  });

  requirements.sort((left, right) => left.nodeId.localeCompare(right.nodeId));
  evidence.sort((left, right) => left.nodeId.localeCompare(right.nodeId));
  edges.sort((left, right) => left.edgeId.localeCompare(right.edgeId));
  const coverage: RequirementCoverage[] = requirements.map((requirement) => {
    const candidateEdges = edges.filter(
      (edge) => edge.requirementNodeId === requirement.nodeId,
    );
    const usableEvidenceNodeIds = candidateEdges
      .filter((edge) => edge.usable)
      .map((edge) => edge.evidenceNodeId)
      .sort();
    return {
      requirementNodeId: requirement.nodeId,
      status: usableEvidenceNodeIds.length
        ? "covered"
        : candidateEdges.length
          ? "pending_review"
          : "uncovered",
      usableEvidenceNodeIds,
    };
  });
  const graphId = deterministicId("evgraph", {
    asOfDate: input.asOfDate,
    requirements: requirements.map((item) => [item.nodeId, item.review.state]),
    evidence: evidence.map((item) => [
      item.nodeId,
      item.validity,
      item.review.state,
    ]),
    edges: edges.map((item) => [item.edgeId, item.usable, item.review.state]),
    coverage,
  });
  const graphReviewResult = resolveSubjectReview(
    graphId,
    input.graphReview,
    "graphReview",
  );
  issues.push(...graphReviewResult.issues);
  const graphReview = graphReviewResult.review;
  const sortedIssues = sortIssues(issues);
  const mandatoryUncovered = coverage.some((entry) => {
    const requirement = requirements.find(
      (item) => item.nodeId === entry.requirementNodeId,
    );
    return requirement?.mandatory && entry.status !== "covered";
  });
  const readyForUse =
    !hasBlockers(sortedIssues) &&
    !mandatoryUncovered &&
    reviewIsAccepted(graphReview);
  const status: EvidenceGraphResult["status"] = hasBlockers(sortedIssues)
    ? "blocked"
    : mandatoryUncovered
      ? coverage.some((entry) => entry.status === "pending_review")
        ? "review_required"
        : "needs_evidence"
      : readyForUse
        ? "ready"
        : "review_required";
  return {
    graphId,
    status,
    readyForUse,
    requirements,
    evidence,
    edges,
    coverage,
    review: graphReview,
    issues: sortedIssues,
  };
}
