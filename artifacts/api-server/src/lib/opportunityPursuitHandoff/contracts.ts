import type { OpportunitySourceCandidate } from "../opportunitySourceNetwork";

export const OPPORTUNITY_PURSUIT_HANDOFF_SCHEMA =
  "valo.opportunity-pursuit-handoff/v1" as const;

export const OPPORTUNITY_PURSUIT_HANDOFF_BOUNDS = Object.freeze({
  choices: 100,
  conflicts: 100,
  receipts: 250,
  maxTextCodeUnits: 512,
  maxNoteCodeUnits: 1_024,
  maxEventCodeUnits: 12_000,
  maxEventBytes: 24_000,
  maxEventSetBytes: 2_000_000,
  requestBodyBytes: 16_384,
});

export const OPPORTUNITY_PURSUIT_HANDOFF_AUTHORITY = Object.freeze({
  sourceReopenRequired: true,
  namedHumanConfirmationRequired: true,
  makerCheckerRequired: true,
  conflictRevalidationRequired: true,
  createdPursuitState: "intake" as const,
  pursuitActivated: false,
  providerFetchPerformed: false,
  autonomousPursuitActivationAllowed: false,
});

export interface OpportunityPursuitHandoffScope {
  organisationId: string;
  actorUserId: string;
  actorName: string;
  actorMembershipId: string;
}

export interface OpportunityPursuitClientChoice {
  id: string;
  name: string;
  version: number;
}

export interface OpportunityPursuitReviewerChoice {
  userId: string;
  name: string;
}

export interface OpportunityPursuitLotChoice {
  id: string;
  reference: string;
  title: string | null;
  submissionDeadline: string | null;
  version: number;
}

export interface OpportunityPursuitConflictMatch {
  projectId: string;
  lot: string | null;
  status: string;
  version: number;
}

export interface OpportunityPursuitSourceSnapshot {
  candidateId: string;
  candidateVersion: number;
  sourceReceiptSha256: string;
  sourceLocator: string;
  sourceLocatorSha256: string;
  tenderId: string;
  tenderVersion: number;
  title: string;
  buyer: string;
  reference: string;
  submissionDeadline: string | null;
  recordedByName: string;
  confirmedByName: string;
}

export interface OpportunityPursuitHandoffReceipt {
  schema: typeof OPPORTUNITY_PURSUIT_HANDOFF_SCHEMA;
  organisationId: string;
  candidateId: string;
  projectId: string;
  clientId: string;
  clientVersion: number;
  tenderId: string;
  tenderLotId: string | null;
  tenderLotVersion: number | null;
  confirmedLotReference: string | null;
  reviewerUserId: string;
  sourceReceiptSha256: string;
  sourceLocatorSha256: string;
  confirmedBuyer: string;
  confirmedReference: string;
  confirmedSubmissionDeadline: string | null;
  confirmationNote: string;
  confirmedByUserId: string;
  confirmedByName: string;
  confirmedAt: string;
  conflictBoundarySha256: string;
  conflictStatus: "clear";
  matchedProjectId: null;
  projectStatus: "intake";
  idempotencyKeySha256: string;
  requestSha256: string;
  receiptSha256: string;
}

export interface ReadyOpportunityPursuitHandoff {
  state: "ready";
  source: OpportunityPursuitSourceSnapshot;
  clients: readonly OpportunityPursuitClientChoice[];
  reviewers: readonly OpportunityPursuitReviewerChoice[];
  lots: readonly OpportunityPursuitLotChoice[];
  conflictBoundary: {
    sha256: string;
    matches: readonly OpportunityPursuitConflictMatch[];
    limit: 100;
    truncated: false;
  };
  authority: typeof OPPORTUNITY_PURSUIT_HANDOFF_AUTHORITY;
}

export interface CompletedOpportunityPursuitHandoff {
  state: "completed";
  receipt: OpportunityPursuitHandoffReceipt;
  authority: typeof OPPORTUNITY_PURSUIT_HANDOFF_AUTHORITY;
}

export type OpportunityPursuitHandoffPreparation =
  | ReadyOpportunityPursuitHandoff
  | CompletedOpportunityPursuitHandoff;

export interface OpportunityPursuitHandoffDraft {
  expectedCandidateVersion: number;
  expectedSourceReceiptSha256: string;
  expectedTenderVersion: number;
  expectedConflictBoundarySha256: string;
  clientId: string;
  expectedClientVersion: number;
  tenderLotId: string | null;
  expectedTenderLotVersion: number | null;
  confirmedLotReference: string | null;
  reviewerUserId: string;
  officialSourceReopened: true;
  confirmedBuyer: string;
  confirmedReference: string;
  confirmedSubmissionDeadline: string | null;
  confirmationNote: string;
}

export interface NormalizedOpportunityPursuitHandoffDraft extends OpportunityPursuitHandoffDraft {
  idempotencyKeySha256: string;
  requestSha256: string;
}

export interface OpportunityPursuitHandoffResult {
  outcome: "created" | "replayed";
  receipt: OpportunityPursuitHandoffReceipt;
  authority: typeof OPPORTUNITY_PURSUIT_HANDOFF_AUTHORITY;
}

export interface OpportunityPursuitHandoffRepository {
  prepare(
    scope: OpportunityPursuitHandoffScope,
    candidateId: string,
  ): Promise<OpportunityPursuitHandoffPreparation>;
  confirm(
    scope: OpportunityPursuitHandoffScope,
    candidateId: string,
    draft: NormalizedOpportunityPursuitHandoffDraft,
  ): Promise<OpportunityPursuitHandoffResult>;
}

export type OpportunityPursuitHandoffErrorCode =
  | "invalid_request"
  | "scope_denied"
  | "not_found"
  | "conflict"
  | "capacity_exceeded"
  | "source_unavailable"
  | "persisted_state_invalid";

export class OpportunityPursuitHandoffError extends Error {
  constructor(
    readonly code: OpportunityPursuitHandoffErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "OpportunityPursuitHandoffError";
  }
}

export type AcceptedOpportunitySourceCandidate = OpportunitySourceCandidate & {
  status: "accepted";
  tenderId: string;
  reviewedByUserId: string;
  reviewedByName: string;
  reviewedAt: string;
};
