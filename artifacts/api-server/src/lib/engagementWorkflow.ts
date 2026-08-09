export const ENGAGEMENT_STAGES = [
  "organisation_onboarding",
  "identity_verification",
  "nda_privacy",
  "tender_identification",
  "conflict_review",
  "entitlement_validation",
  "secure_intake",
  "document_processing",
  "requirement_review",
  "work_assignment",
  "remediation",
  "grounded_drafting",
  "boq_verification",
  "red_team_review",
  "reviewer_approval",
  "package_assembly",
  "named_signoff",
  "export_delivery",
  "outcome_capture",
  "archived",
] as const;

export type EngagementStage = (typeof ENGAGEMENT_STAGES)[number];
export type TerminalEngagementStage = "archived" | "withdrawn" | "cancelled";
export type EngagementState = EngagementStage | "withdrawn" | "cancelled";

export type WorkflowEvent =
  | "progress"
  | "reopen"
  | "apply_addendum"
  | "replace_document"
  | "retry_processing"
  | "withdraw"
  | "cancel"
  | "archive";

export type WorkflowDenialCode =
  | "stale_version"
  | "terminal_state"
  | "invalid_transition"
  | "approval_required"
  | "reason_required"
  | "readiness_gate_failed"
  | "recovery_incomplete";

export interface WorkflowTransitionInput {
  from: EngagementState;
  to: EngagementState;
  event: WorkflowEvent;
  currentVersion: number;
  expectedVersion: number;
  reason?: string | null;
  ownerApproved?: boolean;
  readinessGatePassed?: boolean;
  recoveryComplete?: boolean;
}

export interface WorkflowTransitionDecision {
  allowed: boolean;
  code?: WorkflowDenialCode;
  message: string;
  nextVersion: number;
}

const TERMINAL = new Set<EngagementState>([
  "archived",
  "withdrawn",
  "cancelled",
]);
const REOPENABLE = new Set<EngagementState>([
  "remediation",
  "grounded_drafting",
  "boq_verification",
  "red_team_review",
  "reviewer_approval",
  "package_assembly",
  "named_signoff",
  "export_delivery",
  "outcome_capture",
]);
const ADDENDUM_APPLICABLE = new Set<EngagementState>([
  "requirement_review",
  "work_assignment",
  "remediation",
  "grounded_drafting",
  "boq_verification",
  "red_team_review",
  "reviewer_approval",
  "package_assembly",
  "named_signoff",
  "export_delivery",
]);

const deny = (
  input: WorkflowTransitionInput,
  code: WorkflowDenialCode,
  message: string,
): WorkflowTransitionDecision => ({
  allowed: false,
  code,
  message,
  nextVersion: input.currentVersion,
});

const allow = (
  input: WorkflowTransitionInput,
  message: string,
): WorkflowTransitionDecision => ({
  allowed: true,
  message,
  nextVersion: input.currentVersion + 1,
});

/**
 * Authoritative engagement transition policy. The caller must persist the
 * transition with an optimistic `WHERE version = currentVersion` check and an
 * audit record in the same transaction. This function deliberately has no
 * database or UI dependency so every branch can be release-gated.
 */
export function evaluateEngagementTransition(
  input: WorkflowTransitionInput,
): WorkflowTransitionDecision {
  if (input.expectedVersion !== input.currentVersion) {
    return deny(
      input,
      "stale_version",
      "The engagement changed; reload before retrying.",
    );
  }
  if (TERMINAL.has(input.from)) {
    return deny(
      input,
      "terminal_state",
      "Terminal engagements cannot be mutated.",
    );
  }

  const reason = input.reason?.trim() ?? "";

  if (input.event === "withdraw" || input.event === "cancel") {
    const requiredTarget =
      input.event === "withdraw" ? "withdrawn" : "cancelled";
    if (input.to !== requiredTarget) {
      return deny(
        input,
        "invalid_transition",
        `${input.event} must enter ${requiredTarget}.`,
      );
    }
    if (!input.ownerApproved) {
      return deny(input, "approval_required", "Owner approval is required.");
    }
    if (!reason) {
      return deny(input, "reason_required", "A recorded reason is required.");
    }
    return allow(input, `Engagement ${requiredTarget}.`);
  }

  if (input.event === "archive") {
    if (input.to !== "archived" || input.from !== "outcome_capture") {
      return deny(
        input,
        "invalid_transition",
        "Only completed outcome capture may be archived.",
      );
    }
    if (!input.ownerApproved) {
      return deny(
        input,
        "approval_required",
        "Owner approval is required before archive.",
      );
    }
    return allow(
      input,
      "Engagement archived; retention and legal-hold rules remain in force.",
    );
  }

  if (input.event === "retry_processing") {
    if (
      input.from !== "document_processing" ||
      input.to !== "document_processing"
    ) {
      return deny(
        input,
        "invalid_transition",
        "Only document processing can be retried in place.",
      );
    }
    if (input.recoveryComplete !== true) {
      return deny(
        input,
        "recovery_incomplete",
        "The failed attempt must be reconciled before retry.",
      );
    }
    return allow(input, "Document processing retry recorded.");
  }

  if (input.event === "replace_document") {
    if (input.from !== "document_processing" || input.to !== "secure_intake") {
      return deny(
        input,
        "invalid_transition",
        "Document replacement returns processing to secure intake.",
      );
    }
    if (!reason) {
      return deny(
        input,
        "reason_required",
        "Document replacement requires a reason.",
      );
    }
    return allow(
      input,
      "Replacement document requires new integrity and version checks.",
    );
  }

  if (input.event === "apply_addendum") {
    if (
      !ADDENDUM_APPLICABLE.has(input.from) ||
      input.to !== "requirement_review"
    ) {
      return deny(
        input,
        "invalid_transition",
        "An addendum returns active work to requirement review.",
      );
    }
    if (!reason) {
      return deny(
        input,
        "reason_required",
        "Addendum application requires a reason and source version.",
      );
    }
    return allow(
      input,
      "Addendum applied; downstream approvals and packages are stale.",
    );
  }

  if (input.event === "reopen") {
    if (!REOPENABLE.has(input.from) || input.to !== "remediation") {
      return deny(
        input,
        "invalid_transition",
        "Eligible downstream work reopens into remediation.",
      );
    }
    if (!input.ownerApproved) {
      return deny(
        input,
        "approval_required",
        "Reopening requires an authorised owner.",
      );
    }
    if (!reason) {
      return deny(
        input,
        "reason_required",
        "Reopening requires a recorded reason.",
      );
    }
    return allow(
      input,
      "Engagement reopened; downstream approvals and exports are stale.",
    );
  }

  if (input.event === "progress") {
    const fromIndex = ENGAGEMENT_STAGES.indexOf(input.from as EngagementStage);
    const toIndex = ENGAGEMENT_STAGES.indexOf(input.to as EngagementStage);
    if (fromIndex < 0 || toIndex !== fromIndex + 1) {
      return deny(
        input,
        "invalid_transition",
        "Progress may advance exactly one lifecycle stage.",
      );
    }
    if (input.to === "archived") {
      return deny(
        input,
        "invalid_transition",
        "Archive requires its explicit approved event.",
      );
    }
    if (input.to === "named_signoff" && input.readinessGatePassed !== true) {
      return deny(
        input,
        "readiness_gate_failed",
        "Named sign-off requires the complete server readiness gate.",
      );
    }
    return allow(input, `Engagement advanced to ${input.to}.`);
  }

  return deny(
    input,
    "invalid_transition",
    "The requested workflow event is not permitted.",
  );
}
