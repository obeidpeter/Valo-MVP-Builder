export interface EvidenceReviewState {
  evidenceStatus: string;
  suggested: boolean | null;
  confirmedBy: string | null;
}

export interface EvidencePatch {
  evidenceStatus?: string;
  suggested?: boolean;
}

export function isApprovedEvidence(state: EvidenceReviewState): boolean {
  return (
    state.confirmedBy !== null ||
    (state.suggested === false && state.evidenceStatus !== "pending")
  );
}

export function evidencePatchRequiresApproval(
  current: EvidenceReviewState,
  patch: EvidencePatch,
): boolean {
  return (
    isApprovedEvidence(current) ||
    (patch.evidenceStatus !== undefined &&
      patch.evidenceStatus !== "pending") ||
    patch.suggested === false
  );
}

export function capabilityMutationRequiresApproval(
  currentStatus: string,
  proposedStatus?: string,
): boolean {
  return currentStatus === "approved" || proposedStatus !== undefined;
}

export function governedMutationAllowed(
  requiresElevatedPermission: boolean,
  hasElevatedPermission: boolean,
): boolean {
  return !requiresElevatedPermission || hasElevatedPermission;
}
