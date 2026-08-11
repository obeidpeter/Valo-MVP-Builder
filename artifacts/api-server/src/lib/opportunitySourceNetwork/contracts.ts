export const OPPORTUNITY_SOURCE_NETWORK_STATUS = Object.freeze({
  runtimeConnected: true,
  externalAcquisitionConnected: false,
  autonomousScrapingAllowed: false,
  autonomousPursuitActivationAllowed: false,
  authority: "named_human_confirmation_required" as const,
});

export const OPPORTUNITY_SOURCE_NETWORK_BOUNDS = Object.freeze({
  candidatesPerOrganisation: 250,
  eventsPerOrganisation: 500,
  maxIdCodeUnits: 128,
  maxTitleCodeUnits: 512,
  maxSummaryCodeUnits: 1_024,
  maxLocatorCodeUnits: 2_048,
  maxEventCodeUnits: 12_000,
  maxEventBytes: 24_000,
  maxEventSetBytes: 2_000_000,
});

export const OPPORTUNITY_SOURCE_KINDS = [
  "manual_url",
  "ocds",
  "licensed_feed",
  "forwarded_notice",
  "csv",
] as const;

export type OpportunitySourceKind = (typeof OPPORTUNITY_SOURCE_KINDS)[number];
export type OpportunitySourceProvenance =
  | "operator_recorded"
  | "adapter_verified";
export type OpportunitySourceStatus =
  | "pending_review"
  | "accepted"
  | "rejected";

export interface OpportunitySourceScope {
  organisationId: string;
  actorUserId: string;
  actorName: string;
}

export interface OpportunitySourceInput {
  sourceKind: OpportunitySourceKind;
  sourceSystem: string;
  sourceAuthority: string;
  sourceLocator: string;
  sourceLicenceReference: string | null;
  externalReference: string;
  title: string;
  procuringEntity: string;
  jurisdiction: string;
  fundingSource: string | null;
  procurementCategory: string | null;
  publishedAt: string | null;
  submissionDeadline: string | null;
  observedAt: string;
  sourceContentSha256: string | null;
}

export interface NormalizedOpportunitySourceInput extends OpportunitySourceInput {
  provenance: OpportunitySourceProvenance;
  sourceLocatorSha256: string;
  receiptSha256: string;
  dedupeKey: string;
}

export interface OpportunitySourceCandidate extends NormalizedOpportunitySourceInput {
  id: string;
  organisationId: string;
  status: OpportunitySourceStatus;
  version: number;
  recordedByUserId: string;
  recordedByName: string;
  reviewedByUserId: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  decisionReason: string | null;
  tenderId: string | null;
}

export interface OpportunitySourceDecision {
  expectedVersion: number;
  decision: "accept" | "reject";
  reason: string;
}

export interface OpportunitySourceListResult {
  items: OpportunitySourceCandidate[];
  limit: number;
  truncated: false;
  authority: typeof OPPORTUNITY_SOURCE_NETWORK_STATUS;
}

export type OpportunitySourceNetworkErrorCode =
  | "invalid_request"
  | "scope_denied"
  | "not_found"
  | "conflict"
  | "capacity_exceeded"
  | "source_unavailable"
  | "persisted_state_invalid";

export class OpportunitySourceNetworkError extends Error {
  constructor(
    readonly code: OpportunitySourceNetworkErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "OpportunitySourceNetworkError";
  }
}

export interface OpportunitySourceRepository {
  list(scope: OpportunitySourceScope): Promise<OpportunitySourceCandidate[]>;
  get(
    scope: OpportunitySourceScope,
    candidateId: string,
  ): Promise<OpportunitySourceCandidate | null>;
  create(
    scope: OpportunitySourceScope,
    input: NormalizedOpportunitySourceInput,
  ): Promise<OpportunitySourceCandidate>;
  decide(
    scope: OpportunitySourceScope,
    candidateId: string,
    decision: OpportunitySourceDecision,
  ): Promise<OpportunitySourceCandidate>;
}

export interface LicensedOpportunityFeedDescriptor {
  kind: "licensed_tender_feed";
  provider: string;
  mode: "production" | "development";
  productionApproved: boolean;
  licenceEvidenceVersion: string | null;
}
