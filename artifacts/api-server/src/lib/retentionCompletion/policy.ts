import type {
  RetentionActionStatus,
  RetentionCompletionPermissions,
} from "./contracts";

export interface StorageTerminalEvidence {
  eventStatus: string;
  eventVersion: number;
  terminalAt: Date | null;
  latestAttemptStatus: string | null;
  latestAttemptResponseCode: string | null;
}

export type StorageTerminalDecision =
  | { outcome: "pending" }
  | { outcome: "dead_letter" }
  | { outcome: "untrusted" }
  | {
      outcome: "trusted";
      disposition: "deleted" | "already_absent";
      terminalEventVersion: number;
      terminalAt: Date;
    };

export type RetentionReconciliationProgress =
  | "reconcile"
  | "wait_for_terminal_evidence"
  | "block_untrusted_terminal_evidence";

export function hasMutableCompletionProtocol(input: {
  requestProtocolVersion: number;
  actionProtocolVersion?: number;
}): boolean {
  return (
    input.requestProtocolVersion === 1 &&
    (input.actionProtocolVersion === undefined ||
      input.actionProtocolVersion === 1)
  );
}

/**
 * Dead letters remain recoverable through the governed storage replay path.
 * Only an immutable terminal outcome that cannot prove deletion closes the
 * retention action as blocked.
 */
export function decideRetentionReconciliationProgress(input: {
  pending: number;
  deadLetters: number;
  untrusted: number;
}): RetentionReconciliationProgress {
  if (input.untrusted > 0) return "block_untrusted_terminal_evidence";
  if (input.pending > 0 || input.deadLetters > 0) {
    return "wait_for_terminal_evidence";
  }
  return "reconcile";
}

/**
 * Certification accepts only a terminal queue row whose latest immutable
 * provider attempt proves deletion or authoritative absence. Operator
 * resolution and reference cancellation remain visible, but are never silently
 * promoted into deletion evidence.
 */
export function decideStorageTerminalEvidence(
  evidence: StorageTerminalEvidence,
): StorageTerminalDecision {
  if (
    evidence.eventStatus === "queued" ||
    evidence.eventStatus === "retry_wait"
  ) {
    return { outcome: "pending" };
  }
  if (evidence.eventStatus === "dead_letter") {
    return { outcome: "dead_letter" };
  }
  if (
    evidence.eventStatus !== "completed" ||
    !evidence.terminalAt ||
    evidence.latestAttemptStatus !== "completed" ||
    (evidence.latestAttemptResponseCode !== "deleted" &&
      evidence.latestAttemptResponseCode !== "already_absent") ||
    !Number.isSafeInteger(evidence.eventVersion) ||
    evidence.eventVersion < 1
  ) {
    return { outcome: "untrusted" };
  }
  return {
    outcome: "trusted",
    disposition: evidence.latestAttemptResponseCode,
    terminalEventVersion: evidence.eventVersion,
    terminalAt: evidence.terminalAt,
  };
}

export function permissionsForSnapshot(input: {
  authorised: boolean;
  completionProtocolVersion: number;
  requestStatus: string;
  actionStatus: RetentionActionStatus | null;
  actorUserId: string;
  preparedByUserId: string | null;
}): RetentionCompletionPermissions {
  if (!input.authorised || input.completionProtocolVersion !== 1) {
    return { canStart: false, canReconcile: false, canCertify: false };
  }
  return {
    canStart: input.requestStatus === "pending" && input.actionStatus === null,
    canReconcile: input.actionStatus === "detached",
    canCertify:
      input.actionStatus === "reconciled" &&
      Boolean(input.preparedByUserId) &&
      input.preparedByUserId !== input.actorUserId,
  };
}
