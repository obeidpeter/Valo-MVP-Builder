import {
  Router,
  type IRouter,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { privateResponse } from "../middlewares/privateResponse";
import {
  commitTenantDatabaseBeforeResponse,
  holdTenantDatabaseUntilComplete,
} from "../middlewares/databaseTenancy";
import {
  getAccessContext,
  parseExpectedVersion,
  requirePermissionOrLegacy,
} from "../middlewares/tenancy";
import {
  RETENTION_COMPLETION_BOUNDS,
  RetentionCompletionError,
  type RetentionCompletionScope,
} from "../lib/retentionCompletion/contracts";
import { RetentionCompletionService } from "../lib/retentionCompletion/service";
import { resolveMembershipActorScope } from "./membershipActorScope";
import { createBoundedJsonBody } from "./boundedJsonBody";

export interface RetentionCompletionRouterOptions {
  service: RetentionCompletionService;
  holdCritical?: (request: Request) => (error?: unknown) => void;
  commitBeforeResponse?: (request: Request) => Promise<void>;
  resolveScope?: (request: Request) => RetentionCompletionScope | null;
}

const boundedMutationBody = createBoundedJsonBody(
  RETENTION_COMPLETION_BOUNDS.requestBodyBytes,
  "retention-completion",
);

function defaultScope(request: Request): RetentionCompletionScope | null {
  const actor = resolveMembershipActorScope(request, getAccessContext, {
    requireMembershipOrganisationMatch: true,
  });
  return actor
    ? {
        organisationId: actor.organisationId,
        actorUserId: actor.actorUserId,
        actorMembershipId: actor.membershipId,
      }
    : null;
}

function parseAttestationBody(body: unknown): { attestation: string } | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const value = body as Record<string, unknown>;
  if (
    Object.keys(value).length !== 1 ||
    typeof value.attestation !== "string"
  ) {
    return null;
  }
  return { attestation: value.attestation };
}

function errorStatus(error: RetentionCompletionError): number {
  switch (error.code) {
    case "invalid_input":
      return 400;
    case "not_found_or_not_authorized":
      return 404;
    case "not_activated":
    case "persistence_unavailable":
      return 503;
    case "stale_version":
      return 412;
    case "state_conflict":
    case "idempotency_conflict":
    case "maker_checker_conflict":
    case "capacity_exceeded":
      return 409;
  }
}

function sendError(response: Response, error: RetentionCompletionError): void {
  response.status(errorStatus(error)).json({
    error: error.message,
    code: error.code,
    sideEffectsApplied: false,
    ...(error.snapshot ? { snapshot: error.snapshot } : {}),
  });
}

function sendReadinessUnavailable(
  response: Response,
  error: RetentionCompletionError,
): void {
  response.status(503).json({
    error: error.message,
    code: "persistence_unavailable",
    sideEffectsApplied: false,
  });
}

export function createRetentionCompletionRouter(
  options: RetentionCompletionRouterOptions,
): IRouter {
  const router: IRouter = Router();
  const resolveScope = options.resolveScope ?? defaultScope;
  const holdCritical = options.holdCritical ?? holdTenantDatabaseUntilComplete;
  const commitBeforeResponse =
    options.commitBeforeResponse ?? commitTenantDatabaseBeforeResponse;

  router.use("/retention-completion", privateResponse);
  router.use("/retention-requests", privateResponse);
  router.use("/retention-actions", privateResponse);
  router.use("/retention-requests/:id/complete", boundedMutationBody);
  router.use("/retention-actions/:id/reconcile", boundedMutationBody);
  router.use("/retention-actions/:id/certify", boundedMutationBody);

  const scopeFor = (
    request: Request,
    response: Response,
  ): RetentionCompletionScope | null => {
    const scope = resolveScope(request);
    if (!scope) {
      response.status(403).json({
        error: "A current direct organisation membership is required.",
      });
      return null;
    }
    return scope;
  };

  router.get(
    "/retention-completion/readiness",
    requirePermissionOrLegacy("retention:manage"),
    async (request, response, next) => {
      const scope = scopeFor(request, response);
      if (!scope) return;
      try {
        response.json(await options.service.readiness(scope));
      } catch (error) {
        if (error instanceof RetentionCompletionError) {
          sendError(response, error);
          return;
        }
        next(error);
      }
    },
  );

  router.get(
    "/retention-requests",
    requirePermissionOrLegacy("retention:manage"),
    async (request, response, next) => {
      const scope = scopeFor(request, response);
      if (!scope) return;
      try {
        response.json(await options.service.list(scope));
      } catch (error) {
        if (error instanceof RetentionCompletionError) {
          sendError(response, error);
          return;
        }
        next(error);
      }
    },
  );

  router.get(
    "/retention-requests/:id/completion",
    requirePermissionOrLegacy("retention:manage"),
    async (request, response, next) => {
      const scope = scopeFor(request, response);
      if (!scope) return;
      try {
        const snapshot = await options.service.read(
          scope,
          String(request.params.id),
        );
        response.setHeader("ETag", `"${snapshot.request.version}"`);
        response.json(snapshot);
      } catch (error) {
        if (error instanceof RetentionCompletionError) {
          sendError(response, error);
          return;
        }
        next(error);
      }
    },
  );

  const mutation =
    (operation: "detach" | "reconcile" | "certify") =>
    async (
      request: Request,
      response: Response,
      next: NextFunction,
    ): Promise<void> => {
      const scope = scopeFor(request, response);
      if (!scope) return;
      const expectedVersion = parseExpectedVersion(request.get("If-Match"));
      if (!expectedVersion) {
        response.status(428).json({
          error: "A valid If-Match version is required.",
          code: "invalid_input",
          sideEffectsApplied: false,
        });
        return;
      }
      const body = parseAttestationBody(request.body);
      if (!body) {
        response.status(400).json({
          error: "The request body must contain only attestation.",
          code: "invalid_input",
          sideEffectsApplied: false,
        });
        return;
      }
      const release = holdCritical(request);
      try {
        const input = {
          expectedVersion,
          idempotencyKey: request.get("Idempotency-Key"),
          attestation: body.attestation,
        };
        const id = String(request.params.id);
        const snapshot =
          operation === "detach"
            ? await options.service.detach(scope, id, input)
            : operation === "reconcile"
              ? await options.service.reconcile(scope, id, input)
              : await options.service.certify(scope, id, input);
        await commitBeforeResponse(request);
        const version = snapshot.action?.version ?? snapshot.request.version;
        if (version) response.setHeader("ETag", `"${version}"`);
        const actionStatus = snapshot.action?.status;
        const successful =
          operation === "detach"
            ? actionStatus === "detached" ||
              actionStatus === "reconciled" ||
              actionStatus === "certified"
            : operation === "reconcile"
              ? actionStatus === "reconciled" || actionStatus === "certified"
              : actionStatus === "certified";
        response
          .status(successful ? (operation === "detach" ? 202 : 200) : 409)
          .json(snapshot);
      } catch (error) {
        if (error instanceof RetentionCompletionError) {
          if (error.code === "not_activated") {
            try {
              const readiness = await options.service.readiness(scope);
              release();
              response.status(503).json({
                error: error.message,
                code: "RETENTION_COMPLETION_NOT_ACTIVATED",
                sideEffectsApplied: false,
                readiness,
              });
            } catch (readinessError) {
              if (readinessError instanceof RetentionCompletionError) {
                release();
                if (readinessError.code === "persistence_unavailable") {
                  sendReadinessUnavailable(response, readinessError);
                } else {
                  sendError(response, readinessError);
                }
              } else {
                release(readinessError);
                next(readinessError);
              }
            }
            return;
          }
          release();
          sendError(response, error);
          return;
        }
        release(error);
        next(error);
      }
    };

  router.post(
    "/retention-requests/:id/complete",
    requirePermissionOrLegacy("retention:manage"),
    mutation("detach"),
  );
  router.post(
    "/retention-actions/:id/reconcile",
    requirePermissionOrLegacy("retention:manage"),
    mutation("reconcile"),
  );
  router.post(
    "/retention-actions/:id/certify",
    requirePermissionOrLegacy("retention:manage"),
    mutation("certify"),
  );

  return router;
}

export default createRetentionCompletionRouter;
