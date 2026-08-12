import { Router, type IRouter, type Request } from "express";
import { getLocalUser } from "../middlewares/auth";
import { getAccessContext, type AccessContext } from "../middlewares/tenancy";
import {
  resolveCurrentDirectAuthority,
  type CurrentDirectAuthority,
} from "../lib/directMembershipAuthority";
import {
  WORK_INBOX_DEFAULT_LIMIT,
  WORK_INBOX_MAX_LIMIT,
  WorkInboxUnavailableError,
  type WorkInboxSnapshot,
} from "../lib/workInbox/contracts";
import { readWorkInbox } from "../lib/workInbox/repository";

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

function parseLimit(value: unknown): number | null {
  if (value === undefined) return WORK_INBOX_DEFAULT_LIMIT;
  if (typeof value !== "string" || !/^[1-9][0-9]{0,2}$/u.test(value)) {
    return null;
  }
  const parsed = Number(value);
  return parsed <= WORK_INBOX_MAX_LIMIT ? parsed : null;
}

export function createWorkInboxRouter(
  dependencies: WorkInboxRouterDependencies = {},
): IRouter {
  const router: IRouter = Router();
  const resolveAccess = dependencies.resolveAccess ?? getAccessContext;
  const resolveActor =
    dependencies.resolveActorUserId ??
    ((request: Request) => getLocalUser(request)?.id);
  const resolveAuthority =
    dependencies.resolveAuthority ?? resolveCurrentDirectAuthority;
  const readInbox = dependencies.readInbox ?? readWorkInbox;

  router.get("/work-inbox", async (request, response, next) => {
    response.setHeader("Cache-Control", "private, no-store");
    response.vary("X-Valo-Organisation-Id");
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
  });
  return router;
}

export default createWorkInboxRouter();
