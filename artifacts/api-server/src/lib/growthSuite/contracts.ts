export const GROWTH_SUITE_BOUNDS = Object.freeze({
  maxListRows: 50,
  maxIdCodeUnits: 128,
  maxLabelCodeUnits: 160,
  maxSummaryCodeUnits: 1_000,
  maxSummaryBytes: 4_000,
  maxMoneyMinor: 1_000_000_000_000_000,
  maxSlaDays: 366,
  maxQuoteValidityDays: 90,
});

export type LeadInboxStatus =
  | "new"
  | "qualified"
  | "not_a_fit"
  | "converted"
  | "conversion_proposed";

export type LeadInboxMutation =
  | {
      action: "assign";
      expectedVersion: number;
      assigneeUserId: string;
    }
  | {
      action: "set_status";
      expectedVersion: number;
      status: "qualified" | "not_a_fit";
      reason: string;
    }
  | {
      action: "set_status";
      expectedVersion: number;
      status: "converted";
      reason: string;
      externalTargetReference: string;
      receiptSha256: string;
    }
  | {
      action: "set_sla";
      expectedVersion: number;
      slaDueAt: string;
    }
  | {
      action: "propose_conversion";
      expectedVersion: number;
      suggestedPursuitTitle: string;
      rationale: string;
    };

export interface LeadConversionProposal {
  id: string;
  status: "pending_human_decision";
  proposedAt: string;
  proposedByUserId: string;
  suggestedPursuitTitle: string;
  rationale: string;
}

export interface LeadStatusDecision {
  status: "qualified" | "not_a_fit" | "converted";
  reason: string;
  decidedAt: string;
  decidedByUserId: string;
  externalTargetReference: string | null;
  receiptSha256: string | null;
}

export type LeadContactHandoffPurpose =
  | "initial_follow_up"
  | "qualification_call"
  | "conversion_handoff";

export interface LeadContactHandoff {
  leadId: string;
  contactName: string;
  preferredContactMethod: "email" | "telephone";
  contactValue: string;
  purpose: LeadContactHandoffPurpose;
  accessedAt: string;
  version: number;
}

/**
 * Deliberately excludes a person's name, email address and telephone number.
 * A lead inbox coordinates work; it is not a CRM or a contact channel.
 */
export interface LeadInboxItem {
  id: string;
  organisationId: string;
  leadReference: string;
  organisationLabel: string;
  tenderCategory: string;
  bidStage: string;
  receivedAt: string;
  tenderDeadline: string | null;
  assignedToUserId: string | null;
  status: LeadInboxStatus;
  slaDueAt: string | null;
  conversionProposal: LeadConversionProposal | null;
  latestStatusDecision: LeadStatusDecision | null;
  version: number;
  updatedAt: string;
}

export interface OfferCatalogueItem {
  sku: "bid_autopsy" | "assisted_bid" | "evidence_readiness_retainer";
  versionId: string;
  revision: number;
  title: string;
  summary: string;
  includedOutcomes: readonly string[];
  excludedActions: readonly string[];
  pricingMode: "human_quote_required";
  paymentMode: "external_manual_only";
  status: "active";
}

export type QuoteStatus = "draft" | "approved";

export interface QuoteProposal {
  id: string;
  organisationId: string;
  customerReference: string;
  offerVersionId: string;
  scopeSummary: string;
  currency: string;
  amountMinor: number;
  validUntil: string;
  status: QuoteStatus;
  createdByUserId: string;
  approvedByUserId: string | null;
  approvedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateQuoteDraft {
  customerReference: string;
  offerVersionId: string;
  scopeSummary: string;
  currency: string;
  /** A named operator enters this amount. No code path derives it. */
  amountMinor: number;
  validUntil: string;
}

export interface GrowthSuiteScope {
  organisationId: string;
  actorUserId: string;
}

export type GrowthSuiteMutationResult<T> =
  | { outcome: "updated"; record: T }
  | { outcome: "not_found_or_conflict" }
  | { outcome: "policy_denied" };

export interface GrowthSuiteRepository {
  listLeads(
    scope: GrowthSuiteScope,
    limit: number,
  ): Promise<readonly LeadInboxItem[]>;
  mutateLead(
    scope: GrowthSuiteScope,
    leadId: string,
    mutation: LeadInboxMutation,
  ): Promise<GrowthSuiteMutationResult<LeadInboxItem>>;
  getLeadContactHandoff(
    scope: GrowthSuiteScope,
    leadId: string,
    expectedVersion: number,
    purpose: LeadContactHandoffPurpose,
  ): Promise<GrowthSuiteMutationResult<LeadContactHandoff>>;
  listQuotes(
    scope: GrowthSuiteScope,
    limit: number,
  ): Promise<readonly QuoteProposal[]>;
  createQuoteDraft(
    scope: GrowthSuiteScope,
    draft: CreateQuoteDraft,
  ): Promise<QuoteProposal>;
  approveQuote(
    scope: GrowthSuiteScope,
    quoteId: string,
    expectedVersion: number,
  ): Promise<GrowthSuiteMutationResult<QuoteProposal>>;
}

export class GrowthSuiteRepositoryUnavailableError extends Error {
  readonly name = "GrowthSuiteRepositoryUnavailableError";

  constructor() {
    super("Growth suite repository is unavailable");
  }
}

export const unavailableGrowthSuiteRepository: GrowthSuiteRepository = {
  listLeads: async () => {
    throw new GrowthSuiteRepositoryUnavailableError();
  },
  mutateLead: async () => {
    throw new GrowthSuiteRepositoryUnavailableError();
  },
  getLeadContactHandoff: async () => {
    throw new GrowthSuiteRepositoryUnavailableError();
  },
  listQuotes: async () => {
    throw new GrowthSuiteRepositoryUnavailableError();
  },
  createQuoteDraft: async () => {
    throw new GrowthSuiteRepositoryUnavailableError();
  },
  approveQuote: async () => {
    throw new GrowthSuiteRepositoryUnavailableError();
  },
};
