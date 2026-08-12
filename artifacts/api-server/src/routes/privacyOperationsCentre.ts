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
  PRIVACY_OPERATIONS_DEFAULT_ITEMS,
  PRIVACY_OPERATIONS_MAX_ASSIGNEES,
  PRIVACY_OPERATIONS_MAX_ITEMS,
  PrivacyOperationsRepositoryUnavailableError,
  type PrivacyMutationOutcome,
  type PrivacyOperationsRepository,
  type PrivacyOperationsScope,
} from "../lib/privacyOperationsCentre/contracts";
import { postgresPrivacyOperationsRepository } from "../lib/privacyOperationsCentre/repository";
import {
  PRIVACY_OPERATIONS_AUTHORITY_NOTE,
  PrivacyOperationsValidationError,
  buildPrivacyOperationsDashboard,
  parsePrivacyConsentWithdrawalDraft,
  parsePrivacyDsrTriageDraft,
  parsePrivacyHoldReviewDraft,
  recordPrivacyConsentWithdrawal,
  recordPrivacyLegalHoldReview,
  triagePrivacyDsr,
} from "../lib/privacyOperationsCentre/service";

export interface PrivacyOperationsRouterOptions {
  repository?: PrivacyOperationsRepository;
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

function parseLimit(value: unknown): number | null {
  if (value === undefined) return PRIVACY_OPERATIONS_DEFAULT_ITEMS;
  if (typeof value !== "string" || !/^[1-9][0-9]?$/u.test(value)) return null;
  const limit = Number(value);
  return limit <= PRIVACY_OPERATIONS_MAX_ITEMS ? limit : null;
}

function sendUnavailable(response: Response, error: unknown): boolean {
  if (!(error instanceof PrivacyOperationsRepositoryUnavailableError)) {
    return false;
  }
  response.status(503).json({
    error: "Privacy operations evidence is unavailable",
    legalDecisionAutomated: false,
    authorityNote: PRIVACY_OPERATIONS_AUTHORITY_NOTE,
  });
  return true;
}

function sendMutationOutcome(
  response: Response,
  result: PrivacyMutationOutcome,
): void {
  if (result.outcome === "updated") {
    response.setHeader("ETag", `"${result.resultingVersion}"`);
    response.json({
      ...result,
      legalDecisionAutomated: false,
      authorityNote: PRIVACY_OPERATIONS_AUTHORITY_NOTE,
    });
    return;
  }
  const status = result.outcome === "not_found" ? 404 : 409;
  response.status(status).json({
    error:
      result.outcome === "not_found"
        ? "Privacy record was not found"
        : result.outcome === "version_conflict"
          ? "Privacy record changed; reload before recording a decision"
          : result.outcome === "assignee_unavailable"
            ? "The named assignee is not an active direct member"
            : "The privacy record is not in a reviewable state",
    code: result.outcome,
    legalDecisionAutomated: false,
    authorityNote: PRIVACY_OPERATIONS_AUTHORITY_NOTE,
  });
}

/**
 * Mount under `/api` after authentication and tenant-context middleware. The
 * default repository is the real tenant-RLS Postgres implementation; injected
 * repositories are intended for deterministic tests only.
 */
export function createPrivacyOperationsRouter(
  options: PrivacyOperationsRouterOptions = {},
): IRouter {
  const router: IRouter = Router();
  const repository = options.repository ?? postgresPrivacyOperationsRepository;
  const now = options.now ?? (() => new Date());
  const resolveAccess = options.resolveAccess ?? getAccessContext;
  const resolveActorUserId =
    options.resolveActorUserId ??
    ((request: Request) => getLocalUser(request)?.id);
  const resolveAuthority =
    options.resolveAuthority ?? resolveCurrentDirectAuthority;

  const authorisedScope = async (
    request: Request,
    permission: "privacy:read" | "privacy:manage",
  ): Promise<PrivacyOperationsScope | null> => {
    const authority = await resolveAuthority(
      resolveAccess(request),
      resolveActorUserId(request),
    );
    return authority?.permissions.has(permission)
      ? {
          organisationId: authority.organisationId,
          actorUserId: authority.actorUserId,
        }
      : null;
  };

  router.use("/privacy-operations", privateResponse);

  router.get(
    "/privacy-operations/assignees",
    async (request, response, next) => {
      const requestScope = await authorisedScope(request, "privacy:manage");
      if (!requestScope) {
        response
          .status(403)
          .json({ error: "Privacy operations management denied" });
        return;
      }
      try {
        const assignees = await repository.listAssignees(
          requestScope,
          PRIVACY_OPERATIONS_MAX_ASSIGNEES + 1,
        );
        if (assignees.length > PRIVACY_OPERATIONS_MAX_ASSIGNEES) {
          throw new PrivacyOperationsRepositoryUnavailableError();
        }
        response.json({
          organisationId: requestScope.organisationId,
          items: assignees,
          limit: PRIVACY_OPERATIONS_MAX_ASSIGNEES,
          truncated: false,
        });
      } catch (error) {
        if (!sendUnavailable(response, error)) next(error);
      }
    },
  );

  router.get("/privacy-operations", async (request, response, next) => {
    const requestScope = await authorisedScope(request, "privacy:read");
    if (!requestScope) {
      response.status(403).json({ error: "Privacy operations access denied" });
      return;
    }
    const limit = parseLimit(request.query.limit);
    if (!limit) {
      response.status(400).json({ error: "Invalid bounded dashboard limit" });
      return;
    }
    try {
      const raw = await repository.readDashboard(requestScope, limit);
      response.json(
        buildPrivacyOperationsDashboard({
          raw,
          scope: requestScope,
          limit,
          now: now(),
        }),
      );
    } catch (error) {
      if (!sendUnavailable(response, error)) next(error);
    }
  });

  router.post(
    "/privacy-operations/data-subject-requests/:id/triage",
    async (request, response, next) => {
      const requestScope = await authorisedScope(request, "privacy:manage");
      if (!requestScope) {
        response
          .status(403)
          .json({ error: "Privacy operations management denied" });
        return;
      }
      const expectedVersion = parseExpectedVersion(request.get("If-Match"));
      if (!expectedVersion) {
        response.status(428).json({ error: "If-Match version is required" });
        return;
      }
      const draft = parsePrivacyDsrTriageDraft(request.body);
      if (!draft) {
        response.status(400).json({ error: "Invalid DSR triage evidence" });
        return;
      }
      try {
        sendMutationOutcome(
          response,
          await triagePrivacyDsr({
            repository,
            scope: requestScope,
            id: String(request.params.id),
            expectedVersion,
            draft,
            now: now(),
          }),
        );
      } catch (error) {
        if (error instanceof PrivacyOperationsValidationError) {
          response
            .status(400)
            .json({ error: "Invalid triage boundary", code: error.code });
          return;
        }
        if (!sendUnavailable(response, error)) next(error);
      }
    },
  );

  router.post(
    "/privacy-operations/consent-records/:id/withdrawal",
    async (request, response, next) => {
      const requestScope = await authorisedScope(request, "privacy:manage");
      if (!requestScope) {
        response
          .status(403)
          .json({ error: "Privacy operations management denied" });
        return;
      }
      const expectedVersion = parseExpectedVersion(request.get("If-Match"));
      if (!expectedVersion) {
        response.status(428).json({ error: "If-Match version is required" });
        return;
      }
      const draft = parsePrivacyConsentWithdrawalDraft(request.body);
      if (!draft) {
        response
          .status(400)
          .json({ error: "Invalid consent withdrawal evidence" });
        return;
      }
      try {
        sendMutationOutcome(
          response,
          await recordPrivacyConsentWithdrawal({
            repository,
            scope: requestScope,
            id: String(request.params.id),
            expectedVersion,
            draft,
            now: now(),
          }),
        );
      } catch (error) {
        if (error instanceof PrivacyOperationsValidationError) {
          response
            .status(400)
            .json({ error: "Invalid withdrawal boundary", code: error.code });
          return;
        }
        if (!sendUnavailable(response, error)) next(error);
      }
    },
  );

  router.post(
    "/privacy-operations/legal-holds/:id/reviews",
    async (request, response, next) => {
      const requestScope = await authorisedScope(request, "privacy:manage");
      if (!requestScope) {
        response
          .status(403)
          .json({ error: "Privacy operations management denied" });
        return;
      }
      const expectedVersion = parseExpectedVersion(request.get("If-Match"));
      if (!expectedVersion) {
        response.status(428).json({ error: "If-Match version is required" });
        return;
      }
      const draft = parsePrivacyHoldReviewDraft(request.body);
      if (!draft) {
        response.status(400).json({ error: "Invalid hold review evidence" });
        return;
      }
      try {
        sendMutationOutcome(
          response,
          await recordPrivacyLegalHoldReview({
            repository,
            scope: requestScope,
            id: String(request.params.id),
            expectedVersion,
            draft,
            now: now(),
          }),
        );
      } catch (error) {
        if (error instanceof PrivacyOperationsValidationError) {
          response
            .status(400)
            .json({ error: "Invalid hold-review boundary", code: error.code });
          return;
        }
        if (!sendUnavailable(response, error)) next(error);
      }
    },
  );

  return router;
}
