import type { Severity } from "./deterministic";

export type DefectDecisionAction =
  | "reclassify"
  | "waive"
  | "remediate"
  | "delete";
export type DefectDecisionDenial =
  | "deletion_prohibited"
  | "human_actor_required"
  | "reason_required"
  | "evidence_required"
  | "independent_approval_required"
  | "approver_role_insufficient";

export interface DefectDecisionInput {
  action: DefectDecisionAction;
  currentSeverity: Severity;
  proposedSeverity?: Severity | null;
  initiatedBy: string;
  approvedBy?: string | null;
  approverRole?: string | null;
  initiatorIsHuman: boolean;
  approverIsHuman?: boolean;
  reason?: string | null;
  evidenceIds?: string[];
}

export interface DefectDecisionResult {
  allowed: boolean;
  code?: DefectDecisionDenial;
  message: string;
  requiresIndependentApproval: boolean;
}

const RANK: Record<Severity, number> = {
  cosmetic: 0,
  scoring_risk: 1,
  likely_fatal: 2,
  fatal: 3,
};
const INDEPENDENT_APPROVER_ROLES = new Set([
  "client_reviewer_approver",
  "valo_quality_adviser",
  "client_reviewer",
  "reviewer", // legacy migration alias
]);

/**
 * Generic PATCH may confirm an AI suggestion or raise severity. It can never
 * lower severity or reach a disposition state; those actions require the
 * persisted defect-decision workflow with reason, evidence and (for blocking
 * findings) an independent quality approver.
 */
export function isDirectDefectMutationAllowed(input: {
  currentStatus: string;
  proposedStatus?: string;
  currentSeverity: Severity;
  proposedSeverity?: Severity;
}): boolean {
  if (
    input.proposedStatus !== undefined &&
    input.proposedStatus !== input.currentStatus &&
    !(input.currentStatus === "suggested" && input.proposedStatus === "open")
  ) {
    return false;
  }
  return (
    input.proposedSeverity === undefined ||
    RANK[input.proposedSeverity] >= RANK[input.currentSeverity]
  );
}

/**
 * Fatal/likely-fatal decisions are governed requests, never generic PATCHes.
 * Deletion is prohibited so the original classification remains attributable.
 */
export function evaluateDefectDecision(
  input: DefectDecisionInput,
): DefectDecisionResult {
  const isBlocking =
    input.currentSeverity === "fatal" ||
    input.currentSeverity === "likely_fatal";
  const lowersSeverity =
    input.action === "reclassify" &&
    input.proposedSeverity != null &&
    RANK[input.proposedSeverity] < RANK[input.currentSeverity];
  const requiresIndependentApproval =
    isBlocking &&
    (lowersSeverity ||
      input.action === "waive" ||
      input.action === "remediate");

  if (input.action === "delete") {
    return {
      allowed: false,
      code: "deletion_prohibited",
      message:
        "Defects are immutable records; supersede them through an audited decision.",
      requiresIndependentApproval: isBlocking,
    };
  }
  if (
    !input.initiatorIsHuman ||
    (requiresIndependentApproval && !input.approverIsHuman)
  ) {
    return {
      allowed: false,
      code: "human_actor_required",
      message: "AI and service actors cannot approve defect decisions.",
      requiresIndependentApproval,
    };
  }
  if (!input.reason?.trim()) {
    return {
      allowed: false,
      code: "reason_required",
      message: "A substantive recorded reason is required.",
      requiresIndependentApproval,
    };
  }
  if (
    (lowersSeverity || input.action === "remediate") &&
    (input.evidenceIds?.length ?? 0) === 0
  ) {
    return {
      allowed: false,
      code: "evidence_required",
      message: "Reclassification or remediation requires linked evidence.",
      requiresIndependentApproval,
    };
  }
  if (requiresIndependentApproval) {
    if (!input.approvedBy || input.approvedBy === input.initiatedBy) {
      return {
        allowed: false,
        code: "independent_approval_required",
        message:
          "A different named human must approve this blocking-defect decision.",
        requiresIndependentApproval,
      };
    }
    if (
      !input.approverRole ||
      !INDEPENDENT_APPROVER_ROLES.has(input.approverRole)
    ) {
      return {
        allowed: false,
        code: "approver_role_insufficient",
        message: "The approver lacks an independent quality-review role.",
        requiresIndependentApproval,
      };
    }
  }
  return {
    allowed: true,
    message:
      "Decision may be persisted with the evidence links and audit record atomically.",
    requiresIndependentApproval,
  };
}
