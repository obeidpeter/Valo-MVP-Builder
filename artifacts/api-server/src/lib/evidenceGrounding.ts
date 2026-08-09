export type ClaimKind =
  | "material_factual"
  | "non_factual"
  | "unresolved_placeholder";
export type EvidenceApprovalState =
  | "approved"
  | "unverified"
  | "rejected"
  | "withdrawn"
  | "expired";

export interface GroundedClaim {
  id: string;
  tenantId: string;
  text: string;
  kind: ClaimKind;
  evidenceLinks: Array<{
    evidenceId: string;
    evidenceVersionId: string;
    citation?: string | null;
  }>;
}

export interface ApprovedEvidence {
  id: string;
  versionId: string;
  tenantId: string;
  state: EvidenceApprovalState;
  validFrom?: string | null;
  validUntil?: string | null;
  allowedEngagementIds?: string[] | null;
  prohibitedTenderCategories?: string[] | null;
}

export type GroundingBlockerCode =
  | "unresolved_placeholder"
  | "missing_evidence"
  | "evidence_not_found"
  | "evidence_version_mismatch"
  | "cross_tenant_evidence"
  | "evidence_not_approved"
  | "evidence_not_yet_valid"
  | "evidence_expired"
  | "evidence_restricted"
  | "evidence_citation_missing";

export interface GroundingBlocker {
  code: GroundingBlockerCode;
  claimId: string;
  evidenceId?: string;
  message: string;
}

export interface GroundingInput {
  tenantId: string;
  engagementId: string;
  tenderCategory?: string | null;
  claims: GroundedClaim[];
  evidence: ApprovedEvidence[];
  asOf: string;
  releaseMode: boolean;
}

export interface GroundingResult {
  releasable: boolean;
  blockers: GroundingBlocker[];
  approvedEvidenceIds: string[];
}

const isoMillis = (value: string): number | null => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * Enforces claim-level provenance before package release. Drafts may retain an
 * explicit placeholder, but the same placeholder is a hard blocker in release
 * mode. Evidence identity includes an immutable version, not just a mutable
 * artefact record.
 */
export function validateEvidenceGrounding(
  input: GroundingInput,
): GroundingResult {
  const blockers: GroundingBlocker[] = [];
  const approvedEvidenceIds = new Set<string>();
  const asOf = isoMillis(input.asOf);

  for (const claim of input.claims) {
    if (claim.tenantId !== input.tenantId) {
      blockers.push({
        code: "cross_tenant_evidence",
        claimId: claim.id,
        message: "The claim belongs to another tenant.",
      });
      continue;
    }

    if (claim.kind === "unresolved_placeholder") {
      if (input.releaseMode) {
        blockers.push({
          code: "unresolved_placeholder",
          claimId: claim.id,
          message: "Unresolved placeholders cannot enter a released package.",
        });
      }
      continue;
    }
    if (claim.kind === "non_factual") continue;

    if (claim.evidenceLinks.length === 0) {
      blockers.push({
        code: "missing_evidence",
        claimId: claim.id,
        message: "A material factual claim requires approved evidence.",
      });
      continue;
    }

    let validLinkCount = 0;
    for (const link of claim.evidenceLinks) {
      const exact = input.evidence.find(
        (item) =>
          item.id === link.evidenceId &&
          item.versionId === link.evidenceVersionId,
      );
      if (!exact) {
        const otherVersion = input.evidence.some(
          (item) => item.id === link.evidenceId,
        );
        blockers.push({
          code: otherVersion
            ? "evidence_version_mismatch"
            : "evidence_not_found",
          claimId: claim.id,
          evidenceId: link.evidenceId,
          message: otherVersion
            ? "The claim cites a stale or unknown evidence version."
            : "The cited evidence does not exist.",
        });
        continue;
      }
      if (exact.tenantId !== input.tenantId) {
        blockers.push({
          code: "cross_tenant_evidence",
          claimId: claim.id,
          evidenceId: exact.id,
          message: "Cross-tenant evidence use is prohibited.",
        });
        continue;
      }
      if (exact.state !== "approved") {
        blockers.push({
          code: "evidence_not_approved",
          claimId: claim.id,
          evidenceId: exact.id,
          message: `Evidence is ${exact.state}, not approved.`,
        });
        continue;
      }
      const validFrom = exact.validFrom ? isoMillis(exact.validFrom) : null;
      const validUntil = exact.validUntil ? isoMillis(exact.validUntil) : null;
      if (asOf !== null && validFrom !== null && asOf < validFrom) {
        blockers.push({
          code: "evidence_not_yet_valid",
          claimId: claim.id,
          evidenceId: exact.id,
          message: "Evidence is not valid at the package effective date.",
        });
        continue;
      }
      if (asOf !== null && validUntil !== null && asOf > validUntil) {
        blockers.push({
          code: "evidence_expired",
          claimId: claim.id,
          evidenceId: exact.id,
          message: "Evidence expired before the package effective date.",
        });
        continue;
      }
      if (
        exact.allowedEngagementIds?.length &&
        !exact.allowedEngagementIds.includes(input.engagementId)
      ) {
        blockers.push({
          code: "evidence_restricted",
          claimId: claim.id,
          evidenceId: exact.id,
          message: "Evidence restrictions do not permit this engagement.",
        });
        continue;
      }
      if (
        input.tenderCategory &&
        exact.prohibitedTenderCategories?.includes(input.tenderCategory)
      ) {
        blockers.push({
          code: "evidence_restricted",
          claimId: claim.id,
          evidenceId: exact.id,
          message: "Evidence restrictions prohibit this tender category.",
        });
        continue;
      }
      if (!link.citation?.trim()) {
        blockers.push({
          code: "evidence_citation_missing",
          claimId: claim.id,
          evidenceId: exact.id,
          message: "The claim-to-evidence link lacks a resolvable citation.",
        });
        continue;
      }
      validLinkCount += 1;
      approvedEvidenceIds.add(exact.id);
    }

    if (
      validLinkCount === 0 &&
      !blockers.some((blocker) => blocker.claimId === claim.id)
    ) {
      blockers.push({
        code: "missing_evidence",
        claimId: claim.id,
        message: "No valid approved evidence supports this claim.",
      });
    }
  }

  return {
    releasable: blockers.length === 0,
    blockers,
    approvedEvidenceIds: [...approvedEvidenceIds].sort(),
  };
}
