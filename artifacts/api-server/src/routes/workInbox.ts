import { Router, type IRouter, type Request } from "express";
import { privateResponse } from "../middlewares/privateResponse";
import type { AccessContext } from "../middlewares/tenancy";
import type { CurrentDirectAuthority } from "../lib/directMembershipAuthority";
import {
  WORK_INBOX_DEFAULT_LIMIT,
  WORK_INBOX_MAX_LIMIT,
  WorkInboxUnavailableError,
  type WorkInboxSnapshot,
} from "../lib/workInbox/contracts";
import { readWorkInbox } from "../lib/workInbox/repository";
import {
  createBoundedLimitParser,
  resolveSuiteAuthorityDefaults,
} from "./suiteRouterKit";

export interface WorkInboxRouterDependencies {
  resolveAccess?: (request: Request) => AccessContext | undefined;
  resolveActorUserId?: (request: Request) => string | undefined;
  resolveAuthority?: (
    context: AccessContext | undefined,
    actorUserId: string | undefined,
  ) => Promise<CurrentDirectAuthority | null>;
  readInbox?: (
    authority: CurrentDirectAuthority,
    limit: number,
  ) => Promise<WorkInboxSnapshot>;
}

const parseLimit = createBoundedLimitParser(
  WORK_INBOX_DEFAULT_LIMIT,
  WORK_INBOX_MAX_LIMIT,
);

export function createWorkInboxRouter(
  dependencies: WorkInboxRouterDependencies = {},
): IRouter {
  const router: IRouter = Router();
  const {
    resolveAccess,
    resolveActorUserId: resolveActor,
    resolveAuthority,
  } = resolveSuiteAuthorityDefaults(dependencies);
  const readInbox = dependencies.readInbox ?? readWorkInbox;

  router.get(
    "/work-inbox",
    privateResponse,
    async (request, response, next) => {
      const requestedLimit = parseLimit(request.query.limit);
      if (requestedLimit === null) {
        response.status(400).json({ error: "Invalid bounded inbox limit" });
        return;
      }
      const authority = await resolveAuthority(
        resolveAccess(request),
        resolveActor(request),
      );
      if (!authority) {
        response.status(403).json({ error: "Direct work-inbox access denied" });
        return;
      }
      try {
        response.json(await readInbox(authority, requestedLimit));
      } catch (error) {
        if (error instanceof WorkInboxUnavailableError) {
          response.status(503).json({ error: "The work inbox is unavailable" });
          return;
        }
        next(error);
      }
    },
  );
  return router;
}

export default createWorkInboxRouter();
