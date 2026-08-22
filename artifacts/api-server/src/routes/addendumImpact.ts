import { Router, type IRouter, type Request, type Response } from "express";
import { getLocalUser } from "../middlewares/auth";
import { commitTenantDatabaseBeforeResponse } from "../middlewares/databaseTenancy";
import { privateResponse } from "../middlewares/privateResponse";
import { getAccessContext, type AccessContext } from "../middlewares/tenancy";
import {
  ADDENDUM_IMPACT_AUTHORITY_NOTE,
  AddendumImpactRepositoryUnavailableError,
  type AddendumImpactRepository,
  type AddendumImpactScope,
  type AddendumImpactSelection,
} from "../lib/intelligence/addendumImpactContracts";
import {
  AddendumImpactService,
  AddendumImpactServiceError,
  type AddendumImpactApplyCommand,
  type AddendumImpactReviewCommand,
} from "../lib/intelligence/addendumImpactService";
import { createDrizzleAddendumImpactRepository } from "../lib/intelligence/addendumImpactDrizzleRepository";
import {
  resolveCurrentDirectAuthority,
  type CurrentDirectAuthority,
} from "../lib/directMembershipAuthority";
import type { Permission } from "../lib/permissions";

const READ_PERMISSIONS = [
  "project:read",
  "document:read",
  "requirement:read",
  "draft:read",
  "package:read",
  "report:read",
] as const;

const APPLY_PERMISSIONS = [
  "project:update",
  "requirement:review",
  "package:generate",
  "report:generate",
] as const;

export interface AddendumImpactRouterOptions {
  readonly repository?: AddendumImpactRepository;
  readonly service?: Pick<
    AddendumImpactService,
    "getCentre" | "review" | "apply"
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

export function canReadAddendumImpact(
  context: AccessContext | undefined,
): boolean {
  return Boolean(
    context &&
    (context.source === "membership" || context.source === "partner") &&
    READ_PERMISSIONS.every((permission) => context.permissions.has(permission)),
  );
}

export function canReviewAddendumImpact(
  context: AccessContext | undefined,
): boolean {
  return Boolean(
    canReadAddendumImpact(context) &&
    context?.source === "membership" &&
    context.permissions.has("intelligence:review"),
  );
}

export function canApplyAddendumImpact(
  context: AccessContext | undefined,
): boolean {
  return Boolean(
    canReadAddendumImpact(context) &&
    context?.source === "membership" &&
    APPLY_PERMISSIONS.every((permission) =>
      context.permissions.has(permission),
    ),
  );
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function optionalString(
  value: Record<string, unknown>,
  key: string,
): string | undefined | null {
  const candidate = value[key];
  if (candidate === undefined) return undefined;
  return typeof candidate === "string" ? candidate : null;
}

function parseSelection(
  query: Request["query"],
): AddendumImpactSelection | null {
  const baselineVersionId = query.baselineVersionId;
  const revisionVersionId = query.revisionVersionId;
  if (
    Object.keys(query).some(
      (key) => !["baselineVersionId", "revisionVersionId"].includes(key),
    ) ||
    (baselineVersionId !== undefined &&
      typeof baselineVersionId !== "string") ||
    (revisionVersionId !== undefined && typeof revisionVersionId !== "string")
  ) {
    return null;
  }
  return {
    ...(typeof baselineVersionId === "string" ? { baselineVersionId } : {}),
    ...(typeof revisionVersionId === "string" ? { revisionVersionId } : {}),
  };
}

function parseReviewBody(value: unknown): AddendumImpactReviewCommand | null {
  if (!plainObject(value)) return null;
  const allowed = [
    "baselineVersionId",
    "revisionVersionId",
    "assessmentId",
    "radarId",
    "expectedImpactManifestSha256",
    "expectedAssessmentVersion",
    "decision",
    "reason",
  ] as const;
  const baselineVersionId = optionalString(value, "baselineVersionId");
  const revisionVersionId = optionalString(value, "revisionVersionId");
  if (
    !exactKeys(value, allowed) ||
    typeof baselineVersionId !== "string" ||
    typeof revisionVersionId !== "string" ||
    typeof value.assessmentId !== "string" ||
    typeof value.radarId !== "string" ||
    typeof value.expectedImpactManifestSha256 !== "string" ||
    !Number.isSafeInteger(value.expectedAssessmentVersion) ||
    !["accepted", "changes_requested", "rejected"].includes(
      String(value.decision),
    ) ||
    typeof value.reason !== "string"
  ) {
    return null;
  }
  return {
    baselineVersionId,
    revisionVersionId,
    assessmentId: value.assessmentId,
    radarId: value.radarId,
    expectedImpactManifestSha256: value.expectedImpactManifestSha256,
    expectedAssessmentVersion: value.expectedAssessmentVersion as number,
    decision: value.decision as AddendumImpactReviewCommand["decision"],
    reason: value.reason,
  };
}

function parseApplyBody(value: unknown): AddendumImpactApplyCommand | null {
  if (!plainObject(value)) return null;
  const allowed = [
    "baselineVersionId",
    "revisionVersionId",
    "assessmentId",
    "radarId",
    "expectedImpactManifestSha256",
    "expectedAssessmentVersion",
    "reason",
    "confirmation",
  ] as const;
  const baselineVersionId = optionalString(value, "baselineVersionId");
  const revisionVersionId = optionalString(value, "revisionVersionId");
  if (
    !exactKeys(value, allowed) ||
    typeof baselineVersionId !== "string" ||
    typeof revisionVersionId !== "string" ||
    typeof value.assessmentId !== "string" ||
    typeof value.radarId !== "string" ||
    typeof value.expectedImpactManifestSha256 !== "string" ||
    !Number.isSafeInteger(value.expectedAssessmentVersion) ||
    typeof value.reason !== "string" ||
    typeof value.confirmation !== "string"
  ) {
    return null;
  }
  return {
    baselineVersionId,
    revisionVersionId,
    assessmentId: value.assessmentId,
    radarId: value.radarId,
    expectedImpactManifestSha256: value.expectedImpactManifestSha256,
    expectedAssessmentVersion: value.expectedAssessmentVersion as number,
    reason: value.reason,
    confirmation: value.confirmation,
  };
}

function sendKnownError(response: Response, error: unknown): boolean {
  if (error instanceof AddendumImpactRepositoryUnavailableError) {
    response.status(503).json({
      error: "Addendum impact persistence is not connected",
      authorityNote: ADDENDUM_IMPACT_AUTHORITY_NOTE,
    });
    return true;
  }
  if (!(error instanceof AddendumImpactServiceError)) return false;
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
 * Mount below authenticated tenant middleware. The persistence adapter owns
 * the final tenant recheck, optimistic target locks, atomic mutations and
 * audit-chain write. This router never treats a review as an apply command.
 */
export function createAddendumImpactRouter(
  options: AddendumImpactRouterOptions = {},
): IRouter {
  const router: IRouter = Router();
  const service =
    options.service ??
    new AddendumImpactService(
      options.repository ?? createDrizzleAddendumImpactRepository(),
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

  const scope = (request: Request): AddendumImpactScope | null => {
    const context = resolveAccess(request);
    const actor = resolveActor(request);
    const name = actor?.name?.trim();
    return context && actor && name
      ? {
          organisationId: context.organisationId,
          actorUserId: actor.id,
          actorName: name,
          source: context.source === "membership" ? "membership" : "partner",
          membershipId:
            context.source === "membership" ? context.membershipId : null,
        }
      : null;
  };

  const mutationScope = async (
    request: Request,
    requiredPermissions: readonly Permission[],
  ): Promise<AddendumImpactScope | null> => {
    const context = resolveAccess(request);
    const actor = resolveActor(request);
    const name = actor?.name?.trim();
    const authority = await resolveDirectAuthority(request);
    if (
      !context ||
      !actor ||
      !name ||
      context.source !== "membership" ||
      !context.membershipId ||
      !authority ||
      authority.organisationId !== context.organisationId ||
      authority.actorUserId !== actor.id ||
      authority.membershipId !== context.membershipId ||
      !requiredPermissions.every((permission) =>
        authority.permissions.has(permission),
      )
    ) {
      return null;
    }
    return {
      organisationId: authority.organisationId,
      actorUserId: authority.actorUserId,
      actorName: name,
      source: "membership",
      membershipId: authority.membershipId,
    };
  };

  router.use("/projects/:id/addendum-impact", privateResponse);

  router.get(
    "/projects/:id/addendum-impact",
    async (request, response, next) => {
      const context = resolveAccess(request);
      const requestScope = scope(request);
      const selection = parseSelection(request.query);
      if (!canReadAddendumImpact(context) || !requestScope) {
        response.status(403).json({ error: "Addendum impact access denied" });
        return;
      }
      if (!selection) {
        response
          .status(400)
          .json({ error: "Invalid source-version selection" });
        return;
      }
      try {
        response.json(
          await service.getCentre(
            requestScope,
            String(request.params.id),
            selection,
          ),
        );
      } catch (error) {
        if (!sendKnownError(response, error)) next(error);
      }
    },
  );

  router.post(
    "/projects/:id/addendum-impact/review",
    async (request, response, next) => {
      const context = resolveAccess(request);
      const body = parseReviewBody(request.body);
      if (!canReviewAddendumImpact(context) || !scope(request)) {
        response.status(403).json({ error: "Addendum review access denied" });
        return;
      }
      if (!body) {
        response.status(400).json({ error: "Invalid addendum review request" });
        return;
      }
      try {
        const requestScope = await mutationScope(request, [
          ...READ_PERMISSIONS,
          "intelligence:review",
        ]);
        if (!requestScope) {
          response.status(403).json({ error: "Addendum review access denied" });
          return;
        }
        const result = await service.review(
          requestScope,
          String(request.params.id),
          body,
        );
        await commitBeforeResponse(request);
        response.json(result);
      } catch (error) {
        if (!sendKnownError(response, error)) next(error);
      }
    },
  );

  router.post(
    "/projects/:id/addendum-impact/apply",
    async (request, response, next) => {
      const context = resolveAccess(request);
      const body = parseApplyBody(request.body);
      if (!canApplyAddendumImpact(context) || !scope(request)) {
        response
          .status(403)
          .json({ error: "Controlled reopening access denied" });
        return;
      }
      if (!body) {
        response
          .status(400)
          .json({ error: "Invalid controlled reopening request" });
        return;
      }
      try {
        const requestScope = await mutationScope(request, [
          ...READ_PERMISSIONS,
          ...APPLY_PERMISSIONS,
        ]);
        if (!requestScope) {
          response
            .status(403)
            .json({ error: "Controlled reopening access denied" });
          return;
        }
        const result = await service.apply(
          requestScope,
          String(request.params.id),
          body,
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

export default createAddendumImpactRouter();
