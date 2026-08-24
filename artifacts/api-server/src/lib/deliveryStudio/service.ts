import { validateCitationFirstResponse } from "../intelligence/boundedMvpResponseStudio";
import { isValidId } from "../intelligence/domain";
import {
  DELIVERY_STUDIO_AUTHORITY_NOTE,
  DELIVERY_STUDIO_SAFETY,
  DeliveryStudioError,
  type DeliveryStudioAction,
  type DeliveryStudioDerivedAction,
  type DeliveryStudioEnvelope,
  type DeliveryStudioMutationResponse,
  type DeliveryStudioRepository,
  type DeliveryStudioRepositorySnapshot,
  type DeliveryStudioScope,
  type PortfolioIntelligenceEnvelope,
} from "./contracts";

const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/u;

function assertScope(scope: DeliveryStudioScope): void {
  if (
    !isValidId(scope.organisationId) ||
    !isValidId(scope.actorUserId) ||
    !isValidId(scope.membershipId) ||
    scope.actorName.trim().length < 2 ||
    scope.actorName.length > 200
  ) {
    throw new DeliveryStudioError(
      "invalid_request",
      "A current named direct organisation member is required.",
    );
  }
}

function present(
  snapshot: DeliveryStudioRepositorySnapshot,
  generatedAt: string,
): DeliveryStudioEnvelope {
  return {
    authorityNote: DELIVERY_STUDIO_AUTHORITY_NOTE,
    generatedAt,
    ...snapshot,
    safety: DELIVERY_STUDIO_SAFETY,
  };
}

function assertCommand(
  projectId: string,
  ifMatch: number,
  idempotencyKey: string,
): void {
  if (
    !isValidId(projectId) ||
    !Number.isSafeInteger(ifMatch) ||
    ifMatch < 1 ||
    !IDEMPOTENCY_KEY.test(idempotencyKey)
  ) {
    throw new DeliveryStudioError(
      "invalid_request",
      "A valid project, If-Match version, and Idempotency-Key are required.",
    );
  }
}

export class DeliveryStudioService {
  constructor(
    private readonly repository: DeliveryStudioRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async getStudio(
    scope: DeliveryStudioScope,
    projectId: string,
  ): Promise<DeliveryStudioEnvelope> {
    assertScope(scope);
    if (!isValidId(projectId)) {
      throw new DeliveryStudioError(
        "invalid_request",
        "Project ID is invalid.",
      );
    }
    const snapshot = await this.repository.load(scope, projectId);
    if (!snapshot) {
      throw new DeliveryStudioError("not_found", "Project was not found.");
    }
    return present(snapshot, this.now().toISOString());
  }

  async execute(input: {
    readonly scope: DeliveryStudioScope;
    readonly projectId: string;
    readonly data: DeliveryStudioAction;
    readonly ifMatch: number;
    readonly idempotencyKey: string;
  }): Promise<DeliveryStudioMutationResponse> {
    assertScope(input.scope);
    assertCommand(input.projectId, input.ifMatch, input.idempotencyKey);
    const occurredAt = this.now().toISOString();
    let responseValidation: DeliveryStudioDerivedAction["responseValidation"];

    if (input.data.action === "save_response") {
      const validationInput = await this.repository.prepareResponseValidation(
        input.scope,
        input.projectId,
        input.data,
      );
      responseValidation = validateCitationFirstResponse(validationInput);
    }
    const derived: DeliveryStudioDerivedAction = {
      ...(responseValidation ? { responseValidation } : {}),
    };

    const mutation = await this.repository.mutate({
      scope: input.scope,
      projectId: input.projectId,
      data: input.data,
      ifMatch: input.ifMatch,
      idempotencyKey: input.idempotencyKey,
      occurredAt,
      derived,
    });
    let snapshot: DeliveryStudioRepositorySnapshot | null;
    try {
      snapshot = await this.repository.load(input.scope, input.projectId);
    } catch (error) {
      if (mutation.outcome === "recorded") {
        throw new Error(
          "Delivery Studio post-mutation projection failed; the request must roll back.",
          { cause: error },
        );
      }
      throw error;
    }
    if (!snapshot) {
      if (mutation.outcome === "recorded") {
        throw new Error(
          "Delivery Studio post-mutation projection is unavailable; the request must roll back.",
        );
      }
      throw new DeliveryStudioError(
        "conflict",
        "Delivery Studio projection is unavailable.",
      );
    }
    return {
      projectId: input.projectId,
      action: input.data.action,
      outcome: mutation.outcome,
      receiptId: mutation.receiptId,
      data: present(snapshot, occurredAt),
    };
  }

  async getPortfolio(
    scope: DeliveryStudioScope,
  ): Promise<PortfolioIntelligenceEnvelope> {
    assertScope(scope);
    const snapshot = await this.repository.portfolio(scope);

    return {
      generatedAt: this.now().toISOString(),
      authorityNote: DELIVERY_STUDIO_AUTHORITY_NOTE,
      totals: snapshot.totals,
      projects: snapshot.projects,
      limitations: [
        "Portfolio intelligence is limited to the current organisation and current direct membership.",
        "Statuses are deterministic workflow facts, not win predictions or benchmark scores.",
        "Lesson derivation is unavailable until cited outcome and defect bindings plus named review are implemented.",
      ],
    };
  }
}
