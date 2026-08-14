import { Router, type IRouter, type Request } from "express";
import { getLocalUser } from "../middlewares/auth";
import { getAccessContext, type AccessContext } from "../middlewares/tenancy";
import {
  CANONICAL_EVIDENCE_DEFAULT_LIMIT,
  CANONICAL_EVIDENCE_MAX_LIMIT,
  CanonicalEvidenceUnavailableError,
  listCanonicalEvidenceOptions,
  type CanonicalEvidenceOption,
} from "../lib/canonicalEvidence";
import {
  resolveCurrentDirectAuthority,
  type CurrentDirectAuthority,
} from "../lib/directMembershipAuthority";

import { UUID_PATTERN } from "../lib/identifierPatterns";

export interface CanonicalEvidenceOptionsRouterDependencies {
  resolveAccess?: (request: Request) => AccessContext | undefined;
  resolveActorUserId?: (request: Request) => string | undefined;
  resolveAuthority?: (
    context: AccessContext | undefined,
    actorUserId: string | undefined,
  ) => Promise<CurrentDirectAuthority | null>;
  listOptions?: (
    scope: { organisationId: string; projectId?: string },
    limit: number,
  ) => Promise<{ items: CanonicalEvidenceOption[]; truncated: boolean }>;
}

function limit(value: unknown): number | null {
  if (value === undefined) return CANONICAL_EVIDENCE_DEFAULT_LIMIT;
  if (typeof value !== "string" || !/^[1-9][0-9]{0,2}$/u.test(value)) {
    return null;
  }
  const parsed = Number(value);
  return parsed <= CANONICAL_EVIDENCE_MAX_LIMIT ? parsed : null;
}

export function createCanonicalEvidenceOptionsRouter(
  dependencies: CanonicalEvidenceOptionsRouterDependencies = {},
): IRouter {
  const router: IRouter = Router();
  const resolveAccess = dependencies.resolveAccess ?? getAccessContext;
  const resolveActor =
    dependencies.resolveActorUserId ??
    ((request: Request) => getLocalUser(request)?.id);
  const resolveAuthority =
    dependencies.resolveAuthority ?? resolveCurrentDirectAuthority;
  const listOptions = dependencies.listOptions ?? listCanonicalEvidenceOptions;

  router.get("/canonical-evidence-options", async (request, response, next) => {
    response.setHeader("Cache-Control", "private, no-store");
    response.vary("X-Valo-Organisation-Id");
    const authority = await resolveAuthority(
      resolveAccess(request),
      resolveActor(request),
    );
    if (!authority?.permissions.has("document:read")) {
      response.status(403).json({ error: "Canonical evidence access denied" });
      return;
    }
    const requestedLimit = limit(request.query.limit);
    const projectId = request.query.projectId;
    if (
      requestedLimit === null ||
      (projectId !== undefined &&
        (typeof projectId !== "string" || !UUID_PATTERN.test(projectId)))
    ) {
      response.status(400).json({ error: "Invalid evidence option scope" });
      return;
    }
    try {
      const result = await listOptions(
        {
          organisationId: authority.organisationId,
          ...(typeof projectId === "string" ? { projectId } : {}),
        },
        requestedLimit,
      );
      response.json({
        organisationId: authority.organisationId,
        projectId: typeof projectId === "string" ? projectId : null,
        limit: requestedLimit,
        truncated: result.truncated,
        items: result.items,
      });
    } catch (error) {
      if (error instanceof CanonicalEvidenceUnavailableError) {
        response
          .status(503)
          .json({ error: "Canonical evidence options are unavailable" });
        return;
      }
      next(error);
    }
  });
  return router;
}

export default createCanonicalEvidenceOptionsRouter();
