import { randomUUID } from "node:crypto";
import type {
  CreateQuoteDraft,
  GrowthSuiteMutationResult,
  GrowthSuiteRepository,
  GrowthSuiteScope,
  LeadContactHandoff,
  LeadContactHandoffPurpose,
  LeadInboxItem,
  LeadInboxMutation,
  QuoteProposal,
} from "./contracts";

export interface MemoryGrowthSuiteRepositoryOptions {
  leads?: readonly LeadInboxItem[];
  quotes?: readonly QuoteProposal[];
  now?: () => Date;
  id?: () => string;
  contacts?: Readonly<
    Record<
      string,
      Pick<
        LeadContactHandoff,
        "contactName" | "preferredContactMethod" | "contactValue"
      >
    >
  >;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

/**
 * A deterministic adapter for isolated tests and local prototypes only. The
 * route does not select it by default because lead and quote state must be
 * durable before production use.
 */
export class MemoryGrowthSuiteRepository implements GrowthSuiteRepository {
  readonly #leads: LeadInboxItem[];
  readonly #quotes: QuoteProposal[];
  readonly #now: () => Date;
  readonly #id: () => string;
  readonly #contacts: MemoryGrowthSuiteRepositoryOptions["contacts"];

  constructor(options: MemoryGrowthSuiteRepositoryOptions = {}) {
    this.#leads = clone([...(options.leads ?? [])]);
    this.#quotes = clone([...(options.quotes ?? [])]);
    this.#now = options.now ?? (() => new Date());
    this.#id = options.id ?? randomUUID;
    this.#contacts = clone(options.contacts ?? {});
  }

  async listLeads(
    scope: GrowthSuiteScope,
    limit: number,
  ): Promise<readonly LeadInboxItem[]> {
    return clone(
      this.#leads
        .filter(({ organisationId }) => organisationId === scope.organisationId)
        .sort((left, right) => right.receivedAt.localeCompare(left.receivedAt))
        .slice(0, limit),
    );
  }

  async mutateLead(
    scope: GrowthSuiteScope,
    leadId: string,
    mutation: LeadInboxMutation,
  ): Promise<GrowthSuiteMutationResult<LeadInboxItem>> {
    const item = this.#leads.find(
      (candidate) =>
        candidate.id === leadId &&
        candidate.organisationId === scope.organisationId &&
        candidate.version === mutation.expectedVersion,
    );
    if (!item) return { outcome: "not_found_or_conflict" };
    if (mutation.action === "set_status" && item.status === mutation.status) {
      const decision = item.latestStatusDecision;
      const exactReplay =
        decision?.status === mutation.status &&
        decision.reason === mutation.reason &&
        (mutation.status !== "converted" ||
          (decision.externalTargetReference ===
            mutation.externalTargetReference &&
            decision.receiptSha256 === mutation.receiptSha256));
      return exactReplay
        ? { outcome: "updated", record: clone(item) }
        : { outcome: "policy_denied" };
    }
    if (["not_a_fit", "converted"].includes(item.status)) {
      return { outcome: "policy_denied" };
    }
    if (
      mutation.action === "set_status" &&
      ((mutation.status === "qualified" && item.status !== "new") ||
        (mutation.status === "converted" &&
          item.status !== "conversion_proposed"))
    ) {
      return { outcome: "policy_denied" };
    }
    const updatedAt = this.#now().toISOString();
    switch (mutation.action) {
      case "assign":
        item.assignedToUserId = mutation.assigneeUserId;
        break;
      case "set_status":
        item.status = mutation.status;
        item.latestStatusDecision = {
          status: mutation.status,
          reason: mutation.reason,
          decidedAt: updatedAt,
          decidedByUserId: scope.actorUserId,
          externalTargetReference:
            mutation.status === "converted"
              ? mutation.externalTargetReference
              : null,
          receiptSha256:
            mutation.status === "converted" ? mutation.receiptSha256 : null,
        };
        break;
      case "set_sla":
        item.slaDueAt = mutation.slaDueAt;
        break;
      case "propose_conversion":
        if (item.status !== "qualified") {
          return { outcome: "policy_denied" };
        }
        item.status = "conversion_proposed";
        item.conversionProposal = {
          id: this.#id(),
          status: "pending_human_decision",
          proposedAt: updatedAt,
          proposedByUserId: scope.actorUserId,
          suggestedPursuitTitle: mutation.suggestedPursuitTitle,
          rationale: mutation.rationale,
        };
        break;
    }
    item.version += 1;
    item.updatedAt = updatedAt;
    return { outcome: "updated", record: clone(item) };
  }

  async listQuotes(
    scope: GrowthSuiteScope,
    limit: number,
  ): Promise<readonly QuoteProposal[]> {
    return clone(
      this.#quotes
        .filter(({ organisationId }) => organisationId === scope.organisationId)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, limit),
    );
  }

  async getLeadContactHandoff(
    scope: GrowthSuiteScope,
    leadId: string,
    expectedVersion: number,
    purpose: LeadContactHandoffPurpose,
  ): Promise<GrowthSuiteMutationResult<LeadContactHandoff>> {
    const lead = this.#leads.find(
      (candidate) =>
        candidate.id === leadId &&
        candidate.organisationId === scope.organisationId &&
        candidate.version === expectedVersion,
    );
    const contact = this.#contacts?.[leadId];
    if (!lead || !contact) return { outcome: "not_found_or_conflict" };
    if (
      lead.assignedToUserId !== scope.actorUserId ||
      (purpose === "conversion_handoff" &&
        lead.status !== "conversion_proposed") ||
      ["not_a_fit", "converted"].includes(lead.status)
    ) {
      return { outcome: "policy_denied" };
    }
    const accessedAt = this.#now().toISOString();
    lead.version += 1;
    lead.updatedAt = accessedAt;
    return {
      outcome: "updated",
      record: {
        leadId,
        ...clone(contact),
        purpose,
        accessedAt,
        version: lead.version,
      },
    };
  }

  async createQuoteDraft(
    scope: GrowthSuiteScope,
    draft: CreateQuoteDraft,
  ): Promise<QuoteProposal> {
    const now = this.#now().toISOString();
    const quote: QuoteProposal = {
      id: this.#id(),
      organisationId: scope.organisationId,
      ...draft,
      status: "draft",
      createdByUserId: scope.actorUserId,
      approvedByUserId: null,
      approvedAt: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    this.#quotes.push(quote);
    return clone(quote);
  }

  async approveQuote(
    scope: GrowthSuiteScope,
    quoteId: string,
    expectedVersion: number,
  ): Promise<GrowthSuiteMutationResult<QuoteProposal>> {
    const quote = this.#quotes.find(
      (candidate) =>
        candidate.id === quoteId &&
        candidate.organisationId === scope.organisationId &&
        candidate.version === expectedVersion &&
        candidate.status === "draft",
    );
    if (!quote) return { outcome: "not_found_or_conflict" };
    if (quote.createdByUserId === scope.actorUserId) {
      return { outcome: "policy_denied" };
    }
    const now = this.#now().toISOString();
    quote.status = "approved";
    quote.approvedByUserId = scope.actorUserId;
    quote.approvedAt = now;
    quote.updatedAt = now;
    quote.version += 1;
    return { outcome: "updated", record: clone(quote) };
  }
}
