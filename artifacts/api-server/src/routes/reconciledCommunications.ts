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
  getOrganisationId,
  requirePermissionOrLegacy,
} from "../middlewares/tenancy";
import {
  COMMUNICATION_BOUNDS,
  type CommunicationScope,
} from "../lib/reconciledCommunications/contracts";
import {
  createDbCommunicationAuthority,
  DrizzleCommunicationRepository,
  loadDbCommunicationReferences,
} from "../lib/reconciledCommunications/drizzleRepository";
import {
  CommunicationError,
  communicationHttpStatus,
} from "../lib/reconciledCommunications/errors";
import {
  ReconciledCommunicationService,
  type NotificationProviderRegistry,
  type NotificationReceiptVerifier,
} from "../lib/reconciledCommunications/service";

export interface ReconciledCommunicationsRouterDependencies {
  service: ReconciledCommunicationService;
  loadReferences: typeof loadDbCommunicationReferences;
}

function boundedBody(req: Request, res: Response, next: NextFunction): void {
  if (req.method === "GET" || req.method === "HEAD") {
    next();
    return;
  }
  let bytes = Number.POSITIVE_INFINITY;
  try {
    bytes = Buffer.byteLength(JSON.stringify(req.body ?? {}), "utf8");
  } catch {
    res.status(400).json({ error: "Request body must be JSON serializable." });
    return;
  }
  if (bytes > COMMUNICATION_BOUNDS.requestBytes) {
    res
      .status(413)
      .json({ error: "Request body exceeds the communications bound." });
    return;
  }
  next();
}

function scopeFor(req: Request): CommunicationScope {
  const actor = getLocalUser(req);
  const organisationId = getOrganisationId(req);
  const access = getAccessContext(req);
  if (
    !actor ||
    !organisationId ||
    access?.source !== "membership" ||
    access.membershipOrganisationId !== organisationId ||
    !access.membershipId
  ) {
    throw new CommunicationError(
      "scope_denied",
      "Active direct organisation membership is required for communications.",
    );
  }
  return {
    organisationId,
    projectId: String(req.params.id),
    actorUserId: actor.id,
  };
}

type Handler = (
  service: ReconciledCommunicationService,
  scope: CommunicationScope,
  req: Request,
) => Promise<unknown>;

export function createReconciledCommunicationsRouter(
  dependencies: ReconciledCommunicationsRouterDependencies,
): IRouter {
  const router: IRouter = Router();
  router.use("/projects/:id/communications", boundedBody);

  const run =
    (handler: Handler, created = false) =>
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const result = await handler(dependencies.service, scopeFor(req), req);
        res.setHeader("Cache-Control", "private, no-store");
        res.setHeader("Pragma", "no-cache");
        res.status(created ? 201 : 200).json(result);
      } catch (error) {
        if (error instanceof CommunicationError) {
          res.status(communicationHttpStatus(error)).json({
            error: error.message,
            code: error.code,
          });
          return;
        }
        next(error);
      }
    };

  router.get(
    "/projects/:id/communications",
    requirePermissionOrLegacy("project:read"),
    run((service, scope) => service.snapshot(scope)),
  );
  router.get(
    "/projects/:id/communications/references",
    requirePermissionOrLegacy("project:update"),
    run((_service, scope) => dependencies.loadReferences(scope)),
  );
  router.post(
    "/projects/:id/communications/intents",
    requirePermissionOrLegacy("project:update"),
    run((service, scope, req) => service.queue(scope, req.body), true),
  );
  router.post(
    "/projects/:id/communications/intents/:eventId/attempts",
    requirePermissionOrLegacy("project:update"),
    run((service, scope, req) =>
      service.attempt(scope, String(req.params.eventId), req.body),
    ),
  );
  router.post(
    "/projects/:id/communications/intents/:eventId/reconciliations",
    requirePermissionOrLegacy("project:update"),
    run((service, scope, req) =>
      service.reconcile(scope, String(req.params.eventId), req.body),
    ),
  );

  return router;
}

/**
 * Safe integration default: durable ledger enabled, all external providers and
 * receipt verifiers disconnected until explicitly injected by composition.
 */
export function createDisconnectedReconciledCommunicationsRouter(): IRouter {
  return createReconciledCommunicationsRouter({
    service: new ReconciledCommunicationService({
      repository: new DrizzleCommunicationRepository(),
      authority: createDbCommunicationAuthority(),
    }),
    loadReferences: loadDbCommunicationReferences,
  });
}

export function createConnectedReconciledCommunicationsRouter(input: {
  providers: NotificationProviderRegistry;
  receiptVerifier: NotificationReceiptVerifier;
}): IRouter {
  return createReconciledCommunicationsRouter({
    service: new ReconciledCommunicationService({
      repository: new DrizzleCommunicationRepository(),
      authority: createDbCommunicationAuthority(),
      providers: input.providers,
      receiptVerifier: input.receiptVerifier,
    }),
    loadReferences: loadDbCommunicationReferences,
  });
}

export default createReconciledCommunicationsRouter;
