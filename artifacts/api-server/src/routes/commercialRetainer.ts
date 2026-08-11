import { Router, type IRouter, type Request, type Response } from "express";
import { getLocalUser } from "../middlewares/auth";
import { getAccessContext, type AccessContext } from "../middlewares/tenancy";
import {
  COMMERCIAL_RETAINER_MANIFEST,
  CommercialRetainerError,
  type CommercialMutationResult,
  type CommercialScope,
} from "../lib/commercialRetainer/contracts";
import type { CommercialRetainerService } from "../lib/commercialRetainer/service";

export type CommercialRetainerRouteAction =
  | "read"
  | "quote:create"
  | "quote:approve"
  | "invoice:create"
  | "payment:record"
  | "payment:verify"
  | "retainer:use";

export interface CommercialRetainerRouteAccess {
  scope: CommercialScope;
  context: AccessContext;
}

export interface CommercialRetainerRouteDependencies {
  service: Pick<
    CommercialRetainerService,
    | "snapshot"
    | "createQuote"
    | "approveQuote"
    | "createInvoice"
    | "recordPayment"
    | "verifyPayment"
    | "createRetainerRequest"
    | "mutateRetainerRequest"
  >;
  resolveAccess?: (
    request: Request,
  ) =>
    | CommercialRetainerRouteAccess
    | null
    | Promise<CommercialRetainerRouteAccess | null>;
}

const COMMERCIAL_CHECKER_ROLES = new Set([
  "client_organisation_owner",
  "client_administrator",
  "valo_operations_administrator",
]);

function defaultAccess(request: Request): CommercialRetainerRouteAccess | null {
  const context = getAccessContext(request);
  const actor = getLocalUser(request);
  if (
    !context ||
    !actor ||
    context.source !== "membership" ||
    !context.membershipId ||
    context.membershipOrganisationId !== context.organisationId
  ) {
    return null;
  }
  return {
    scope: {
      organisationId: context.organisationId,
      actorUserId: actor.id,
      actorMembershipId: context.membershipId,
    },
    context,
  };
}

export function canAccessCommercialRetainer(
  access: CommercialRetainerRouteAccess,
  action: CommercialRetainerRouteAction,
): boolean {
  const { context } = access;
  if (
    context.source !== "membership" ||
    !context.membershipId ||
    context.membershipOrganisationId !== context.organisationId
  )
    return false;
  switch (action) {
    case "read":
      return (
        context.permissions.has("billing:read") &&
        context.permissions.has("entitlement:read")
      );
    case "quote:create":
      return context.permissions.has("order:create");
    case "quote:approve":
      return (
        context.permissions.has("order:create") &&
        context.roles.some((role) => COMMERCIAL_CHECKER_ROLES.has(role))
      );
    case "invoice:create":
    case "payment:record":
    case "payment:verify":
      return (
        context.permissions.has("billing:read") &&
        context.permissions.has("order:create") &&
        context.roles.includes("valo_operations_administrator")
      );
    case "retainer:use":
      return (
        context.permissions.has("entitlement:read") &&
        context.permissions.has("order:create")
      );
  }
}

type JsonRecord = Record<string, unknown>;

function body(request: Request): JsonRecord {
  if (
    typeof request.body !== "object" ||
    request.body == null ||
    Array.isArray(request.body)
  )
    throw new CommercialRetainerError("invalid_input");
  const value = request.body as JsonRecord;
  if (
    "organisationId" in value ||
    "actorUserId" in value ||
    "actorMembershipId" in value
  )
    throw new CommercialRetainerError("invalid_scope");
  return value;
}

function routeId(request: Request, name: string): string {
  const value = request.params[name];
  if (typeof value !== "string")
    throw new CommercialRetainerError("invalid_input");
  return value;
}

function expectedVersion(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1)
    throw new CommercialRetainerError("invalid_input");
  return value;
}

async function requireAccess(
  request: Request,
  dependencies: CommercialRetainerRouteDependencies,
  action: CommercialRetainerRouteAction,
): Promise<CommercialRetainerRouteAccess> {
  const access = await (dependencies.resolveAccess ?? defaultAccess)(request);
  if (!access || !canAccessCommercialRetainer(access, action)) {
    throw new CommercialRetainerError("not_found_or_not_authorized");
  }
  return access;
}

function sendMutation<T>(
  response: Response,
  result: CommercialMutationResult<T>,
): void {
  if (result.outcome === "updated") {
    response.status(200).json(result);
    return;
  }
  const status =
    result.outcome === "not_found"
      ? 404
      : result.outcome === "policy_denied"
        ? 403
        : result.outcome === "capacity_exceeded"
          ? 429
          : 409;
  response.status(status).json({ error: result.outcome });
}

function errorStatus(error: CommercialRetainerError): number {
  switch (error.code) {
    case "invalid_scope":
    case "invalid_input":
      return 400;
    case "not_found_or_not_authorized":
      return 404;
    case "self_approval_denied":
      return 403;
    case "catalogue_not_seeded":
    case "persistence_unavailable":
      return 503;
    case "capacity_exceeded":
      return 429;
    case "version_conflict":
    case "state_conflict":
      return 409;
  }
}

function asyncRoute(
  handler: (request: Request, response: Response) => Promise<void>,
) {
  return (request: Request, response: Response): void => {
    void handler(request, response).catch((error: unknown) => {
      if (error instanceof CommercialRetainerError) {
        response.status(errorStatus(error)).json({ error: error.code });
        return;
      }
      response.status(500).json({ error: "internal_error" });
    });
  };
}

/**
 * Private, unmounted route factory. The integration layer must place this
 * behind user + tenant middleware; every response is explicitly non-cacheable.
 */
export function createCommercialRetainerRouter(
  dependencies: CommercialRetainerRouteDependencies,
): IRouter {
  const router = Router();
  router.use((_request, response, next) => {
    response.setHeader(
      "Cache-Control",
      "private, no-store, max-age=0, must-revalidate",
    );
    response.setHeader("Pragma", "no-cache");
    response.setHeader("Expires", "0");
    next();
  });

  router.get(
    "/manifest",
    asyncRoute(async (request, response) => {
      await requireAccess(request, dependencies, "read");
      response.status(200).json({ manifest: COMMERCIAL_RETAINER_MANIFEST });
    }),
  );

  router.get(
    "/snapshot",
    asyncRoute(async (request, response) => {
      const { scope } = await requireAccess(request, dependencies, "read");
      const projectValue = request.query.projectId;
      const projectId =
        projectValue == null
          ? undefined
          : typeof projectValue === "string"
            ? projectValue
            : (() => {
                throw new CommercialRetainerError("invalid_input");
              })();
      const snapshot = await dependencies.service.snapshot(scope, projectId);
      response.status(200).json({ snapshot });
    }),
  );

  router.post(
    "/quotes",
    asyncRoute(async (request, response) => {
      const { scope } = await requireAccess(
        request,
        dependencies,
        "quote:create",
      );
      const quote = await dependencies.service.createQuote(
        scope,
        body(request),
      );
      response.status(201).json({ quote });
    }),
  );

  router.post(
    "/quotes/:orderId/approve",
    asyncRoute(async (request, response) => {
      const { scope } = await requireAccess(
        request,
        dependencies,
        "quote:approve",
      );
      const value = body(request);
      if (Object.keys(value).some((key) => key !== "expectedVersion")) {
        throw new CommercialRetainerError("invalid_input");
      }
      sendMutation(
        response,
        await dependencies.service.approveQuote(
          scope,
          routeId(request, "orderId"),
          expectedVersion(value.expectedVersion),
        ),
      );
    }),
  );

  router.post(
    "/quotes/:orderId/invoices",
    asyncRoute(async (request, response) => {
      const { scope } = await requireAccess(
        request,
        dependencies,
        "invoice:create",
      );
      const value = body(request);
      if ("orderId" in value)
        throw new CommercialRetainerError("invalid_scope");
      sendMutation(
        response,
        await dependencies.service.createInvoice(scope, {
          ...value,
          orderId: routeId(request, "orderId"),
        }),
      );
    }),
  );

  router.post(
    "/invoices/:invoiceId/payments",
    asyncRoute(async (request, response) => {
      const { scope } = await requireAccess(
        request,
        dependencies,
        "payment:record",
      );
      const value = body(request);
      if ("invoiceId" in value)
        throw new CommercialRetainerError("invalid_scope");
      sendMutation(
        response,
        await dependencies.service.recordPayment(scope, {
          ...value,
          invoiceId: routeId(request, "invoiceId"),
        }),
      );
    }),
  );

  router.post(
    "/payments/:paymentId/verify",
    asyncRoute(async (request, response) => {
      const { scope } = await requireAccess(
        request,
        dependencies,
        "payment:verify",
      );
      const value = body(request);
      if (
        Object.keys(value).some(
          (key) =>
            key !== "expectedPaymentVersion" &&
            key !== "expectedInvoiceVersion",
        )
      )
        throw new CommercialRetainerError("invalid_input");
      sendMutation(
        response,
        await dependencies.service.verifyPayment(
          scope,
          routeId(request, "paymentId"),
          expectedVersion(value.expectedPaymentVersion),
          expectedVersion(value.expectedInvoiceVersion),
        ),
      );
    }),
  );

  router.post(
    "/retainer/requests",
    asyncRoute(async (request, response) => {
      const { scope } = await requireAccess(
        request,
        dependencies,
        "retainer:use",
      );
      sendMutation(
        response,
        await dependencies.service.createRetainerRequest(scope, body(request)),
      );
    }),
  );

  router.post(
    "/retainer/requests/:requestId/actions",
    asyncRoute(async (request, response) => {
      const { scope } = await requireAccess(
        request,
        dependencies,
        "retainer:use",
      );
      sendMutation(
        response,
        await dependencies.service.mutateRetainerRequest(
          scope,
          routeId(request, "requestId"),
          body(request),
        ),
      );
    }),
  );

  return router;
}
