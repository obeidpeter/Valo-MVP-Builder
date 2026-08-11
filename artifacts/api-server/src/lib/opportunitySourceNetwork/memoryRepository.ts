import { randomUUID } from "node:crypto";
import {
  OPPORTUNITY_SOURCE_NETWORK_BOUNDS,
  OpportunitySourceNetworkError,
  type NormalizedOpportunitySourceInput,
  type OpportunitySourceCandidate,
  type OpportunitySourceDecision,
  type OpportunitySourceRepository,
  type OpportunitySourceScope,
} from "./contracts";

/** Development/test repository. Production construction uses the audit-backed adapter. */
export class InMemoryOpportunitySourceRepository implements OpportunitySourceRepository {
  readonly #items = new Map<string, OpportunitySourceCandidate>();

  async list(
    scope: OpportunitySourceScope,
  ): Promise<OpportunitySourceCandidate[]> {
    return [...this.#items.values()]
      .filter((item) => item.organisationId === scope.organisationId)
      .sort((left, right) => left.observedAt.localeCompare(right.observedAt));
  }

  async get(
    scope: OpportunitySourceScope,
    candidateId: string,
  ): Promise<OpportunitySourceCandidate | null> {
    const item = this.#items.get(candidateId);
    return item?.organisationId === scope.organisationId ? item : null;
  }

  async create(
    scope: OpportunitySourceScope,
    input: NormalizedOpportunitySourceInput,
  ): Promise<OpportunitySourceCandidate> {
    const current = await this.list(scope);
    if (
      current.length >=
      OPPORTUNITY_SOURCE_NETWORK_BOUNDS.candidatesPerOrganisation
    ) {
      throw new OpportunitySourceNetworkError(
        "capacity_exceeded",
        "The opportunity source inbox has reached its safe bound.",
      );
    }
    const duplicate = current.find(
      (item) => item.dedupeKey === input.dedupeKey,
    );
    if (duplicate) {
      if (duplicate.receiptSha256 === input.receiptSha256) return duplicate;
      throw new OpportunitySourceNetworkError(
        "conflict",
        "The source reference already exists with different metadata.",
      );
    }
    const item: OpportunitySourceCandidate = {
      ...input,
      id: randomUUID(),
      organisationId: scope.organisationId,
      status: "pending_review",
      version: 1,
      recordedByUserId: scope.actorUserId,
      recordedByName: scope.actorName,
      reviewedByUserId: null,
      reviewedByName: null,
      reviewedAt: null,
      decisionReason: null,
      tenderId: null,
    };
    this.#items.set(item.id, item);
    return item;
  }

  async decide(
    scope: OpportunitySourceScope,
    candidateId: string,
    decision: OpportunitySourceDecision,
  ): Promise<OpportunitySourceCandidate> {
    const current = await this.get(scope, candidateId);
    if (!current) {
      throw new OpportunitySourceNetworkError(
        "not_found",
        "Candidate not found.",
      );
    }
    if (
      current.version !== decision.expectedVersion ||
      current.status !== "pending_review"
    ) {
      throw new OpportunitySourceNetworkError(
        "conflict",
        "The candidate changed before the decision was recorded.",
      );
    }
    const updated: OpportunitySourceCandidate = {
      ...current,
      status: decision.decision === "accept" ? "accepted" : "rejected",
      version: current.version + 1,
      reviewedByUserId: scope.actorUserId,
      reviewedByName: scope.actorName,
      reviewedAt: new Date().toISOString(),
      decisionReason: decision.reason,
      tenderId: decision.decision === "accept" ? randomUUID() : null,
    };
    this.#items.set(candidateId, updated);
    return updated;
  }
}
