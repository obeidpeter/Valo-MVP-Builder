// ---------------------------------------------------------------------------
// Engagement workflow governance (FR-CSM-01/03, FR-BIL-01, FR-WFM-01)
// ---------------------------------------------------------------------------

export type ProjectStatus =
  | "intake"
  | "extraction"
  | "review"
  | "defects"
  | "reporting"
  | "signed_off"
  | "exported"
  | "archived";

export type SlaClass = "standard" | "live";
export type PaymentStatus = "not_required" | "pending" | "confirmed";
export type ConflictStatus = "clear" | "blocked" | "consented" | "declined";

const STATUS_ORDER: ProjectStatus[] = [
  "intake",
  "extraction",
  "review",
  "defects",
  "reporting",
  "signed_off",
  "exported",
  "archived",
];

const PRODUCTION_STATUSES = new Set<ProjectStatus>([
  "extraction",
  "review",
  "defects",
  "reporting",
  "signed_off",
  "exported",
]);

export interface WorkflowGateInput {
  fromStatus: ProjectStatus;
  toStatus: ProjectStatus;
  reviewerId?: string | null;
  paymentStatus?: PaymentStatus;
  paymentConfirmedByFounder?: boolean;
  paymentConfirmedByAdvisor?: boolean;
  paymentFounderConfirmedBy?: string | null;
  paymentAdvisorConfirmedBy?: string | null;
  conflictStatus?: ConflictStatus;
  physicalArchiveInstruction?: string | null;
}

export interface WorkflowGateResult {
  ok: boolean;
  reason?: string;
}

/**
 * Dual confirmation means two *people*, not two booleans: each leg must carry
 * a server-derived identity and the two identities must differ. A row where
 * both flags are true but an identity is missing (legacy data, or a write
 * path that bypassed the confirmation endpoint) does NOT satisfy the gate.
 */
export function paymentGateSatisfied(input: {
  paymentStatus?: PaymentStatus;
  paymentConfirmedByFounder?: boolean;
  paymentConfirmedByAdvisor?: boolean;
  paymentFounderConfirmedBy?: string | null;
  paymentAdvisorConfirmedBy?: string | null;
}): boolean {
  if (!input.paymentStatus || input.paymentStatus === "not_required")
    return true;
  return (
    input.paymentStatus === "confirmed" &&
    input.paymentConfirmedByFounder === true &&
    input.paymentConfirmedByAdvisor === true &&
    !!input.paymentFounderConfirmedBy &&
    !!input.paymentAdvisorConfirmedBy &&
    input.paymentFounderConfirmedBy !== input.paymentAdvisorConfirmedBy
  );
}

/**
 * Project state movement is intentionally conservative: normal forward motion
 * can advance one step at a time; remediation can move signed-off-adjacent
 * work back into review/defects/reporting; archive is terminal. Production
 * states also require the TRD control fields that make the process warranty
 * auditable.
 */
export function validateProjectTransition(
  input: WorkflowGateInput,
): WorkflowGateResult {
  const fromIndex = STATUS_ORDER.indexOf(input.fromStatus);
  const toIndex = STATUS_ORDER.indexOf(input.toStatus);
  if (fromIndex < 0 || toIndex < 0)
    return { ok: false, reason: "Unknown project status." };
  if (input.fromStatus === input.toStatus) return { ok: true };
  if (input.fromStatus === "archived") {
    return {
      ok: false,
      reason: "Archived engagements cannot be reopened by status edit.",
    };
  }

  const forwardOne = toIndex === fromIndex + 1;
  const remediationBack =
    fromIndex > toIndex &&
    ["review", "defects", "reporting"].includes(input.toStatus);
  const archive = input.toStatus === "archived";
  if (!forwardOne && !remediationBack && !archive) {
    return {
      ok: false,
      reason: `Illegal status transition: ${input.fromStatus} → ${input.toStatus}.`,
    };
  }

  if (PRODUCTION_STATUSES.has(input.toStatus)) {
    if (!input.reviewerId) {
      return {
        ok: false,
        reason: "A named reviewer is required before production work starts.",
      };
    }
    if (
      input.conflictStatus === "blocked" ||
      input.conflictStatus === "declined"
    ) {
      return { ok: false, reason: "Conflict check is not clear or consented." };
    }
    if (!paymentGateSatisfied(input)) {
      return {
        ok: false,
        reason: "Payment gate is not satisfied by dual confirmation.",
      };
    }
  }

  if (
    (input.toStatus === "exported" || input.toStatus === "archived") &&
    (!input.physicalArchiveInstruction ||
      input.physicalArchiveInstruction.trim().length === 0)
  ) {
    return {
      ok: false,
      reason:
        "Physical archive return/destroy instruction is required before close/export.",
    };
  }

  return { ok: true };
}

function addBusinessDays(date: Date, days: number): Date {
  const d = new Date(date.getTime());
  let remaining = days;
  while (remaining > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) remaining--;
  }
  return d;
}

export function computeSlaDueAt(start: Date, slaClass: SlaClass): Date {
  if (slaClass === "live")
    return new Date(start.getTime() + 48 * 60 * 60 * 1000);
  return addBusinessDays(start, 5);
}

export function computeRedTeamDueAt(
  deadline: string | null | undefined,
): Date | null {
  if (!deadline) return null;
  const parsed = Date.parse(deadline);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed - 72 * 60 * 60 * 1000);
}
