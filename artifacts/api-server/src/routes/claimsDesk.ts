import {
  Router,
  type IRouter,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { getLocalUser } from "../middlewares/auth";
import {
  getAccessContext,
  parseExpectedVersion,
  type AccessContext,
} from "../middlewares/tenancy";
import {
  CLAIMS_DESK_MANAGE_PERMISSION,
  CLAIMS_DESK_READ_PERMISSION,
  ClaimsDeskProjectAccessError,
  ClaimsDeskRepositoryUnavailableError,
  type ClaimsDeskMutationOutcome,
  type ClaimsDeskRepository,
  type ClaimsDeskScope,
} from "../lib/claimsDesk/contracts";
import { postgresClaimsDeskRepository } from "../lib/claimsDesk/repository";
import {
  CLAIMS_DESK_AUTHORITY_NOTE,
  mutationHttpStatus,
  parseClaimsDeskCreateDraft,
  parseClaimsDeskTransitionDraft,
} from "../lib/claimsDesk/service";
import {
  resolveCurrentDirectAuthority,
  type CurrentDirectAuthority,
} from "../lib/directMembershipAuthority";

export interface ClaimsDeskRouterOptions {
  repository?: ClaimsDeskRepository;
  now?: () => Date;
  resolveAccess?: (request: Request) => AccessContext | undefined;
  resolveActorUserId?: (request: Request) => string | undefined;
  resolveAuthority?: (
    context: AccessContext | undefined,
    actorUserId: string | undefined,
  ) => Promise<CurrentDirectAuthority | null>;
}

function privateResponse(
  _request: Request,
  response: Response,
  next: NextFunction,
): void {
  response.setHeader("Cache-Control", "private, no-store");
  response.vary("X-Valo-Organisation-Id");
  next();
}

async function authorisedScopeFor(
  request: Request,
  permission:
    | typeof CLAIMS_DESK_READ_PERMISSION
    | typeof CLAIMS_DESK_MANAGE_PERMISSION,
  resolveAccess: (request: Request) => AccessContext | undefined,
  resolveActorUserId: (request: Request) => string | undefined,
  resolveAuthority: (
    context: AccessContext | undefined,
    actorUserId: string | undefined,
  ) => Promise<CurrentDirectAuthority | null>,
): Promise<ClaimsDeskScope | null> {
  const projectId = request.params.projectId;
  const authority = await resolveAuthority(
    resolveAccess(request),
    resolveActorUserId(request),
  );
  return authority?.permissions.has(permission) && typeof projectId === "string"
    ? {
        organisationId: authority.organisationId,
        projectId,
        actorUserId: authority.actorUserId,
        actorMembershipId: authority.membershipId,
      }
    : null;
}

function sendOutcome(
  response: Response,
  outcome: ClaimsDeskMutationOutcome,
): void {
  const status = mutationHttpStatus(outcome);
  if (outcome.outcome === "created" || outcome.outcome === "updated") {
    response.setHeader("ETag", `"${outcome.record.version}"`);
    response.status(status).json({
      ...outcome,
      legalConclusionAutomated: false,
      noticeDispatched: false,
      paymentMutated: false,
      authorityNote: CLAIMS_DESK_AUTHORITY_NOTE,
    });
    return;
  }
  response.status(status).json({
    error: outcome.outcome,
    legalConclusionAutomated: false,
    noticeDispatched: false,
    paymentMutated: false,
    authorityNote: CLAIMS_DESK_AUTHORITY_NOTE,
  });
}

function handleError(
  error: unknown,
  response: Response,
  next: NextFunction,
): void {
  if (error instanceof ClaimsDeskProjectAccessError) {
    response.status(error.code === "not_found" ? 404 : 409).json({
      error: error.code,
      authorityNote: CLAIMS_DESK_AUTHORITY_NOTE,
    });
    return;
  }
  if (error instanceof ClaimsDeskRepositoryUnavailableError) {
    response.status(503).json({
      error: "Claims Desk evidence is unavailable",
      authorityNote: CLAIMS_DESK_AUTHORITY_NOTE,
    });
    return;
  }
  next(error);
}

/**
 * Mount under `/api` after authentication and tenant/project governance.
 * The default is the real tenant-RLS repository; injection exists for tests.
 */
export function createClaimsDeskRouter(
  options: ClaimsDeskRouterOptions = {},
): IRouter {
  const router: IRouter = Router();
  const repository = options.repository ?? postgresClaimsDeskRepository;
  const now = options.now ?? (() => new Date());
  const resolveAccess = options.resolveAccess ?? getAccessContext;
  const resolveActorUserId =
    options.resolveActorUserId ??
    ((request: Request) => getLocalUser(request)?.id);
  const resolveAuthority =
    options.resolveAuthority ?? resolveCurrentDirectAuthority;

  router.use("/projects/:projectId/claims-desk", privateResponse);

  router.get(
    "/projects/:projectId/claims-desk",
    async (request, response, next) => {
      const scope = await authorisedScopeFor(
        request,
        CLAIMS_DESK_READ_PERMISSION,
        resolveAccess,
        resolveActorUserId,
        resolveAuthority,
      );
      if (!scope) {
        response.status(403).json({ error: "Claims Desk access denied" });
        return;
      }
      try {
        response.json(await repository.readSnapshot(scope, now()));
      } catch (error) {
        handleError(error, response, next);
      }
    },
  );

  router.post(
    "/projects/:projectId/claims-desk/records",
    async (request, response, next) => {
      const scope = await authorisedScopeFor(
        request,
        CLAIMS_DESK_MANAGE_PERMISSION,
        resolveAccess,
        resolveActorUserId,
        resolveAuthority,
      );
      if (!scope) {
        response.status(403).json({ error: "Claims Desk management denied" });
        return;
      }
      const draft = parseClaimsDeskCreateDraft(request.body);
      if (!draft) {
        response
          .status(400)
          .json({ error: "Invalid bounded Claims Desk record" });
        return;
      }
      try {
        sendOutcome(
          response,
          await repository.createRecord(scope, draft, now()),
        );
      } catch (error) {
        handleError(error, response, next);
      }
    },
  );

  router.post(
    "/projects/:projectId/claims-desk/records/:recordId/transitions",
    async (request, response, next) => {
      const scope = await authorisedScopeFor(
        request,
        CLAIMS_DESK_MANAGE_PERMISSION,
        resolveAccess,
        resolveActorUserId,
        resolveAuthority,
      );
      if (!scope) {
        response.status(403).json({ error: "Claims Desk management denied" });
        return;
      }
      const expectedVersion = parseExpectedVersion(request.get("If-Match"));
      if (!expectedVersion) {
        response.status(428).json({ error: "If-Match version is required" });
        return;
      }
      const draft = parseClaimsDeskTransitionDraft(request.body);
      const recordId = request.params.recordId;
      if (!draft || typeof recordId !== "string") {
        response.status(400).json({ error: "Invalid controlled transition" });
        return;
      }
      try {
        sendOutcome(
          response,
          await repository.transitionRecord(
            scope,
            recordId,
            expectedVersion,
            draft,
            now(),
          ),
        );
      } catch (error) {
        handleError(error, response, next);
      }
    },
  );

  return router;
}

export const claimsDeskRouter = createClaimsDeskRouter();
