import type {
  RetentionCompletionActivationEvaluation,
  RETENTION_COMPLETION_WORKFLOW,
} from "./activation";

export const RETENTION_COMPLETION_BOUNDS = Object.freeze({
  requestBodyBytes: 4_096,
  attestationCodeUnits: 512,
  idempotencyKeyCodeUnits: 128,
  listRows: 100,
  storageObjects: 1_000,
  sourceCategories: 100,
  retainedCategories: 25,
  manifestBytes: 1_048_576,
});

export type RetentionRequestStatus =
  | "pending"
  | "reconciling"
  | "completed"
  | "blocked";

export type RetentionActionStatus =
  | "pending"
  | "detached"
  | "reconciled"
  | "certified"
  | "blocked";

export type RetentionStorageTerminalDisposition =
  | "deleted"
  | "already_absent"
  | "cancelled_referenced"
  | "accepted_unresolved";

export interface RetentionCompletionScope {
  organisationId: string;
  actorUserId: string;
  actorMembershipId: string;
}

export interface RetentionCompletionPermissions {
  canStart: boolean;
  canReconcile: boolean;
  canCertify: boolean;
}

export interface RetentionCompletionBlocker {
  code:
    | "workflow_not_activated"
    | "request_not_due"
    | "request_state_conflict"
    | "project_not_concluded"
    | "active_legal_hold"
    | "financial_reconciliation_open"
    | "retainer_work_open"
    | "claims_desk_open"
    | "governed_evidence_retained"
    | "storage_reconciliation_pending"
    | "storage_dead_letter"
    | "storage_terminal_untrusted"
    | "source_manifest_changed"
    | "maker_checker_conflict"
    | "capacity_exceeded";
  message: string;
  count?: number;
}

export interface RetainedCategoryView {
  category:
    | "audit_evidence"
    | "financial_accounting"
    | "legal_hold_evidence"
    | "retention_control"
    | "vault_reference";
  reason: string;
  count: number;
}

export interface RetentionRequestView {
  id: string;
  projectId: string | null;
  subjectProjectId: string;
  requestedByUserId: string | null;
  requestedByName: string | null;
  reason: string | null;
  dueAt: string;
  completedAt: string | null;
  status: RetentionRequestStatus;
  completionProtocolVersion: 0 | 1;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface RetentionActionView {
  id: string;
  retentionRequestId: string;
  subjectProjectId: string;
  status: RetentionActionStatus;
  version: number;
  sourceManifest: unknown | null;
  sourceManifestSha256: string | null;
  purgeReceipt: unknown | null;
  purgeReceiptSha256: string | null;
  purgedAt: string | null;
  reconciliationManifest: unknown | null;
  reconciliationManifestSha256: string | null;
  preparedByUserId: string | null;
  preparedByName: string | null;
  preparedAt: string | null;
  checkedByUserId: string | null;
  checkedByName: string | null;
  checkedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RetentionStorageBindingView {
  id: string;
  kind: "project_retention";
  status:
    | "queued"
    | "retry_wait"
    | "completed"
    | "cancelled"
    | "dead_letter"
    | "resolved";
  terminalDisposition: RetentionStorageTerminalDisposition | null;
}

export interface DeletionCertificateView {
  id: string;
  retentionActionId: string;
  certificateNumber: string;
  scopeManifestHash: string;
  certificateManifest: unknown;
  certificateManifestSha256: string;
  method: "durable_two_phase_detach_reconcile_certify";
  completedAt: string;
  signedByUserId: string;
  signedByName: string;
  signatureEvidence: string;
  createdAt: string;
}

export interface RetentionObjectReconciliationView {
  expected: number;
  detached: number;
  reconciled: number;
  pending: number;
  deadLetters: number;
}

export interface RetentionCompletionSnapshot {
  request: RetentionRequestView;
  action: RetentionActionView | null;
  blockers: readonly RetentionCompletionBlocker[];
  objectReconciliation: RetentionObjectReconciliationView;
  objectBindings: readonly RetentionStorageBindingView[];
  retainedCategories: readonly RetainedCategoryView[];
  certificate: DeletionCertificateView | null;
  permissions: RetentionCompletionPermissions;
  generatedAt: string;
}

export interface RetentionCompletionReadiness extends RetentionCompletionActivationEvaluation {
  checkedAt: string;
  permissions: RetentionCompletionPermissions;
}

export interface RetentionCompletionMutationCommand {
  expectedVersion: number;
  idempotencyKeySha256: string;
  attestationSha256: string;
}

export interface RetentionCompletionRepository {
  databaseNow(scope: RetentionCompletionScope): Promise<Date>;
  list(
    scope: RetentionCompletionScope,
    permissions: RetentionCompletionPermissions,
  ): Promise<readonly RetentionRequestView[]>;
  read(
    scope: RetentionCompletionScope,
    requestId: string,
    permissions: RetentionCompletionPermissions,
  ): Promise<RetentionCompletionSnapshot>;
  detach(
    scope: RetentionCompletionScope,
    requestId: string,
    command: RetentionCompletionMutationCommand,
    permissions: RetentionCompletionPermissions,
  ): Promise<RetentionCompletionSnapshot>;
  reconcile(
    scope: RetentionCompletionScope,
    actionId: string,
    command: RetentionCompletionMutationCommand,
    permissions: RetentionCompletionPermissions,
  ): Promise<RetentionCompletionSnapshot>;
  certify(
    scope: RetentionCompletionScope,
    actionId: string,
    command: RetentionCompletionMutationCommand,
    permissions: RetentionCompletionPermissions,
  ): Promise<RetentionCompletionSnapshot>;
}

export type RetentionCompletionErrorCode =
  | "invalid_input"
  | "not_found_or_not_authorized"
  | "not_activated"
  | "stale_version"
  | "state_conflict"
  | "idempotency_conflict"
  | "maker_checker_conflict"
  | "capacity_exceeded"
  | "persistence_unavailable";

export class RetentionCompletionError extends Error {
  constructor(
    readonly code: RetentionCompletionErrorCode,
    message: string,
    readonly snapshot?: RetentionCompletionSnapshot,
  ) {
    super(message);
    this.name = "RetentionCompletionError";
  }
}

export type RetentionCompletionWorkflow = typeof RETENTION_COMPLETION_WORKFLOW;
