import { Router, type IRouter, type Request, type Response } from "express";
import { getLocalUser } from "../middlewares/auth";
import { commitTenantDatabaseBeforeResponse } from "../middlewares/databaseTenancy";
import { privateResponse } from "../middlewares/privateResponse";
import { getAccessContext, type AccessContext } from "../middlewares/tenancy";
import {
  DocumentVersionSnapshotRepository,
  type SnapshotActor,
} from "../lib/documentVersionSnapshotRepository";
import {
  resolveCurrentDirectAuthority,
  type CurrentDirectAuthority,
} from "../lib/directMembershipAuthority";
import { UUID_PATTERN } from "../lib/identifierPatterns";
import { parseExpectedVersion, type Permission } from "../lib/permissions";

const CAPTURE_PERMISSIONS = [
  "document:read",
  "requirement:write",
] as const satisfies readonly Permission[];
const REVIEW_PERMISSIONS = [
  "document:read",
  "intelligence:review",
] as const satisfies readonly Permission[];

type SnapshotRepository = Pick<
  DocumentVersionSnapshotRepository,
  "readCurrent" | "capture" | "review"
>;

export interface DocumentVersionSnapshotRouterOptions {
  readonly repository?: SnapshotRepository;
  readonly now?: () => Date;
  readonly resolveAccess?: (request: Request) => AccessContext | undefined;
  readonly resolveActor?: (
    request: Request,
  ) => { readonly id: string; readonly name: string | null } | undefined;
  readonly resolveDirectAuthority?: (
    request: Request,
  ) => Promise<CurrentDirectAuthority | null>;
  readonly commitBeforeResponse?: (request: Request) => Promise<void>;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function exactKeys(value: Record<string, unknown>, allowed: string[]): boolean {
  return (
    Object.keys(value).length === allowed.length &&
    Object.keys(value).every((key) => allowed.includes(key))
  );
}

function sendOutcome(
  response: Response,
  outcome:
    | Exclude<
        Awaited<ReturnType<DocumentVersionSnapshotRepository["capture"]>>,
        { outcome: "created" | "existing" | "updated" }
      >["outcome"]
    | "created"
    | "existing"
    | "updated",
): void {
  const status = outcome === "not_found" ? 404 : 409;
  response.status(status).json({
    error:
      outcome === "version_conflict"
        ? "Snapshot version changed"
        : outcome === "state_conflict"
          ? "Snapshot source state changed"
          : outcome === "not_found"
            ? "Document snapshot was not found"
            : "Document snapshot request conflicts with current evidence",
    code: outcome,
  });
}

export function createDocumentVersionSnapshotRouter(
  options: DocumentVersionSnapshotRouterOptions = {},
): IRouter {
  const router: IRouter = Router();
  const repository =
    options.repository ?? new DocumentVersionSnapshotRepository();
  const now = options.now ?? (() => new Date());
  const resolveAccess = options.resolveAccess ?? getAccessContext;
  const resolveActor =
    options.resolveActor ??
    ((request: Request) => {
      const actor = getLocalUser(request);
      return actor ? { id: actor.id, name: actor.name } : undefined;
    });
  const resolveDirectAuthority =
    options.resolveDirectAuthority ??
    ((request: Request) =>
      resolveCurrentDirectAuthority(
        resolveAccess(request),
        resolveActor(request)?.id,
      ));
  const commitBeforeResponse =
    options.commitBeforeResponse ?? commitTenantDatabaseBeforeResponse;

  const writeActor = async (
    request: Request,
    permissions: readonly Permission[],
  ): Promise<SnapshotActor | null> => {
    const access = resolveAccess(request);
    const actor = resolveActor(request);
    const name = actor?.name?.trim();
    const authority = await resolveDirectAuthority(request);
    if (
      !access ||
      access.source !== "membership" ||
      !access.membershipId ||
      !actor ||
      !name ||
      !authority ||
      authority.organisationId !== access.organisationId ||
      authority.actorUserId !== actor.id ||
      authority.membershipId !== access.membershipId ||
      !permissions.every((permission) => authority.permissions.has(permission))
    ) {
      return null;
    }
    return {
      organisationId: authority.organisationId,
      userId: authority.actorUserId,
      membershipId: authority.membershipId,
      name,
    };
  };

  router.use("/documents/:id/version-snapshot", privateResponse);
  router.use("/documents/:id/version-snapshots", privateResponse);

  router.get(
    "/documents/:id/version-snapshot",
    async (request, response, next) => {
      const access = resolveAccess(request);
      if (
        !access ||
        (access.source !== "membership" && access.source !== "partner") ||
        !access.permissions.has("document:read")
      ) {
        response.status(403).json({ error: "Document snapshot access denied" });
        return;
      }
      try {
        const value = await repository.readCurrent(
          access.organisationId,
          String(request.params.id),
        );
        if (!value) {
          response
            .status(404)
            .json({ error: "Document snapshot was not found" });
          return;
        }
        response.json(value);
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/documents/:id/version-snapshots",
    async (request, response, next) => {
      if (
        !record(request.body) ||
        !exactKeys(request.body, ["documentVersionId", "structuredSnapshot"]) ||
        typeof request.body.documentVersionId !== "string" ||
        !UUID_PATTERN.test(request.body.documentVersionId) ||
        (request.body.structuredSnapshot !== null &&
          !record(request.body.structuredSnapshot))
      ) {
        response.status(400).json({ error: "Invalid snapshot proposal" });
        return;
      }
      try {
        const actor = await writeActor(request, CAPTURE_PERMISSIONS);
        if (!actor) {
          response.status(403).json({ error: "Snapshot capture denied" });
          return;
        }
        const result = await repository.capture(
          actor,
          String(request.params.id),
          request.body.documentVersionId,
          request.body.structuredSnapshot,
          now(),
        );
        if (result.outcome !== "created" && result.outcome !== "existing") {
          sendOutcome(response, result.outcome);
          return;
        }
        await commitBeforeResponse(request);
        response
          .status(result.outcome === "created" ? 201 : 200)
          .json(result.value);
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/documents/:id/version-snapshots/:snapshotId/review",
    async (request, response, next) => {
      const expectedVersion = parseExpectedVersion(request.header("if-match"));
      if (
        !UUID_PATTERN.test(String(request.params.snapshotId)) ||
        expectedVersion === null ||
        !record(request.body) ||
        !exactKeys(request.body, ["decision"]) ||
        (request.body.decision !== "verified" &&
          request.body.decision !== "rejected")
      ) {
        response.status(400).json({ error: "Invalid snapshot review" });
        return;
      }
      try {
        const actor = await writeActor(request, REVIEW_PERMISSIONS);
        if (!actor) {
          response.status(403).json({ error: "Snapshot review denied" });
          return;
        }
        const result = await repository.review(
          actor,
          String(request.params.id),
          String(request.params.snapshotId),
          expectedVersion,
          request.body.decision,
          now(),
        );
        if (result.outcome !== "updated") {
          sendOutcome(response, result.outcome);
          return;
        }
        await commitBeforeResponse(request);
        response.json(result.value);
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
