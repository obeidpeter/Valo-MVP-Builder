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
  resolveCurrentDirectAuthority,
  type CurrentDirectAuthority,
} from "../lib/directMembershipAuthority";
import {
  EVIDENCE_RENEWAL_AUTHORITY_NOTE,
  EVIDENCE_RENEWAL_BOUNDS,
  EVIDENCE_RENEWAL_MANAGE_PERMISSION,
  EVIDENCE_RENEWAL_READ_PERMISSION,
  EVIDENCE_RENEWAL_VERIFY_PERMISSION,
  EvidenceRenewalProjectAccessError,
  EvidenceRenewalUnavailableError,
  evidenceRenewalMutationHttpStatus,
  parseEvidenceRenewalCreateDraft,
  parseEvidenceRenewalReviewDraft,
  parseEvidenceRenewalStageDraft,
  postgresEvidenceRenewalRepository,
  type EvidenceRenewalMutationOutcome,
  type EvidenceRenewalRepository,
  type EvidenceRenewalScope,
} from "../lib/evidenceRenewal";
import { createBoundedJsonBody } from "./boundedJsonBody";

export interface EvidenceRenewalRouterOptions {
  repository?: EvidenceRenewalRepository;
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
    | typeof EVIDENCE_RENEWAL_READ_PERMISSION
    | typeof EVIDENCE_RENEWAL_MANAGE_PERMISSION
    | typeof EVIDENCE_RENEWAL_VERIFY_PERMISSION,
  resolveAccess: (request: Request) => AccessContext | undefined,
  resolveActorUserId: (request: Request) => string | undefined,
  resolveAuthority: (
    context: AccessContext | undefined,
    actorUserId: string | undefined,
  ) => Promise<CurrentDirectAuthority | null>,
): Promise<EvidenceRenewalScope | null> {
  const authority = await resolveAuthority(
    resolveAccess(request),
    resolveActorUserId(request),
  );
  const projectId = request.params.projectId;
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
  outcome: EvidenceRenewalMutationOutcome,
): void {
  const status = evidenceRenewalMutationHttpStatus(outcome);
  if (outcome.outcome === "created" || outcome.outcome === "updated") {
    response.setHeader("ETag", `"${outcome.plan.version}"`);
    response.status(status).json({
      ...outcome,
      externalMessageSent: false,
      authorityNote: EVIDENCE_RENEWAL_AUTHORITY_NOTE,
    });
    return;
  }
  response.status(status).json({
    error: outcome.outcome,
    externalMessageSent: false,
    authorityNote: EVIDENCE_RENEWAL_AUTHORITY_NOTE,
  });
}

function handleError(
  error: unknown,
  response: Response,
  next: NextFunction,
): void {
  if (error instanceof EvidenceRenewalProjectAccessError) {
    response.status(error.code === "not_found" ? 404 : 409).json({
      error: error.code,
      externalMessageSent: false,
      authorityNote: EVIDENCE_RENEWAL_AUTHORITY_NOTE,
    });
    return;
  }
  if (error instanceof EvidenceRenewalUnavailableError) {
    response.status(503).json({
      error: "Evidence renewal records are unavailable",
      externalMessageSent: false,
      authorityNote: EVIDENCE_RENEWAL_AUTHORITY_NOTE,
    });
    return;
  }
  next(error);
}

/** Mount under `/api` after authenticated tenant-database governance. */
export function createEvidenceRenewalRouter(
  options: EvidenceRenewalRouterOptions = {},
): IRouter {
  const router: IRouter = Router();
  const repository = options.repository ?? postgresEvidenceRenewalRepository;
  const now = options.now ?? (() => new Date());
  const resolveAccess = options.resolveAccess ?? getAccessContext;
  const resolveActorUserId =
    options.resolveActorUserId ??
    ((request: Request) => getLocalUser(request)?.id);
  const resolveAuthority =
    options.resolveAuthority ?? resolveCurrentDirectAuthority;
  const boundedBody = createBoundedJsonBody(
    EVIDENCE_RENEWAL_BOUNDS.requestBodyBytes,
    "evidence-renewal",
  );

  router.use(
    "/projects/:projectId/evidence-renewals",
    privateResponse,
    boundedBody,
  );

  router.get(
    "/projects/:projectId/evidence-renewals",
    async (request, response, next) => {
      const scope = await authorisedScopeFor(
        request,
        EVIDENCE_RENEWAL_READ_PERMISSION,
        resolveAccess,
        resolveActorUserId,
        resolveAuthority,
      );
      if (!scope) {
        response.status(403).json({ error: "Evidence renewal access denied" });
        return;
      }
      try {
        response.json(await repository.readSnapshot(scope, now()));
      } catch (error) {
        handleError(error, response, next);
      }
    },
  );

  router.get(
    "/projects/:projectId/evidence-renewals/authorities",
    async (request, response, next) => {
      const scope = await authorisedScopeFor(
        request,
        EVIDENCE_RENEWAL_READ_PERMISSION,
        resolveAccess,
        resolveActorUserId,
        resolveAuthority,
      );
      if (!scope) {
        response.status(403).json({ error: "Evidence renewal access denied" });
        return;
      }
      try {
        response.json(await repository.listAuthorities(scope, now()));
      } catch (error) {
        handleError(error, response, next);
      }
    },
  );

  router.post(
    "/projects/:projectId/evidence-renewals",
    async (request, response, next) => {
      const scope = await authorisedScopeFor(
        request,
        EVIDENCE_RENEWAL_MANAGE_PERMISSION,
        resolveAccess,
        resolveActorUserId,
        resolveAuthority,
      );
      if (!scope) {
        response
          .status(403)
          .json({ error: "Evidence renewal management denied" });
        return;
      }
      const draft = parseEvidenceRenewalCreateDraft(request.body);
      if (!draft) {
        response.status(400).json({ error: "Invalid bounded renewal plan" });
        return;
      }
      try {
        sendOutcome(response, await repository.createPlan(scope, draft, now()));
      } catch (error) {
        handleError(error, response, next);
      }
    },
  );

  router.post(
    "/projects/:projectId/evidence-renewals/:planId/staged-replacement",
    async (request, response, next) => {
      const scope = await authorisedScopeFor(
        request,
        EVIDENCE_RENEWAL_MANAGE_PERMISSION,
        resolveAccess,
        resolveActorUserId,
        resolveAuthority,
      );
      if (!scope) {
        response
          .status(403)
          .json({ error: "Evidence renewal management denied" });
        return;
      }
      const expectedVersion = parseExpectedVersion(request.get("If-Match"));
      if (!expectedVersion) {
        response.status(428).json({ error: "If-Match version is required" });
        return;
      }
      const draft = parseEvidenceRenewalStageDraft(request.body);
      const planId = request.params.planId;
      if (!draft || typeof planId !== "string") {
        response.status(400).json({ error: "Invalid staged replacement" });
        return;
      }
      try {
        sendOutcome(
          response,
          await repository.stageReplacement(
            scope,
            planId,
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

  router.post(
    "/projects/:projectId/evidence-renewals/:planId/review",
    async (request, response, next) => {
      const scope = await authorisedScopeFor(
        request,
        EVIDENCE_RENEWAL_VERIFY_PERMISSION,
        resolveAccess,
        resolveActorUserId,
        resolveAuthority,
      );
      if (!scope) {
        response.status(403).json({ error: "Evidence renewal review denied" });
        return;
      }
      const expectedVersion = parseExpectedVersion(request.get("If-Match"));
      if (!expectedVersion) {
        response.status(428).json({ error: "If-Match version is required" });
        return;
      }
      const draft = parseEvidenceRenewalReviewDraft(request.body);
      const planId = request.params.planId;
      if (!draft || typeof planId !== "string") {
        response.status(400).json({ error: "Invalid independent review" });
        return;
      }
      try {
        sendOutcome(
          response,
          await repository.reviewReplacement(
            scope,
            planId,
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

export default createEvidenceRenewalRouter;
