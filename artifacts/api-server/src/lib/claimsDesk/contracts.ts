export const CLAIMS_DESK_NAMESPACE = "[CLAIMS-DESK:" as const;
export const CLAIMS_DESK_LEDGER_SCHEMA = "valo.claims-desk-ledger/v1" as const;
export const CLAIMS_DESK_READ_PERMISSION = "project:read" as const;
export const CLAIMS_DESK_MANAGE_PERMISSION = "project:update" as const;

export const CLAIMS_DESK_BOUNDS = Object.freeze({
  eventsPerProject: 500,
  eventsPerRecord: 100,
  recordsPerProject: 250,
  documentsPerEvent: 10,
  envelopeCodeUnits: 32_768,
  envelopeBytes: 65_536,
  snapshotBytes: 4_194_304,
  referenceCharacters: 80,
  idempotencyKeyCharacters: 128,
});

export const CLAIMS_DESK_RECORD_TYPES = [
  "contract_event",
  "notice_deadline",
  "variation",
  "claim",
  "payment_certificate",
  "obligation",
] as const;
export type ClaimsDeskRecordType = (typeof CLAIMS_DESK_RECORD_TYPES)[number];

export const CLAIMS_DESK_STATUSES = [
  "registered",
  "under_review",
  "assessment_proposed",
  "assessed",
  "closure_proposed",
  "closed",
  "withdrawn",
] as const;
export type ClaimsDeskStatus = (typeof CLAIMS_DESK_STATUSES)[number];

export const CLAIMS_DESK_ACTIONS = [
  "start_review",
  "propose_assessment",
  "approve_assessment",
  "return_assessment",
  "propose_closure",
  "approve_closure",
  "return_closure",
  "withdraw",
] as const;
export type ClaimsDeskAction = (typeof CLAIMS_DESK_ACTIONS)[number];

export const CLAIMS_DESK_REASON_CODES = [
  "evidence_received",
  "deadline_review",
  "assessment_ready",
  "assessment_checked",
  "assessment_returned",
  "closure_ready",
  "closure_checked",
  "closure_returned",
  "duplicate_record",
  "superseded_record",
  "other_human_review",
] as const;
export type ClaimsDeskReasonCode = (typeof CLAIMS_DESK_REASON_CODES)[number];

export const CLAIMS_DESK_ASSESSMENT_CODES = [
  "requires_further_review",
  "commercial_position_recorded",
  "not_progressed",
] as const;
export type ClaimsDeskAssessmentCode =
  (typeof CLAIMS_DESK_ASSESSMENT_CODES)[number];

export interface ClaimsDeskScope {
  organisationId: string;
  projectId: string;
  actorUserId: string;
  actorMembershipId: string;
}

export interface ClaimsDeskDocumentBinding {
  documentId: string;
  sha256: string;
}

export interface ClaimsDeskCreateDraft {
  recordType: ClaimsDeskRecordType;
  reference: string;
  eventDate: string;
  dueAt: string | null;
  amountMinor: number | null;
  currency: string | null;
  documentBindings: readonly ClaimsDeskDocumentBinding[];
  idempotencyKey: string;
}

export interface ClaimsDeskTransitionDraft {
  action: ClaimsDeskAction;
  reasonCode: ClaimsDeskReasonCode;
  assessmentCode: ClaimsDeskAssessmentCode | null;
  documentBindings: readonly ClaimsDeskDocumentBinding[];
  idempotencyKey: string;
}

export interface ClaimsDeskReasonHistoryEntry {
  action: ClaimsDeskAction;
  reasonCode: ClaimsDeskReasonCode;
  assessmentCode: ClaimsDeskAssessmentCode | null;
  fromStatus: ClaimsDeskStatus;
  toStatus: ClaimsDeskStatus;
  actorUserId: string;
  occurredAt: string;
  receiptSha256: string;
}

export interface ClaimsDeskRecord {
  id: string;
  organisationId: string;
  projectId: string;
  recordType: ClaimsDeskRecordType;
  reference: string;
  eventDate: string;
  dueAt: string | null;
  amountMinor: number | null;
  currency: string | null;
  documentBindings: readonly ClaimsDeskDocumentBinding[];
  status: ClaimsDeskStatus;
  assessmentCode: ClaimsDeskAssessmentCode | null;
  pendingMakerUserId: string | null;
  version: number;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
  latestReceiptSha256: string;
  reasonHistory: readonly ClaimsDeskReasonHistoryEntry[];
}

export interface ClaimsDeskPosture {
  total: number;
  open: number;
  overdue: number;
  dueSoon: number;
  awaitingChecker: number;
  terminal: number;
}

export interface ClaimsDeskSnapshot {
  organisationId: string;
  projectId: string;
  projectStatus: string;
  records: readonly ClaimsDeskRecord[];
  posture: ClaimsDeskPosture;
  truncated: false;
  generatedAt: string;
  legalConclusionAutomated: false;
  noticeDispatched: false;
  paymentMutated: false;
  authorityNote: string;
}

export type ClaimsDeskMutationOutcome =
  | { outcome: "created"; record: ClaimsDeskRecord; replayed: boolean }
  | { outcome: "updated"; record: ClaimsDeskRecord; replayed: boolean }
  | {
      outcome:
        | "not_found"
        | "version_conflict"
        | "state_conflict"
        | "maker_checker_conflict"
        | "idempotency_conflict"
        | "evidence_conflict"
        | "archived"
        | "capacity_exceeded";
    };

export interface ClaimsDeskRepository {
  readSnapshot(scope: ClaimsDeskScope, now: Date): Promise<ClaimsDeskSnapshot>;
  createRecord(
    scope: ClaimsDeskScope,
    draft: ClaimsDeskCreateDraft,
    now: Date,
  ): Promise<ClaimsDeskMutationOutcome>;
  transitionRecord(
    scope: ClaimsDeskScope,
    recordId: string,
    expectedVersion: number,
    draft: ClaimsDeskTransitionDraft,
    now: Date,
  ): Promise<ClaimsDeskMutationOutcome>;
}

export class ClaimsDeskRepositoryUnavailableError extends Error {
  constructor(message = "Claims Desk persistence is unavailable") {
    super(message);
    this.name = "ClaimsDeskRepositoryUnavailableError";
  }
}

export class ClaimsDeskProjectAccessError extends Error {
  constructor(public readonly code: "not_found" | "archived") {
    super(code);
    this.name = "ClaimsDeskProjectAccessError";
  }
}
