import { Router, type IRouter, type Request, type Response } from "express";
import { getLocalUser } from "../middlewares/auth";
import { commitTenantDatabaseBeforeResponse } from "../middlewares/databaseTenancy";
import { privateResponse } from "../middlewares/privateResponse";
import { getAccessContext, type AccessContext } from "../middlewares/tenancy";
import {
  resolveCurrentDirectAuthority,
  type CurrentDirectAuthority,
} from "../lib/directMembershipAuthority";
import { parseExpectedVersion, type Permission } from "../lib/permissions";
import {
  TENDER_CONTEXT_AUTHORITY_NOTE,
  TenderContextRepositoryUnavailableError,
  type TenderContextRepository,
  type TenderContextScope,
} from "../lib/intelligence/tenderContextContracts";
import { createDrizzleTenderContextRepository } from "../lib/intelligence/tenderContextDrizzleRepository";
import {
  parseTenderContextVersionDraft,
  parseTenderReviewDraft,
  TenderContextService,
  TenderContextServiceError,
} from "../lib/intelligence/tenderContextService";

const READ_PERMISSIONS = [
  "project:read",
  "document:read",
  "requirement:read",
  "evidence:read",
  "rule_pack:read",
] as const satisfies readonly Permission[];
const PROPOSE_PERMISSIONS = [
  ...READ_PERMISSIONS,
  "requirement:write",
] as const satisfies readonly Permission[];
const REVIEW_PERMISSIONS = [
  ...READ_PERMISSIONS,
  "intelligence:review",
] as const satisfies readonly Permission[];

export interface TenderContextRouterOptions {
  readonly repository?: TenderContextRepository;
  readonly service?: Pick<
    TenderContextService,
    | "readCentre"
    | "createContext"
    | "reviewContext"
    | "createPassport"
    | "reviewPassport"
  >;
  readonly now?: () => Date;
  readonly resolveAccess?: (request: Request) => AccessContext | undefined;
  readonly resolveActor?: (
    request: Request,
  ) => { readonly id: string; readonly name: string | null } | undefined;
  readonly resolveDirectAuthority?: (
    request: Request,
  ) => Promise<CurrentDirectAuthority | null>;
  readonly commitBeforeResponse?: (request: Request) => Promise<void>;
}

export function canReadTenderContext(
  context: AccessContext | undefined,
): boolean {
  return Boolean(
    context &&
    (context.source === "membership" || context.source === "partner") &&
    READ_PERMISSIONS.every((permission) => context.permissions.has(permission)),
  );
}

export function canProposeTenderContext(
  context: AccessContext | undefined,
): boolean {
  return Boolean(
    context?.source === "membership" &&
    PROPOSE_PERMISSIONS.every((permission) =>
      context.permissions.has(permission),
    ),
  );
}

export function canReviewTenderContext(
  context: AccessContext | undefined,
): boolean {
  return Boolean(
    context?.source === "membership" &&
    REVIEW_PERMISSIONS.every((permission) =>
      context.permissions.has(permission),
    ),
  );
}

function emptyBody(value: unknown): boolean {
  return (
    value === undefined ||
    (Boolean(value) &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value as Record<string, unknown>).length === 0)
  );
}

function sendKnownError(response: Response, error: unknown): boolean {
  if (error instanceof TenderContextRepositoryUnavailableError) {
    response.status(503).json({
      error: "Tender context persistence is unavailable",
      authorityNote: TENDER_CONTEXT_AUTHORITY_NOTE,
    });
    return true;
  }
  if (!(error instanceof TenderContextServiceError)) return false;
  const status =
    error.code === "invalid_request"
      ? 400
      : error.code === "not_found"
        ? 404
        : 409;
  response.status(status).json({ error: error.message, code: error.code });
  return true;
}

/**
 * Mount below authenticated tenant middleware. Read access may be projected
 * through an approved partner relationship; every write requires a current
 * direct membership both here and again in the persistence transaction.
 */
export function createTenderContextRouter(
  options: TenderContextRouterOptions = {},
): IRouter {
  const router: IRouter = Router();
  const service =
    options.service ??
    new TenderContextService(
      options.repository ?? createDrizzleTenderContextRepository(),
      options.now,
    );
  const resolveAccess = options.resolveAccess ?? getAccessContext;
  const resolveActor =
    options.resolveActor ??
    ((request: Request) => {
      const actor = getLocalUser(request);
      return actor ? { id: actor.id, name: actor.name } : undefined;
    });
  const resolveDirectAuthority =
    options.resolveDirectAuthority ??
    ((request: Request) =>
      resolveCurrentDirectAuthority(
        resolveAccess(request),
        resolveActor(request)?.id,
      ));
  const commitBeforeResponse =
    options.commitBeforeResponse ?? commitTenantDatabaseBeforeResponse;

  const readScope = (request: Request): TenderContextScope | null => {
    const access = resolveAccess(request);
    const actor = resolveActor(request);
    const actorName = actor?.name?.trim();
    if (!access || !actor || !actorName) return null;
    if (access.source !== "membership" && access.source !== "partner") {
      return null;
    }
    return {
      organisationId: access.organisationId,
      actorUserId: actor.id,
      actorName,
      source: access.source,
      membershipId: access.source === "membership" ? access.membershipId : null,
    };
  };

  const writeScope = async (
    request: Request,
    requiredPermissions: readonly Permission[],
  ): Promise<TenderContextScope | null> => {
    const access = resolveAccess(request);
    const actor = resolveActor(request);
    const actorName = actor?.name?.trim();
    const authority = await resolveDirectAuthority(request);
    if (
      !access ||
      !actor ||
      !actorName ||
      access.source !== "membership" ||
      !access.membershipId ||
      !authority ||
      authority.organisationId !== access.organisationId ||
      authority.actorUserId !== actor.id ||
      authority.membershipId !== access.membershipId ||
      !requiredPermissions.every((permission) =>
        authority.permissions.has(permission),
      )
    ) {
      return null;
    }
    return {
      organisationId: authority.organisationId,
      actorUserId: authority.actorUserId,
      actorName,
      source: "membership",
      membershipId: authority.membershipId,
    };
  };

  router.use("/projects/:id/tender-context", privateResponse);

  router.get(
    "/projects/:id/tender-context",
    async (request, response, next) => {
      const access = resolveAccess(request);
      const scope = readScope(request);
      if (!canReadTenderContext(access) || !scope) {
        response.status(403).json({ error: "Tender context access denied" });
        return;
      }
      try {
        response.json(
          await service.readCentre(scope, String(request.params.id)),
        );
      } catch (error) {
        if (!sendKnownError(response, error)) next(error);
      }
    },
  );

  router.post(
    "/projects/:id/tender-context/versions",
    async (request, response, next) => {
      const access = resolveAccess(request);
      if (!canProposeTenderContext(access)) {
        response.status(403).json({ error: "Tender context write denied" });
        return;
      }
      const draft = parseTenderContextVersionDraft(request.body);
      if (!draft) {
        response.status(400).json({ error: "Invalid tender context request" });
        return;
      }
      try {
        const scope = await writeScope(request, PROPOSE_PERMISSIONS);
        if (!scope) {
          response.status(403).json({ error: "Tender context write denied" });
          return;
        }
        const result = await service.createContext(
          scope,
          String(request.params.id),
          draft,
        );
        await commitBeforeResponse(request);
        response.status(201).json(result);
      } catch (error) {
        if (!sendKnownError(response, error)) next(error);
      }
    },
  );

  router.post(
    "/projects/:id/tender-context/versions/:contextVersionId/review",
    async (request, response, next) => {
      const access = resolveAccess(request);
      if (!canReviewTenderContext(access)) {
        response.status(403).json({ error: "Tender context review denied" });
        return;
      }
      const expectedVersion = parseExpectedVersion(request.get("If-Match"));
      const draft = parseTenderReviewDraft(request.body);
      if (!expectedVersion || !draft) {
        response.status(400).json({
          error: "A valid review and If-Match version are required",
        });
        return;
      }
      try {
        const scope = await writeScope(request, REVIEW_PERMISSIONS);
        if (!scope) {
          response.status(403).json({ error: "Tender context review denied" });
          return;
        }
        const result = await service.reviewContext(
          scope,
          String(request.params.id),
          String(request.params.contextVersionId),
          expectedVersion,
          draft,
        );
        await commitBeforeResponse(request);
        response.json(result);
      } catch (error) {
        if (!sendKnownError(response, error)) next(error);
      }
    },
  );

  router.post(
    "/projects/:id/tender-context/versions/:contextVersionId/eligibility-passports",
    async (request, response, next) => {
      const access = resolveAccess(request);
      if (!canProposeTenderContext(access)) {
        response
          .status(403)
          .json({ error: "Eligibility passport write denied" });
        return;
      }
      if (!emptyBody(request.body)) {
        response.status(400).json({
          error: "Eligibility generation accepts no client decision fields",
        });
        return;
      }
      try {
        const scope = await writeScope(request, PROPOSE_PERMISSIONS);
        if (!scope) {
          response
            .status(403)
            .json({ error: "Eligibility passport write denied" });
          return;
        }
        const result = await service.createPassport(
          scope,
          String(request.params.id),
          String(request.params.contextVersionId),
        );
        await commitBeforeResponse(request);
        response.status(201).json(result);
      } catch (error) {
        if (!sendKnownError(response, error)) next(error);
      }
    },
  );

  router.post(
    "/projects/:id/tender-context/eligibility-passports/:passportRecordId/review",
    async (request, response, next) => {
      const access = resolveAccess(request);
      if (!canReviewTenderContext(access)) {
        response
          .status(403)
          .json({ error: "Eligibility passport review denied" });
        return;
      }
      const expectedVersion = parseExpectedVersion(request.get("If-Match"));
      const draft = parseTenderReviewDraft(request.body);
      if (!expectedVersion || !draft) {
        response.status(400).json({
          error: "A valid review and If-Match version are required",
        });
        return;
      }
      try {
        const scope = await writeScope(request, REVIEW_PERMISSIONS);
        if (!scope) {
          response
            .status(403)
            .json({ error: "Eligibility passport review denied" });
          return;
        }
        const result = await service.reviewPassport(
          scope,
          String(request.params.id),
          String(request.params.passportRecordId),
          expectedVersion,
          draft,
        );
        await commitBeforeResponse(request);
        response.json(result);
      } catch (error) {
        if (!sendKnownError(response, error)) next(error);
      }
    },
  );

  return router;
}
