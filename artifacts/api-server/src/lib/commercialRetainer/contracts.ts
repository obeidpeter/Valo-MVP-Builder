export const COMMERCIAL_RETAINER_MODULE_VERSION = "valo.commercial-retainer@v1";
export const COMMERCIAL_RETAINER_PRICE_BOOK_NAME =
  "valo-fixed-commercial-catalogue";
export const COMMERCIAL_RETAINER_PRICE_BOOK_VERSION = 1;
export const RETAINER_TASK_PREFIX = "[RETAINER-DESK:v1:";
export const RETAINER_ENVELOPE_SCHEMA = "valo.retainer-service-request@v1";

export const COMMERCIAL_RETAINER_BOUNDS = Object.freeze({
  listRows: 50,
  text: 1_000,
  textBytes: 4_000,
  reference: 160,
  comments: 20,
  evidenceReceipts: 10,
  history: 50,
  serviceUnits: 100,
  moneyMinor: 1_000_000_000_000_000,
  quoteValidityDays: 90,
  servicePeriodDays: 366,
});

export const COMMERCIAL_RETAINER_MANIFEST = Object.freeze({
  moduleVersion: COMMERCIAL_RETAINER_MODULE_VERSION,
  routeMounted: true,
  navigationMounted: true,
  openApiPublished: true,
  fixedCatalogueOnly: true,
  approvedPriceBookSeedRequired: true,
  automaticPricingAllowed: false,
  paymentProviderConnected: false,
  externalMessagingConnected: false,
  autonomousWorkAllowed: false,
  manualPaymentEvidenceOnly: true,
  makerCheckerRequired: true,
  directMembershipRequired: true,
  privateNoStoreRequired: true,
});

export type CommercialOfferVersion =
  | "bid_autopsy@1"
  | "assisted_bid@1"
  | "evidence_readiness_retainer@1";

export interface CommercialOffer {
  versionId: CommercialOfferVersion;
  sku: "bid_autopsy" | "assisted_bid" | "evidence_readiness_retainer";
  title: string;
  summary: string;
  cadence: "one_off" | "manual_monthly";
  fixedScope: readonly string[];
  excludedActions: readonly string[];
  humanQuoteRequired: true;
}

export const COMMERCIAL_OFFERS: readonly CommercialOffer[] = Object.freeze([
  Object.freeze({
    versionId: "bid_autopsy@1" as const,
    sku: "bid_autopsy" as const,
    title: "Bid Autopsy",
    summary: "A bounded, human-reviewed bid defect and improvement engagement.",
    cadence: "one_off" as const,
    fixedScope: Object.freeze([
      "Reviewed defect register",
      "Evidence-linked findings",
      "Human-approved improvement brief",
    ]),
    excludedActions: Object.freeze([
      "Tender submission",
      "Award prediction",
      "External client messaging",
    ]),
    humanQuoteRequired: true as const,
  }),
  Object.freeze({
    versionId: "assisted_bid@1" as const,
    sku: "assisted_bid" as const,
    title: "Assisted Bid",
    summary:
      "A governed requirement, evidence, review and readiness workspace.",
    cadence: "one_off" as const,
    fixedScope: Object.freeze([
      "Requirement and evidence workspace",
      "Named review checkpoints",
      "Submission-readiness checks",
    ]),
    excludedActions: Object.freeze([
      "Autonomous release",
      "Automatic pricing",
      "Portal submission",
    ]),
    humanQuoteRequired: true as const,
  }),
  Object.freeze({
    versionId: "evidence_readiness_retainer@1" as const,
    sku: "evidence_readiness_retainer" as const,
    title: "Evidence Readiness Retainer",
    summary: "A recurring, human-governed evidence readiness service desk.",
    cadence: "manual_monthly" as const,
    fixedScope: Object.freeze([
      "Evidence readiness requests",
      "Named owners and SLA receipts",
      "Bounded evidence and completion history",
    ]),
    excludedActions: Object.freeze([
      "Automatic renewal",
      "Automatic payment collection",
      "External messaging or autonomous work",
    ]),
    humanQuoteRequired: true as const,
  }),
]);

export interface CommercialScope {
  organisationId: string;
  actorUserId: string;
  actorMembershipId: string;
}

export interface QuoteTerms {
  projectId: string | null;
  customerReference: string;
  offerVersionId: CommercialOfferVersion;
  scopeSummary: string;
  currency: string;
  amountMinor: number;
  validUntil: string;
  serviceStartsOn: string;
  serviceEndsOn: string;
  serviceUnits: number;
  idempotencyDigest: string;
}

export interface QuoteProposal {
  id: string;
  organisationId: string;
  projectId: string | null;
  offerVersionId: CommercialOfferVersion;
  customerReference: string;
  scopeSummary: string;
  currency: string;
  amountMinor: number;
  validUntil: string;
  serviceStartsOn: string;
  serviceEndsOn: string;
  serviceUnits: number;
  status: "pending_checker" | "approved" | "invoiced" | "paid";
  createdByUserId: string;
  approvedByUserId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ManualInvoiceTerms {
  orderId: string;
  expectedOrderVersion: number;
  invoiceNumber: string;
  netAmountMinor: number;
  vatRateBasisPoints: number;
  vatAmountMinor: number;
  grossAmountMinor: number;
  whtRateBasisPoints: number | null;
  whtAmountMinor: number | null;
  netPayableMinor: number;
  taxRuleId: string;
  taxPointAt: string;
  dueAt: string | null;
}

export interface CommercialInvoice {
  id: string;
  orderId: string;
  invoiceNumber: string;
  currency: string;
  netAmountMinor: number;
  vatAmountMinor: number;
  grossAmountMinor: number;
  whtAmountMinor: number | null;
  netPayableMinor: number;
  status: "issued_manual" | "paid_manual";
  version: number;
  createdAt: string;
}

export interface ManualPaymentEvidence {
  invoiceId: string;
  expectedInvoiceVersion: number;
  evidenceReference: string;
  evidenceSha256: string;
  amountMinor: number;
  currency: string;
  settledAt: string;
  idempotencyDigest: string;
}

export interface CommercialPayment {
  id: string;
  invoiceId: string;
  amountMinor: number;
  currency: string;
  status: "evidence_recorded" | "settled";
  reconciliationStatus: "pending_checker" | "verified_manual";
  evidenceSha256: string;
  recordedByUserId: string;
  verifiedByUserId: string | null;
  settledAt: string;
  version: number;
  createdAt: string;
}

export interface CommercialEntitlement {
  id: string;
  orderId: string;
  subscriptionId: string | null;
  productKind: CommercialOffer["sku"];
  status: "active" | "scheduled";
  paymentState: "verified_manual";
  startsAt: string;
  endsAt: string;
  usageLimit: number;
  usageConsumed: number;
  rulesVersion: typeof COMMERCIAL_RETAINER_MODULE_VERSION;
  version: number;
}

export type RetainerPurpose =
  | "evidence_review"
  | "renewal_readiness"
  | "bid_evidence_pack";
export type RetainerSla = "standard" | "priority";
export type RetainerStatus =
  | "open"
  | "in_progress"
  | "awaiting_evidence"
  | "completed"
  | "cancelled";

export interface RetainerComment {
  id: string;
  body: string;
  createdByUserId: string;
  createdAt: string;
}

export interface RetainerEvidenceReceipt {
  id: string;
  reference: string;
  sha256: string;
  recordedByUserId: string;
  recordedAt: string;
}

export interface RetainerHistoryEntry {
  action:
    | "created"
    | "commented"
    | "evidence_recorded"
    | "status_changed"
    | "reassigned";
  actorUserId: string;
  at: string;
  from?: string;
  to?: string;
}

export interface RetainerServiceRequest {
  id: string;
  organisationId: string;
  projectId: string;
  entitlementId: string;
  purpose: RetainerPurpose;
  summary: string;
  ownerMembershipId: string;
  sla: RetainerSla;
  slaPolicyVersion: "valo.retainer-sla@v1";
  dueAt: string;
  status: RetainerStatus;
  comments: readonly RetainerComment[];
  evidenceReceipts: readonly RetainerEvidenceReceipt[];
  history: readonly RetainerHistoryEntry[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateRetainerRequest {
  projectId: string;
  entitlementId: string;
  purpose: RetainerPurpose;
  summary: string;
  ownerMembershipId: string;
  sla: RetainerSla;
  idempotencyDigest: string;
}

export type RetainerRequestAction =
  | { action: "comment"; expectedVersion: number; body: string }
  | {
      action: "record_evidence";
      expectedVersion: number;
      reference: string;
      sha256: string;
    }
  | {
      action: "set_status";
      expectedVersion: number;
      status: Exclude<RetainerStatus, "open">;
    }
  | {
      action: "reassign";
      expectedVersion: number;
      ownerMembershipId: string;
    };

export interface CommercialSnapshot {
  organisationId: string;
  manifest: typeof COMMERCIAL_RETAINER_MANIFEST;
  activation: {
    fixedPriceBookReady: boolean;
    providerConnected: false;
    manualReconciliationReady: boolean;
    retainerDeskReady: boolean;
  };
  offers: readonly (CommercialOffer & { orderable: boolean })[];
  quotes: readonly QuoteProposal[];
  invoices: readonly CommercialInvoice[];
  payments: readonly CommercialPayment[];
  entitlements: readonly CommercialEntitlement[];
  serviceRequests: readonly RetainerServiceRequest[];
}

export type CommercialMutationResult<T> =
  | { outcome: "updated"; record: T }
  | {
      outcome:
        | "not_found"
        | "version_conflict"
        | "state_conflict"
        | "policy_denied"
        | "capacity_exceeded";
    };

export type CommercialRetainerErrorCode =
  | "invalid_scope"
  | "invalid_input"
  | "not_found_or_not_authorized"
  | "catalogue_not_seeded"
  | "self_approval_denied"
  | "version_conflict"
  | "state_conflict"
  | "capacity_exceeded"
  | "persistence_unavailable";

export class CommercialRetainerError extends Error {
  constructor(readonly code: CommercialRetainerErrorCode) {
    super(code);
    this.name = "CommercialRetainerError";
  }
}

export interface CommercialRetainerRepository {
  readSnapshot(
    scope: CommercialScope,
    projectId?: string,
  ): Promise<CommercialSnapshot>;
  createQuote(
    scope: CommercialScope,
    terms: QuoteTerms,
  ): Promise<QuoteProposal>;
  approveQuote(
    scope: CommercialScope,
    orderId: string,
    expectedVersion: number,
  ): Promise<CommercialMutationResult<QuoteProposal>>;
  createInvoice(
    scope: CommercialScope,
    terms: ManualInvoiceTerms,
  ): Promise<CommercialMutationResult<CommercialInvoice>>;
  recordPayment(
    scope: CommercialScope,
    evidence: ManualPaymentEvidence,
  ): Promise<CommercialMutationResult<CommercialPayment>>;
  verifyPayment(
    scope: CommercialScope,
    paymentId: string,
    expectedPaymentVersion: number,
    expectedInvoiceVersion: number,
  ): Promise<
    CommercialMutationResult<{
      payment: CommercialPayment;
      entitlement: CommercialEntitlement;
    }>
  >;
  createRetainerRequest(
    scope: CommercialScope,
    command: CreateRetainerRequest,
  ): Promise<CommercialMutationResult<RetainerServiceRequest>>;
  mutateRetainerRequest(
    scope: CommercialScope,
    requestId: string,
    action: RetainerRequestAction,
  ): Promise<CommercialMutationResult<RetainerServiceRequest>>;
}
