import { Router, type IRouter, type Request, type Response } from "express";
import { getLocalUser } from "../middlewares/auth";
import { privateResponse } from "../middlewares/privateResponse";
import { getAccessContext, type AccessContext } from "../middlewares/tenancy";
import type { OrganisationRole } from "../lib/permissions";
import {
  PRODUCTION_ACCEPTANCE_BOUNDS,
  ProductionAcceptanceRepositoryUnavailableError,
  isSha256,
  parseProductionAcceptanceEvidenceDraft,
  unavailableProductionAcceptanceRepository,
  type ProductionAcceptanceRepository,
  type ProductionAcceptanceScope,
} from "../lib/productionAcceptance/contracts";
import {
  PRODUCTION_ACCEPTANCE_AUTHORITY_NOTE,
  ProductionAcceptanceValidationError,
  appendProductionAcceptanceEvidence,
  buildProductionAcceptanceSnapshot,
} from "../lib/productionAcceptance/service";

const INTERNAL_READ_ROLES = new Set<OrganisationRole>([
  "valo_operations_administrator",
  "restricted_platform_administrator",
  "valo_quality_adviser",
]);

const INTERNAL_RECORD_ROLES = new Set<OrganisationRole>([
  "valo_operations_administrator",
  "valo_quality_adviser",
]);

export interface ProductionAcceptanceRouterOptions {
  repository?: ProductionAcceptanceRepository;
  now?: () => Date;
  currentReleaseSha256?: () => string | null;
  resolveAccess?: (request: Request) => AccessContext | undefined;
  resolveActorUserId?: (request: Request) => string | undefined;
}

export function canReadProductionAcceptance(
  context: AccessContext | undefined,
): boolean {
  return Boolean(
    context?.source === "membership" &&
    context.permissions.has("audit:read") &&
    context.roles.some((role) => INTERNAL_READ_ROLES.has(role)),
  );
}

export function canRecordProductionAcceptance(
  context: AccessContext | undefined,
): boolean {
  return Boolean(
    canReadProductionAcceptance(context) &&
    context?.roles.some((role) => INTERNAL_RECORD_ROLES.has(role)) &&
    (context.permissions.has("configuration:manage") ||
      context.permissions.has("evaluation:manage")),
  );
}

function sendRepositoryUnavailable(
  response: Response,
  error: unknown,
): boolean {
  if (!(error instanceof ProductionAcceptanceRepositoryUnavailableError)) {
    return false;
  }
  response.status(503).json({
    error: "Production acceptance evidence is not available",
    authorityNote: PRODUCTION_ACCEPTANCE_AUTHORITY_NOTE,
  });
  return true;
}

/**
 * Mount under `/api` after authentication and tenant middleware. The injected
 * repository must be tenant scoped, append only, idempotent, and must append
 * its content-free audit receipt in the same transaction as the evidence row.
 * This module deliberately supplies no production persistence fallback.
 */
export function createProductionAcceptanceRouter(
  options: ProductionAcceptanceRouterOptions = {},
): IRouter {
  const router: IRouter = Router();
  const repository =
    options.repository ?? unavailableProductionAcceptanceRepository;
  const now = options.now ?? (() => new Date());
  const currentReleaseSha256 =
    options.currentReleaseSha256 ??
    (() => process.env.VALO_RELEASE_SHA256?.trim() || null);
  const resolveAccess = options.resolveAccess ?? getAccessContext;
  const resolveActorUserId =
    options.resolveActorUserId ??
    ((request: Request) => getLocalUser(request)?.id);

  const scope = (request: Request): ProductionAcceptanceScope | null => {
    const context = resolveAccess(request);
    const actorUserId = resolveActorUserId(request);
    return context && actorUserId
      ? { organisationId: context.organisationId, actorUserId }
      : null;
  };

  router.use("/production-acceptance", privateResponse);

  router.get("/production-acceptance", async (request, response, next) => {
    const context = resolveAccess(request);
    const requestScope = scope(request);
    if (!canReadProductionAcceptance(context) || !requestScope) {
      response
        .status(403)
        .json({ error: "Production acceptance access denied" });
      return;
    }
    try {
      const evidence = await repository.listEvidence(
        requestScope,
        PRODUCTION_ACCEPTANCE_BOUNDS.maxEvidenceRecords + 1,
      );
      const snapshot = buildProductionAcceptanceSnapshot({
        organisationId: requestScope.organisationId,
        evidence,
        expectedReleaseSha256: currentReleaseSha256(),
        now: now(),
      });
      response.json(snapshot);
    } catch (error) {
      if (!sendRepositoryUnavailable(response, error)) next(error);
    }
  });

  router.get(
    "/production-acceptance/authorities",
    async (request, response, next) => {
      const context = resolveAccess(request);
      const requestScope = scope(request);
      if (!canRecordProductionAcceptance(context) || !requestScope) {
        response
          .status(403)
          .json({ error: "Production acceptance recording denied" });
        return;
      }
      try {
        const authorities = await repository.listAuthorities(
          requestScope,
          PRODUCTION_ACCEPTANCE_BOUNDS.maxAuthorities + 1,
        );
        if (authorities.length > PRODUCTION_ACCEPTANCE_BOUNDS.maxAuthorities) {
          throw new ProductionAcceptanceRepositoryUnavailableError();
        }
        response.json({
          organisationId: requestScope.organisationId,
          items: authorities,
          limit: PRODUCTION_ACCEPTANCE_BOUNDS.maxAuthorities,
          truncated: false,
        });
      } catch (error) {
        if (!sendRepositoryUnavailable(response, error)) next(error);
      }
    },
  );

  router.post(
    "/production-acceptance/evidence",
    async (request, response, next) => {
      const context = resolveAccess(request);
      const requestScope = scope(request);
      if (!canRecordProductionAcceptance(context) || !requestScope) {
        response
          .status(403)
          .json({ error: "Production acceptance recording denied" });
        return;
      }
      const draft = parseProductionAcceptanceEvidenceDraft(request.body);
      if (!draft) {
        response.status(400).json({ error: "Invalid acceptance evidence" });
        return;
      }
      const releaseSha256 = currentReleaseSha256();
      if (!isSha256(releaseSha256)) {
        response.status(503).json({
          error: "The exact release candidate is not configured",
          authorityNote: PRODUCTION_ACCEPTANCE_AUTHORITY_NOTE,
        });
        return;
      }
      if (draft.releaseSha256 !== releaseSha256) {
        response.status(409).json({
          error: "Evidence must be bound to the configured release candidate",
          authorityNote: PRODUCTION_ACCEPTANCE_AUTHORITY_NOTE,
        });
        return;
      }
      try {
        const result = await appendProductionAcceptanceEvidence({
          repository,
          scope: requestScope,
          draft,
          now: now(),
        });
        if (result.outcome === "idempotency_conflict") {
          response.status(409).json({
            error: "The idempotency key is already bound to different evidence",
          });
          return;
        }
        response.status(result.outcome === "appended" ? 201 : 200).json({
          record: result.record,
          replayed: result.outcome === "replayed",
          deploymentAuthorized: false,
          authorityNote: PRODUCTION_ACCEPTANCE_AUTHORITY_NOTE,
        });
      } catch (error) {
        if (error instanceof ProductionAcceptanceValidationError) {
          response.status(400).json({
            error: "Acceptance evidence failed policy validation",
            code: error.code,
          });
          return;
        }
        if (!sendRepositoryUnavailable(response, error)) next(error);
      }
    },
  );

  return router;
}
