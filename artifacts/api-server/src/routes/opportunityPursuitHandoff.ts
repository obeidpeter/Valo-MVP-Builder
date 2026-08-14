import { Router, type IRouter, type Request, type Response } from "express";
import { setPrivateResponseHeaders } from "../middlewares/privateResponse";
import { holdTenantDatabaseUntilComplete } from "../middlewares/databaseTenancy";
import {
  getAccessContext,
  requirePermissionOrLegacy,
  type AccessContext,
} from "../middlewares/tenancy";
import {
  AuditOpportunityPursuitHandoffRepository,
  OPPORTUNITY_PURSUIT_HANDOFF_BOUNDS,
  OpportunityPursuitHandoffError,
  OpportunityPursuitHandoffService,
  parseOpportunityPursuitHandoffBody,
  type OpportunityPursuitHandoffScope,
} from "../lib/opportunityPursuitHandoff";
import { createBoundedJsonBody } from "./boundedJsonBody";
import { resolveMembershipActorScope } from "./membershipActorScope";

export interface OpportunityPursuitHandoffRouterOptions {
  service?: OpportunityPursuitHandoffService;
  resolveAccess?: (request: Request) => AccessContext | undefined;
  holdCritical?: (request: Request) => (error?: unknown) => void;
}

function scopeFromRequest(
  request: Request,
  resolveAccess: (request: Request) => AccessContext | undefined,
): OpportunityPursuitHandoffScope | null {
  const scope = resolveMembershipActorScope(request, resolveAccess, {
    requireMembershipOrganisationMatch: true,
  });
  if (!scope) return null;
  return {
    organisationId: scope.organisationId,
    actorUserId: scope.actorUserId,
    actorName: scope.actorName,
    actorMembershipId: scope.membershipId,
  };
}

function singleIdempotencyKey(request: Request): string | null {
  const value = request.headers["idempotency-key"];
  if (Array.isArray(value) || typeof value !== "string") return null;
  return value === value.trim() && value.length > 0 ? value : null;
}

function sendKnownError(response: Response, error: unknown): boolean {
  if (!(error instanceof OpportunityPursuitHandoffError)) return false;
  switch (error.code) {
    case "invalid_request":
      response.status(400).json({ error: error.message });
      return true;
    case "scope_denied":
      response.status(403).json({ error: error.message });
      return true;
    case "not_found":
      response.status(404).json({ error: "Opportunity handoff not found" });
      return true;
    case "conflict":
      response.status(409).json({ error: error.message });
      return true;
    case "capacity_exceeded":
      response.status(413).json({ error: error.message });
      return true;
    case "source_unavailable":
      response.status(503).json({ error: error.message });
      return true;
    case "persisted_state_invalid":
      return false;
  }
}

export function createOpportunityPursuitHandoffRouter(
  options: OpportunityPursuitHandoffRouterOptions = {},
): IRouter {
  const router: IRouter = Router();
  const service =
    options.service ??
    new OpportunityPursuitHandoffService(
      new AuditOpportunityPursuitHandoffRepository(),
    );
  const resolveAccess = options.resolveAccess ?? getAccessContext;
  const holdCritical = options.holdCritical ?? holdTenantDatabaseUntilComplete;

  router.use(
    createBoundedJsonBody(
      OPPORTUNITY_PURSUIT_HANDOFF_BOUNDS.requestBodyBytes,
      "opportunity-handoff",
    ),
  );

  router.get(
    "/opportunity-sources/:candidateId/pursuit-handoff",
    requirePermissionOrLegacy("project:create"),
    async (request, response, next) => {
      try {
        const scope = scopeFromRequest(request, resolveAccess);
        if (!scope) {
          response.status(403).json({ error: "Direct membership required" });
          return;
        }
        setPrivateResponseHeaders(response);
        response.json(
          await service.prepare(scope, String(request.params.candidateId)),
        );
      } catch (error) {
        if (!sendKnownError(response, error)) next(error);
      }
    },
  );

  router.post(
    "/opportunity-sources/:candidateId/pursuit-handoff/confirm",
    requirePermissionOrLegacy("project:create"),
    async (request, response, next) => {
      const scope = scopeFromRequest(request, resolveAccess);
      const idempotencyKey = singleIdempotencyKey(request);
      const body = parseOpportunityPursuitHandoffBody(request.body);
      if (!scope) {
        response.status(403).json({ error: "Direct membership required" });
        return;
      }
      if (!idempotencyKey) {
        response
          .status(400)
          .json({ error: "A valid Idempotency-Key is required" });
        return;
      }
      if (!body) {
        response.status(400).json({ error: "Handoff confirmation is invalid" });
        return;
      }
      const release = holdCritical(request);
      try {
        const result = await service.confirm(
          scope,
          String(request.params.candidateId),
          idempotencyKey,
          body,
        );
        release();
        setPrivateResponseHeaders(response);
        response.status(result.outcome === "created" ? 201 : 200).json(result);
      } catch (error) {
        if (error instanceof OpportunityPursuitHandoffError) {
          release();
          if (!sendKnownError(response, error)) next(error);
          return;
        }
        release(error);
        next(error);
      }
    },
  );

  return router;
}

export default createOpportunityPursuitHandoffRouter;
