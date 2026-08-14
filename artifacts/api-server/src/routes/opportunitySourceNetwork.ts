import { Router, type IRouter, type Request, type Response } from "express";
import {
  getAccessContext,
  requirePermissionOrLegacy,
  type AccessContext,
} from "../middlewares/tenancy";
import { resolveMembershipActorScope } from "./membershipActorScope";
import {
  AuditOpportunitySourceRepository,
  OpportunitySourceNetworkError,
  OpportunitySourceNetworkService,
  parseManualOpportunitySourceBody,
  parseOpportunitySourceDecisionBody,
  type OpportunitySourceScope,
} from "../lib/opportunitySourceNetwork";

export interface OpportunitySourceNetworkRouterOptions {
  service?: OpportunitySourceNetworkService;
  resolveAccess?: (request: Request) => AccessContext | undefined;
}

function scopeFromRequest(
  request: Request,
  resolveAccess: (request: Request) => AccessContext | undefined,
): OpportunitySourceScope | null {
  const scope = resolveMembershipActorScope(request, resolveAccess, {
    requireMembershipOrganisationMatch: false,
  });
  if (!scope) return null;
  return {
    organisationId: scope.organisationId,
    actorUserId: scope.actorUserId,
    actorName: scope.actorName,
  };
}

function sendKnownError(response: Response, error: unknown): boolean {
  if (!(error instanceof OpportunitySourceNetworkError)) return false;
  switch (error.code) {
    case "invalid_request":
      response.status(400).json({ error: error.message });
      return true;
    case "scope_denied":
      response.status(403).json({ error: "Organisation access denied" });
      return true;
    case "not_found":
      response.status(404).json({ error: "Candidate not found" });
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

export function createOpportunitySourceNetworkRouter(
  options: OpportunitySourceNetworkRouterOptions = {},
): IRouter {
  const router: IRouter = Router();
  const service =
    options.service ??
    new OpportunitySourceNetworkService(new AuditOpportunitySourceRepository());
  const resolveAccess = options.resolveAccess ?? getAccessContext;

  router.get(
    "/opportunity-sources",
    requirePermissionOrLegacy("organisation:read"),
    async (request, response, next) => {
      try {
        const scope = scopeFromRequest(request, resolveAccess);
        if (!scope) {
          response.status(403).json({ error: "Organisation access denied" });
          return;
        }
        response.setHeader("Cache-Control", "private, no-store");
        response.json(await service.list(scope));
      } catch (error) {
        if (!sendKnownError(response, error)) next(error);
      }
    },
  );

  router.get(
    "/opportunity-sources/:candidateId",
    requirePermissionOrLegacy("organisation:read"),
    async (request, response, next) => {
      try {
        const scope = scopeFromRequest(request, resolveAccess);
        if (!scope) {
          response.status(403).json({ error: "Organisation access denied" });
          return;
        }
        response.setHeader("Cache-Control", "private, no-store");
        response.json(
          await service.get(scope, String(request.params.candidateId)),
        );
      } catch (error) {
        if (!sendKnownError(response, error)) next(error);
      }
    },
  );

  router.post(
    "/opportunity-sources/manual",
    requirePermissionOrLegacy("project:create"),
    async (request, response, next) => {
      try {
        const scope = scopeFromRequest(request, resolveAccess);
        const input = parseManualOpportunitySourceBody(request.body);
        if (!scope) {
          response.status(403).json({ error: "Organisation access denied" });
          return;
        }
        if (!input) {
          response.status(400).json({ error: "Source input is invalid" });
          return;
        }
        response.setHeader("Cache-Control", "private, no-store");
        response.status(201).json(await service.recordManual(scope, input));
      } catch (error) {
        if (!sendKnownError(response, error)) next(error);
      }
    },
  );

  router.post(
    "/opportunity-sources/:candidateId/decision",
    requirePermissionOrLegacy("project:create"),
    async (request, response, next) => {
      try {
        const scope = scopeFromRequest(request, resolveAccess);
        const input = parseOpportunitySourceDecisionBody(request.body);
        if (!scope) {
          response.status(403).json({ error: "Organisation access denied" });
          return;
        }
        if (!input) {
          response.status(400).json({ error: "Decision input is invalid" });
          return;
        }
        response.setHeader("Cache-Control", "private, no-store");
        response.json(
          await service.decide(
            scope,
            String(request.params.candidateId),
            input,
          ),
        );
      } catch (error) {
        if (!sendKnownError(response, error)) next(error);
      }
    },
  );

  return router;
}

export default createOpportunitySourceNetworkRouter;
