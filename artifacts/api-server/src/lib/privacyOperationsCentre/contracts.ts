export const PRIVACY_OPERATIONS_MAX_ITEMS = 50;
export const PRIVACY_OPERATIONS_DEFAULT_ITEMS = 25;
export const PRIVACY_OPERATIONS_MAX_ASSIGNEES = 100;

export interface PrivacyOperationsAssignee {
  userId: string;
  name: string;
}
export const PRIVACY_OPERATIONS_AUDIT_SCHEMA =
  "valo.privacy-operations-audit/v1" as const;

export type PrivacyReviewPosture =
  | "current"
  | "due_soon"
  | "overdue"
  | "missing_review_date";

export type PrivacyEvidenceState = "verified" | "missing" | "invalid";

export interface PrivacyOperationsScope {
  organisationId: string;
  actorUserId: string;
}

export interface PrivacyOperationsTotals {
  dataSubjectRequests: number;
  consentRecords: number;
  legalHolds: number;
  subprocessors: number;
  crossBorderTransfers: number;
  deletionActions: number;
}

export interface PrivacyDsrRow {
  organisationId: string;
  id: string;
  requestType: string;
  identityVerificationStatus: string;
  receivedAt: Date;
  dueAt: Date;
  status: string;
  assignedToUserId: string | null;
  responseEvidencePresent: boolean;
  responseEvidenceSha256: string | null;
  completedAt: Date | null;
  version: number;
  updatedAt: Date;
}

export interface PrivacyConsentRow {
  organisationId: string;
  id: string;
  privacyRecordId: string | null;
  capturedAt: Date;
  withdrawnAt: Date | null;
  evidenceHash: string;
  version: number;
  updatedAt: Date;
}

export interface PrivacyLegalHoldRow {
  organisationId: string;
  id: string;
  projectId: string | null;
  status: string;
  placedByUserId: string;
  releasedByUserId: string | null;
  releasedAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface PrivacySubprocessorRow {
  organisationId: string;
  id: string;
  legalName: string;
  service: string;
  countryCode: string;
  dpaStatus: string;
  securityReviewStatus: string;
  approvedAt: Date | null;
  nextReviewAt: Date | null;
  version: number;
  updatedAt: Date;
}

export interface PrivacyTransferRow {
  organisationId: string;
  id: string;
  subprocessorId: string | null;
  originCountry: string;
  destinationCountry: string;
  transferBasis: string;
  approvalEvidencePresent: boolean;
  approvalEvidenceSha256: string | null;
  legalReviewStatus: string;
  nextReviewAt: Date;
  version: number;
  updatedAt: Date;
}

export interface PrivacyDeletionRow {
  organisationId: string;
  id: string;
  status: string;
  legalHoldId: string | null;
  executedByUserId: string | null;
  executedAt: Date | null;
  version: number;
  updatedAt: Date;
  certificates: readonly {
    scopeManifestHash: string;
    completedAt: Date;
    signedByUserId: string;
    signatureEvidencePresent: boolean;
  }[];
}

export interface PrivacyAuditRow {
  organisationId: string;
  objectId: string | null;
  eventType: string;
  details: string | null;
  seq: number;
  hash: string;
  createdAt: Date;
}

export interface PrivacyOperationsRawDashboard {
  totals: PrivacyOperationsTotals;
  dataSubjectRequests: readonly PrivacyDsrRow[];
  consentRecords: readonly PrivacyConsentRow[];
  legalHolds: readonly PrivacyLegalHoldRow[];
  subprocessors: readonly PrivacySubprocessorRow[];
  crossBorderTransfers: readonly PrivacyTransferRow[];
  deletionActions: readonly PrivacyDeletionRow[];
  auditRows: readonly PrivacyAuditRow[];
}

export interface PrivacyDsrItem {
  id: string;
  requestType: string;
  identityVerificationStatus: string;
  receivedAt: string;
  dueAt: string;
  status: string;
  assignedToUserId: string | null;
  responseEvidenceState: PrivacyEvidenceState;
  completedAt: string | null;
  urgency: "completed" | "overdue" | "due_soon" | "on_track";
  version: number;
  updatedAt: string;
}

export interface PrivacyConsentItem {
  id: string;
  privacyRecordId: string | null;
  capturedAt: string;
  withdrawnAt: string | null;
  state: "active" | "withdrawn";
  captureEvidenceState: PrivacyEvidenceState;
  withdrawalReceiptState: PrivacyEvidenceState;
  withdrawalEvidenceSha256: string | null;
  withdrawnByUserId: string | null;
  version: number;
  updatedAt: string;
}

export interface PrivacyLegalHoldItem {
  id: string;
  projectId: string | null;
  status: string;
  placedByUserId: string;
  releasedByUserId: string | null;
  releasedAt: string | null;
  lastReviewOutcome: PrivacyHoldReviewOutcome | null;
  lastReviewedAt: string | null;
  lastReviewedByUserId: string | null;
  nextReviewAt: string | null;
  reviewEvidenceSha256: string | null;
  reviewPosture: PrivacyReviewPosture | "released";
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface PrivacySubprocessorItem {
  id: string;
  legalName: string;
  service: string;
  countryCode: string;
  dpaStatus: string;
  securityReviewStatus: string;
  approvedAt: string | null;
  nextReviewAt: string | null;
  reviewPosture: PrivacyReviewPosture;
  version: number;
  updatedAt: string;
}

export interface PrivacyTransferItem {
  id: string;
  subprocessorId: string | null;
  originCountry: string;
  destinationCountry: string;
  transferBasis: string;
  approvalEvidenceState: PrivacyEvidenceState;
  legalReviewStatus: string;
  nextReviewAt: string;
  reviewPosture: PrivacyReviewPosture;
  version: number;
  updatedAt: string;
}

export interface PrivacyDeletionItem {
  id: string;
  status: string;
  held: boolean;
  executedByUserId: string | null;
  executedAt: string | null;
  receiptState: "pending" | "recorded" | "missing" | "invalid";
  scopeManifestSha256: string | null;
  signedByUserId: string | null;
  completedAt: string | null;
  version: number;
  updatedAt: string;
}

export interface PrivacyOperationsDashboard {
  generatedAt: string;
  organisationId: string;
  boundedTo: number;
  legalDecisionAutomated: false;
  rawSubjectPiiIncluded: false;
  authorityNote: string;
  totals: PrivacyOperationsTotals;
  truncated: {
    dataSubjectRequests: boolean;
    consentRecords: boolean;
    legalHolds: boolean;
    subprocessors: boolean;
    crossBorderTransfers: boolean;
    deletionActions: boolean;
  };
  dataSubjectRequests: readonly PrivacyDsrItem[];
  consentRecords: readonly PrivacyConsentItem[];
  legalHolds: readonly PrivacyLegalHoldItem[];
  subprocessors: readonly PrivacySubprocessorItem[];
  crossBorderTransfers: readonly PrivacyTransferItem[];
  deletionActions: readonly PrivacyDeletionItem[];
  blockers: readonly string[];
}

export const PRIVACY_DSR_STATUSES = [
  "received",
  "triaged",
  "in_progress",
  "awaiting_identity",
  "on_hold",
] as const;
export type PrivacyDsrStatus = (typeof PRIVACY_DSR_STATUSES)[number];

export const PRIVACY_IDENTITY_STATUSES = [
  "pending",
  "verified",
  "failed",
] as const;
export type PrivacyIdentityStatus = (typeof PRIVACY_IDENTITY_STATUSES)[number];

export const PRIVACY_DSR_REASON_CODES = [
  "initial_triage",
  "identity_pending",
  "scope_confirmation",
  "complexity_review",
  "deadline_risk",
  "other_review_required",
] as const;
export type PrivacyDsrReasonCode = (typeof PRIVACY_DSR_REASON_CODES)[number];

export interface PrivacyDsrTriageDraft {
  status: PrivacyDsrStatus;
  identityVerificationStatus: PrivacyIdentityStatus;
  assignedToUserId: string;
  reasonCode: PrivacyDsrReasonCode;
  decisionEvidenceSha256: string;
}

export interface PrivacyConsentWithdrawalDraft {
  withdrawnAt: string;
  evidenceSha256: string;
}

export const PRIVACY_HOLD_REVIEW_OUTCOMES = [
  "continue",
  "escalate_for_legal_review",
  "release_recommended",
] as const;
export type PrivacyHoldReviewOutcome =
  (typeof PRIVACY_HOLD_REVIEW_OUTCOMES)[number];

export interface PrivacyHoldReviewDraft {
  reviewOutcome: PrivacyHoldReviewOutcome;
  nextReviewAt: string;
  evidenceSha256: string;
}

export interface PrivacyWorkflowReceipt {
  receiptSha256: string;
  eventType:
    | "privacy.dsr_triage_recorded"
    | "privacy.consent_withdrawal_recorded"
    | "privacy.legal_hold_review_recorded";
  objectId: string;
  actorUserId: string;
  recordedAt: string;
  resultingVersion: number;
  legalDecisionAutomated: false;
}

export type PrivacyMutationOutcome =
  | {
      outcome: "updated";
      resultingVersion: number;
      receipt: PrivacyWorkflowReceipt;
    }
  | {
      outcome:
        | "not_found"
        | "version_conflict"
        | "state_conflict"
        | "assignee_unavailable";
    };

export interface PrivacyDsrTriageCommand extends PrivacyDsrTriageDraft {
  id: string;
  expectedVersion: number;
  recordedAt: string;
}

export interface PrivacyConsentWithdrawalCommand extends PrivacyConsentWithdrawalDraft {
  id: string;
  expectedVersion: number;
  recordedAt: string;
}

export interface PrivacyHoldReviewCommand extends PrivacyHoldReviewDraft {
  id: string;
  expectedVersion: number;
  recordedAt: string;
}

export interface PrivacyOperationsRepository {
  listAssignees(
    scope: PrivacyOperationsScope,
    limit: number,
  ): Promise<readonly PrivacyOperationsAssignee[]>;
  readDashboard(
    scope: PrivacyOperationsScope,
    limit: number,
  ): Promise<PrivacyOperationsRawDashboard>;
  triageDataSubjectRequest(
    scope: PrivacyOperationsScope,
    command: PrivacyDsrTriageCommand,
  ): Promise<PrivacyMutationOutcome>;
  recordConsentWithdrawal(
    scope: PrivacyOperationsScope,
    command: PrivacyConsentWithdrawalCommand,
  ): Promise<PrivacyMutationOutcome>;
  recordLegalHoldReview(
    scope: PrivacyOperationsScope,
    command: PrivacyHoldReviewCommand,
  ): Promise<PrivacyMutationOutcome>;
}

export class PrivacyOperationsRepositoryUnavailableError extends Error {
  readonly name = "PrivacyOperationsRepositoryUnavailableError";

  constructor(message = "Privacy operations repository is unavailable") {
    super(message);
  }
}

export const unavailablePrivacyOperationsRepository: PrivacyOperationsRepository =
  {
    listAssignees: async () => {
      throw new PrivacyOperationsRepositoryUnavailableError();
    },
    readDashboard: async () => {
      throw new PrivacyOperationsRepositoryUnavailableError();
    },
    triageDataSubjectRequest: async () => {
      throw new PrivacyOperationsRepositoryUnavailableError();
    },
    recordConsentWithdrawal: async () => {
      throw new PrivacyOperationsRepositoryUnavailableError();
    },
    recordLegalHoldReview: async () => {
      throw new PrivacyOperationsRepositoryUnavailableError();
    },
  };
