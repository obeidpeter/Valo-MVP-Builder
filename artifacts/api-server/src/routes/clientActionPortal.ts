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
  hasRequestPermission,
  requirePermissionOrLegacy,
} from "../middlewares/tenancy";
import { writeAudit } from "../lib/audit";
import {
  DrizzleClientActionAuthorityDirectory,
  type ClientActionAuthorityDirectorySource,
} from "../lib/clientActionPortal/authorityDirectory";
import {
  CLIENT_ACTION_BOUNDS,
  type ClientActionScope,
} from "../lib/clientActionPortal/contracts";
import {
  ClientActionError,
  clientActionHttpStatus,
} from "../lib/clientActionPortal/errors";
import { ClientActionService } from "../lib/clientActionPortal/service";
import { createBoundedJsonBody } from "./boundedJsonBody";

export interface ClientActionPortalRouterDependencies {
  service: ClientActionService;
  authorityDirectory?: ClientActionAuthorityDirectorySource;
}

const boundedBody = createBoundedJsonBody(
  CLIENT_ACTION_BOUNDS.requestBodyBytes,
  "client-action",
);

function scopeFor(req: Request): ClientActionScope {
  const actor = getLocalUser(req);
  const organisationId = getOrganisationId(req);
  const access = getAccessContext(req);
  if (
    !actor ||
    !organisationId ||
    access?.source !== "membership" ||
    access.membershipOrganisationId !== organisationId
  ) {
    throw new ClientActionError(
      "scope_denied",
      "Direct organisation membership is required for client actions.",
    );
  }
  return {
    organisationId,
    projectId: String(req.params.id),
    actorUserId: actor.id,
  };
}

type Handler = (
  service: ClientActionService,
  scope: ClientActionScope,
  req: Request,
) => Promise<unknown>;

export function createClientActionPortalRouter(
  dependencies: ClientActionPortalRouterDependencies,
): IRouter {
  const router: IRouter = Router();
  const authorityDirectory =
    dependencies.authorityDirectory ??
    new DrizzleClientActionAuthorityDirectory();
  router.use("/projects/:id/client-actions", boundedBody);

  const run =
    (handler: Handler, created = false) =>
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      res.setHeader("Cache-Control", "private, no-store");
      try {
        const scope = scopeFor(req);
        const actor = getLocalUser(req);
        const result = await handler(dependencies.service, scope, req);
        if (req.method !== "GET" && req.method !== "HEAD") {
          const record = result as {
            id?: unknown;
            kind?: unknown;
            version?: unknown;
            status?: unknown;
          };
          await writeAudit({
            user: actor,
            organisationId: scope.organisationId,
            projectId: scope.projectId,
            eventType: created
              ? "client_action.record_created"
              : "client_action.record_updated",
            objectType:
              typeof record.kind === "string"
                ? `client_action.${record.kind}`
                : "client_action.record",
            objectId: typeof record.id === "string" ? record.id : null,
            details: JSON.stringify({
              version:
                typeof record.version === "number" ? record.version : null,
              status: typeof record.status === "string" ? record.status : null,
              externalMessageSentByValo: false,
              rawUploadPerformedByThisRoute: false,
              externalPackageDeliveryPerformedByValo: false,
            }),
          });
        }
        res.status(created ? 201 : 200).json(result);
      } catch (error) {
        if (error instanceof ClientActionError) {
          res.status(clientActionHttpStatus(error)).json({
            error: error.message,
            code: error.code,
          });
          return;
        }
        next(error);
      }
    };

  router.get(
    "/projects/:id/client-actions",
    requirePermissionOrLegacy("project:read"),
    run(async (service, scope, req) => {
      const snapshot = await service.snapshot(scope);
      return {
        ...snapshot,
        records: snapshot.records.filter(
          (record) =>
            record.recipientUserId === scope.actorUserId ||
            record.createdByUserId === scope.actorUserId ||
            (record.kind === "evidence_request" &&
              hasRequestPermission(req, "evidence:approve")) ||
            (record.kind === "package_delivery" &&
              hasRequestPermission(req, "package:export")),
        ),
      };
    }),
  );
  router.get(
    "/projects/:id/client-actions/authorities",
    requirePermissionOrLegacy("evidence:write"),
    run(async (_service, scope) => {
      const items = await authorityDirectory.list(
        scope,
        CLIENT_ACTION_BOUNDS.authorities + 1,
      );
      if (items.length > CLIENT_ACTION_BOUNDS.authorities) {
        throw new ClientActionError(
          "capacity_exceeded",
          "Client action authority directory exceeds its safe bound.",
        );
      }
      return {
        organisationId: scope.organisationId,
        projectId: scope.projectId,
        items,
        limit: CLIENT_ACTION_BOUNDS.authorities,
        truncated: false as const,
      };
    }),
  );

  router.post(
    "/projects/:id/client-actions/evidence-requests",
    requirePermissionOrLegacy("evidence:write"),
    run(
      (service, scope, req) => service.createEvidenceRequest(scope, req.body),
      true,
    ),
  );
  router.post(
    "/projects/:id/client-actions/evidence-requests/:recordId/acknowledgements",
    requirePermissionOrLegacy("document:upload"),
    run((service, scope, req) =>
      service.acknowledgeRequest(scope, String(req.params.recordId), req.body),
    ),
  );
  router.post(
    "/projects/:id/client-actions/evidence-requests/:recordId/slots/:slotId/upload-intents",
    requirePermissionOrLegacy("document:upload"),
    run((service, scope, req) =>
      service.recordUploadIntent(
        scope,
        String(req.params.recordId),
        String(req.params.slotId),
        req.body,
      ),
    ),
  );
  router.post(
    "/projects/:id/client-actions/evidence-requests/:recordId/slots/:slotId/documents",
    requirePermissionOrLegacy("document:upload"),
    run((service, scope, req) =>
      service.attachCanonicalDocument(
        scope,
        String(req.params.recordId),
        String(req.params.slotId),
        req.body,
      ),
    ),
  );
  router.post(
    "/projects/:id/client-actions/evidence-requests/:recordId/slots/:slotId/reviews",
    requirePermissionOrLegacy("evidence:approve"),
    run((service, scope, req) =>
      service.reviewSlot(
        scope,
        String(req.params.recordId),
        String(req.params.slotId),
        req.body,
      ),
    ),
  );
  router.post(
    "/projects/:id/client-actions/evidence-requests/:recordId/slots/:slotId/correction-acknowledgements",
    requirePermissionOrLegacy("document:upload"),
    run((service, scope, req) =>
      service.acknowledgeCorrection(
        scope,
        String(req.params.recordId),
        String(req.params.slotId),
        req.body,
      ),
    ),
  );

  router.post(
    "/projects/:id/client-actions/package-deliveries",
    requirePermissionOrLegacy("package:export"),
    run(
      (service, scope, req) => service.createPackageDelivery(scope, req.body),
      true,
    ),
  );
  router.post(
    "/projects/:id/client-actions/package-deliveries/:recordId/acknowledgements",
    requirePermissionOrLegacy("package:read"),
    run((service, scope, req) =>
      service.acknowledgePackageDelivery(
        scope,
        String(req.params.recordId),
        req.body,
      ),
    ),
  );

  return router;
}

export default createClientActionPortalRouter;
