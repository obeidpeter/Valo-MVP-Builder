import { Router, type IRouter, type Request } from "express";
import { privateResponse } from "../middlewares/privateResponse";
import type { AccessContext } from "../middlewares/tenancy";
import {
  CANONICAL_EVIDENCE_DEFAULT_LIMIT,
  CANONICAL_EVIDENCE_MAX_LIMIT,
  CanonicalEvidenceUnavailableError,
  listCanonicalEvidenceOptions,
  type CanonicalEvidenceOption,
} from "../lib/canonicalEvidence";
import type { CurrentDirectAuthority } from "../lib/directMembershipAuthority";
import {
  createBoundedLimitParser,
  resolveSuiteAuthorityDefaults,
} from "./suiteRouterKit";

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

const limit = createBoundedLimitParser(
  CANONICAL_EVIDENCE_DEFAULT_LIMIT,
  CANONICAL_EVIDENCE_MAX_LIMIT,
);

export function createCanonicalEvidenceOptionsRouter(
  dependencies: CanonicalEvidenceOptionsRouterDependencies = {},
): IRouter {
  const router: IRouter = Router();
  const {
    resolveAccess,
    resolveActorUserId: resolveActor,
    resolveAuthority,
  } = resolveSuiteAuthorityDefaults(dependencies);
  const listOptions = dependencies.listOptions ?? listCanonicalEvidenceOptions;

  router.get(
    "/canonical-evidence-options",
    privateResponse,
    async (request, response, next) => {
      const authority = await resolveAuthority(
        resolveAccess(request),
        resolveActor(request),
      );
      if (!authority?.permissions.has("document:read")) {
        response
          .status(403)
          .json({ error: "Canonical evidence access denied" });
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
    },
  );
  return router;
}

export default createCanonicalEvidenceOptionsRouter();
