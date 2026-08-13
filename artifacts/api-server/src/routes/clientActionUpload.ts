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
  commitTenantDatabaseBeforeResponse,
  holdTenantDatabaseUntilComplete,
} from "../middlewares/databaseTenancy";
import {
  CLIENT_UPLOAD_REQUEST_BODY_BYTES,
  GovernedClientUploadError,
  GovernedClientUploadService,
  governedClientUploadHttpStatus,
  type GovernedClientUploadScope,
} from "../lib/storageLifecycle/clientUpload";
import { createBoundedJsonBody } from "./boundedJsonBody";

const boundedBody = createBoundedJsonBody(
  CLIENT_UPLOAD_REQUEST_BODY_BYTES,
  "client-action",
);

function uploadScope(req: Request): GovernedClientUploadScope {
  const actor = getLocalUser(req);
  const accessContext = getAccessContext(req);
  const organisationId = getOrganisationId(req);
  if (
    !actor ||
    !accessContext ||
    !organisationId ||
    accessContext.source !== "membership" ||
    !accessContext.membershipId ||
    accessContext.membershipOrganisationId !== organisationId
  ) {
    throw new GovernedClientUploadError(
      "scope_denied",
      "A current direct organisation membership is required.",
    );
  }
  return {
    organisationId,
    projectId: String(req.params.id),
    actor,
    accessContext,
  };
}

export function createClientActionUploadRouter(dependencies: {
  service: GovernedClientUploadService;
  holdCritical?: (req: Request) => (error?: unknown) => void;
  commitBeforeResponse?: (req: Request) => Promise<void>;
}): IRouter {
  const router: IRouter = Router();
  const holdCritical =
    dependencies.holdCritical ?? holdTenantDatabaseUntilComplete;
  const commitBeforeResponse =
    dependencies.commitBeforeResponse ?? commitTenantDatabaseBeforeResponse;
  const base =
    "/projects/:id/client-actions/evidence-requests/:recordId/slots/:slotId/upload-leases";
  router.use(base, boundedBody);

  const run =
    (finalize: boolean) =>
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      res.setHeader("Cache-Control", "private, no-store");
      const release = holdCritical(req);
      try {
        const common = {
          scope: uploadScope(req),
          recordId: req.params.recordId,
          slotId: req.params.slotId,
          idempotencyKey: req.get("Idempotency-Key"),
          body: req.body,
        };
        const result = finalize
          ? await dependencies.service.finalize({
              ...common,
              leaseId: req.params.leaseId,
            })
          : await dependencies.service.issueLease(common);
        await commitBeforeResponse(req);
        res.status(result.replayed ? 200 : 201).json(result);
      } catch (error) {
        if (error instanceof GovernedClientUploadError) {
          // Governed rejection/cleanup evidence is an intentional terminal
          // state and must commit even if the caller disconnected mid-scan.
          await commitBeforeResponse(req);
          res.status(governedClientUploadHttpStatus(error)).json({
            error: error.message,
            code: error.code,
            ...(error.details ?? {}),
          });
          return;
        }
        release(error);
        next(error);
      }
    };

  router.post(base, requirePermissionOrLegacy("document:upload"), run(false));
  router.post(
    `${base}/:leaseId/finalize`,
    requirePermissionOrLegacy("document:upload"),
    run(true),
  );
  return router;
}

export default createClientActionUploadRouter;
