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
  requirePermission,
} from "../middlewares/tenancy";
import {
  CONSORTIUM_BOUNDS,
  type ConsortiumScope,
} from "../lib/partnerConsortiumRoom/contracts";
import {
  createDbConsortiumAuthority,
  DrizzleConsortiumRepository,
} from "../lib/partnerConsortiumRoom/drizzleRepository";
import {
  ConsortiumError,
  consortiumHttpStatus,
} from "../lib/partnerConsortiumRoom/errors";
import { PartnerConsortiumRoomService } from "../lib/partnerConsortiumRoom/service";
import { createBoundedJsonBody } from "./boundedJsonBody";

export interface PartnerConsortiumRoomRouterDependencies {
  service: PartnerConsortiumRoomService;
}

const boundedBody = createBoundedJsonBody(
  CONSORTIUM_BOUNDS.requestBytes,
  "consortium-room",
);

function scopeFor(req: Request): ConsortiumScope {
  const actor = getLocalUser(req);
  const organisationId = getOrganisationId(req);
  const access = getAccessContext(req);
  const relationshipId = String(req.params.relationshipId);
  if (
    !actor ||
    !organisationId ||
    !access?.membershipId ||
    !access.membershipOrganisationId ||
    (access.source !== "membership" && access.source !== "partner") ||
    (access.source === "partner" &&
      access.partnerRelationshipId !== relationshipId) ||
    (access.source === "membership" &&
      (access.membershipOrganisationId !== organisationId ||
        access.partnerRelationshipId !== null))
  ) {
    throw new ConsortiumError(
      "scope_denied",
      "Direct client or exact relationship-authorised partner access is required.",
    );
  }
  return {
    organisationId,
    projectId: String(req.params.id),
    relationshipId,
    actorUserId: actor.id,
    actorMembershipId: access.membershipId,
    membershipOrganisationId: access.membershipOrganisationId,
    accessSource: access.source,
    contextPartnerRelationshipId: access.partnerRelationshipId,
  };
}

type Handler = (
  service: PartnerConsortiumRoomService,
  scope: ConsortiumScope,
  req: Request,
) => Promise<unknown>;

export function createPartnerConsortiumRoomRouter(
  dependencies: PartnerConsortiumRoomRouterDependencies,
): IRouter {
  const router: IRouter = Router();
  router.use("/projects/:id/consortium-rooms/:relationshipId", boundedBody);

  const run =
    (handler: Handler, created = false) =>
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("Pragma", "no-cache");
      try {
        const result = await handler(dependencies.service, scopeFor(req), req);
        res.status(created ? 201 : 200).json(result);
      } catch (error) {
        if (error instanceof ConsortiumError) {
          res.status(consortiumHttpStatus(error)).json({
            error: error.message,
            code: error.code,
          });
          return;
        }
        next(error);
      }
    };

  router.get(
    "/projects/:id/consortium-rooms/:relationshipId",
    requirePermission("project:read"),
    run((service, scope) => service.snapshot(scope)),
  );
  router.get(
    "/projects/:id/consortium-rooms/:relationshipId/participants",
    requirePermission("requirement:write"),
    run((service, scope) => service.participants(scope)),
  );
  router.post(
    "/projects/:id/consortium-rooms/:relationshipId",
    requirePermission("requirement:write"),
    run((service, scope, req) => service.initialize(scope, req.body), true),
  );
  router.post(
    "/projects/:id/consortium-rooms/:relationshipId/responsibilities",
    requirePermission("requirement:write"),
    run(
      (service, scope, req) => service.addResponsibility(scope, req.body),
      true,
    ),
  );
  router.post(
    "/projects/:id/consortium-rooms/:relationshipId/responsibilities/:responsibilityId/revisions",
    requirePermission("requirement:write"),
    run((service, scope, req) =>
      service.reviseResponsibility(
        scope,
        String(req.params.responsibilityId),
        req.body,
      ),
    ),
  );
  router.post(
    "/projects/:id/consortium-rooms/:relationshipId/responsibilities/:responsibilityId/decisions",
    requirePermission("requirement:write"),
    run((service, scope, req) =>
      service.decideResponsibility(
        scope,
        String(req.params.responsibilityId),
        req.body,
      ),
    ),
  );
  router.post(
    "/projects/:id/consortium-rooms/:relationshipId/qa/:qaItemId/preparations",
    requirePermission("requirement:write"),
    run((service, scope, req) =>
      service.prepareQa(scope, String(req.params.qaItemId), req.body),
    ),
  );
  router.post(
    "/projects/:id/consortium-rooms/:relationshipId/qa/:qaItemId/decisions",
    requirePermission("requirement:write"),
    run((service, scope, req) =>
      service.decideQa(scope, String(req.params.qaItemId), req.body),
    ),
  );

  return router;
}

export function createDefaultPartnerConsortiumRoomRouter(): IRouter {
  return createPartnerConsortiumRoomRouter({
    service: new PartnerConsortiumRoomService({
      repository: new DrizzleConsortiumRepository(),
      authority: createDbConsortiumAuthority(),
    }),
  });
}

export default createPartnerConsortiumRoomRouter;
