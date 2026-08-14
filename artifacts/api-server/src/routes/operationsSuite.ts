import {
  Router,
  type IRouter,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  currentTenantDatabaseOrganisation,
  db,
  documents,
  evidenceItems,
  organisationMemberships,
  packageManifestItems,
  packageVersions,
  packages,
  projects,
  requirements,
  users,
  vaultItems,
} from "@workspace/db";
import { getLocalUser } from "../middlewares/auth";
import {
  getAccessContext,
  getOrganisationId,
  hasRequestPermission,
  requirePermissionOrLegacy,
  type AccessContext,
} from "../middlewares/tenancy";
import type { Permission } from "../lib/permissions";
import {
  resolveCurrentDirectAuthority,
  type CurrentDirectAuthority,
} from "../lib/directMembershipAuthority";
import { OPERATIONS_SUITE_BOUNDS } from "../lib/operationsSuite/bounds";
import type {
  OperationsScope,
  OperationsRecord,
  OperationsRecordKind,
  VisualQaReportRecord,
  WorkObjectLinks,
} from "../lib/operationsSuite/contracts";
import {
  OperationsSuiteError,
  operationsSuiteHttpStatus,
} from "../lib/operationsSuite/errors";
import {
  OperationsSuiteService,
  type OperationsSuiteReferenceGuard,
} from "../lib/operationsSuite/service";
import type { OperationsSuiteStore } from "../lib/operationsSuite/store";
import { writeAudit } from "../lib/audit";
import {
  computeProjectExportManifestHash,
  PROJECT_EXPORT_MANIFEST_ITEM_LIMIT,
  PROJECT_EXPORT_PACKAGE_TYPE,
  soleCanonicalProjectExportPackageId,
  type ProjectExportManifestItem,
} from "../lib/projectExportPackage";
import { createBoundedJsonBody } from "./boundedJsonBody";

export interface OperationsSuiteProjectGuard {
  assertProject(scope: OperationsScope): Promise<void>;
}

export interface OperationsSuiteRouterDependencies {
  projectGuard: OperationsSuiteProjectGuard;
  /** Supply a preconfigured service, or supply store + references below. */
  service?: OperationsSuiteService;
  store?: OperationsSuiteStore;
  references?: OperationsSuiteReferenceGuard;
  resolveAuthority?: (
    context: AccessContext | undefined,
    actorUserId: string | undefined,
  ) => Promise<CurrentDirectAuthority | null>;
}

export interface DbOperationsSuiteGuards {
  projectGuard: OperationsSuiteProjectGuard;
  references: OperationsSuiteReferenceGuard;
}

/**
 * Project coordination is visible with project:read. Evidence/credential and
 * package/release records additionally follow their canonical domain read
 * permissions so a broad project reader cannot cross those boundaries.
 */
export const OPERATIONS_READ_PERMISSION_BY_KIND: Readonly<
  Record<OperationsRecordKind, Permission>
> = Object.freeze({
  opportunity_intake: "project:read",
  work_item: "project:read",
  mission: "project:read",
  post_award_item: "project:read",
  evidence_request: "evidence:read",
  credential_verification: "evidence:read",
  submission_war_room: "package:read",
  visual_qa_report: "package:read",
});

function canReadOperationsRecord(req: Request, record: OperationsRecord) {
  return hasRequestPermission(
    req,
    OPERATIONS_READ_PERMISSION_BY_KIND[record.kind],
  );
}

function readableOperationsKinds(req: Request): OperationsRecordKind[] {
  return Object.entries(OPERATIONS_READ_PERMISSION_BY_KIND)
    .filter(([, permission]) => hasRequestPermission(req, permission))
    .map(([kind]) => kind as OperationsRecordKind);
}

function denied(message: string): never {
  throw new OperationsSuiteError("scope_denied", message);
}

async function assertExactCount(
  ids: readonly string[],
  load: () => Promise<readonly { id: string }[]>,
  message: string,
): Promise<void> {
  if (ids.length === 0) return;
  if (ids.some((id) => !UUID_PATTERN.test(id))) denied(message);
  const rows = await load();
  if (new Set(rows.map(({ id }) => id)).size !== new Set(ids).size) {
    denied(message);
  }
}

import {
  SHA256_HEX_PATTERN as SHA256_PATTERN,
  UUID_PATTERN,
} from "../lib/identifierPatterns";

function assertUuid(value: string, message: string): void {
  if (!UUID_PATTERN.test(value)) denied(message);
}

async function loadCanonicalPackageVersion(
  scope: OperationsScope,
  packageVersionId: string,
): Promise<{
  packageId: string;
  manifestHash: string;
  renderQaStatus: string;
}> {
  assertUuid(scope.organisationId, "Referenced package version access denied.");
  assertUuid(scope.projectId, "Referenced package version access denied.");
  assertUuid(packageVersionId, "Referenced package version access denied.");
  if (currentTenantDatabaseOrganisation() !== scope.organisationId) {
    denied("Referenced package version access denied.");
  }
  // Match the global resource boundary and durable store lock order: project
  // export first, then operations scope. Mounted requests already hold the
  // project key; both acquisitions are reentrant in the request transaction.
  await db.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${scope.projectId}, 0))`,
  );
  await db.execute(sql`
    SELECT pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        ${`${scope.organisationId}:${scope.projectId}`},
        0
      )
    )
  `);
  const canonicalPackages = await db
    .select({ id: packages.id })
    .from(packages)
    .where(
      and(
        eq(packages.organisationId, scope.organisationId),
        eq(packages.projectId, scope.projectId),
        eq(packages.packageType, PROJECT_EXPORT_PACKAGE_TYPE),
      ),
    )
    .limit(2)
    .for("share");
  const canonicalPackageId =
    soleCanonicalProjectExportPackageId(canonicalPackages);
  if (!canonicalPackageId) {
    denied("Referenced package version access denied.");
  }
  const rows = await db
    .select({
      id: packageVersions.id,
      packageId: packageVersions.packageId,
      versionNumber: packageVersions.versionNumber,
      sourceSnapshotHash: packageVersions.sourceSnapshotHash,
      manifestHash: packageVersions.manifestHash,
      renderQaStatus: packageVersions.renderQaStatus,
      packageType: packages.packageType,
      currentVersionNumber: packages.currentVersionNumber,
    })
    .from(packageVersions)
    .innerJoin(packages, eq(packageVersions.packageId, packages.id))
    .where(
      and(
        eq(packageVersions.id, packageVersionId),
        eq(packageVersions.organisationId, scope.organisationId),
        eq(packageVersions.packageId, canonicalPackageId),
        eq(packages.organisationId, scope.organisationId),
        eq(packages.projectId, scope.projectId),
      ),
    )
    .limit(2)
    .for("share");
  const version = rows.length === 1 ? rows[0] : null;
  if (
    !version ||
    version.packageType !== PROJECT_EXPORT_PACKAGE_TYPE ||
    version.versionNumber !== version.currentVersionNumber ||
    !SHA256_PATTERN.test(version.sourceSnapshotHash) ||
    !SHA256_PATTERN.test(version.manifestHash) ||
    !["pending", "passed", "failed"].includes(version.renderQaStatus)
  ) {
    denied("Referenced package version access denied.");
  }
  const items = await db
    .select({
      ordinal: packageManifestItems.ordinal,
      itemType: packageManifestItems.itemType,
      sourceObjectId: packageManifestItems.sourceObjectId,
      sourceVersion: packageManifestItems.sourceVersion,
      filename: packageManifestItems.filename,
      sha256: packageManifestItems.sha256,
      sizeBytes: packageManifestItems.sizeBytes,
    })
    .from(packageManifestItems)
    .where(
      and(
        eq(packageManifestItems.organisationId, scope.organisationId),
        eq(packageManifestItems.packageVersionId, packageVersionId),
      ),
    )
    .orderBy(asc(packageManifestItems.ordinal))
    .limit(PROJECT_EXPORT_MANIFEST_ITEM_LIMIT + 1);
  if (
    items.length === 0 ||
    items.length > PROJECT_EXPORT_MANIFEST_ITEM_LIMIT ||
    items.some(
      (item, index) =>
        item.ordinal !== index + 1 ||
        !SHA256_PATTERN.test(item.sha256) ||
        !Number.isSafeInteger(item.sizeBytes) ||
        item.sizeBytes < 0,
    ) ||
    computeProjectExportManifestHash(items as ProjectExportManifestItem[]) !==
      version.manifestHash
  ) {
    denied("Referenced package version access denied.");
  }
  return {
    packageId: version.packageId,
    manifestHash: version.manifestHash,
    renderQaStatus: version.renderQaStatus,
  };
}

/**
 * Existing-schema reference guard. Every lookup includes organisation and
 * project predicates; misses share one denial response to avoid cross-tenant
 * existence disclosure.
 */
export function createDbOperationsSuiteGuards(): DbOperationsSuiteGuards {
  const projectGuard: OperationsSuiteProjectGuard = {
    async assertProject(scope) {
      assertUuid(scope.organisationId, "Project access denied.");
      assertUuid(scope.projectId, "Project access denied.");
      const rows = await db
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(
            eq(projects.id, scope.projectId),
            eq(projects.organisationId, scope.organisationId),
          ),
        )
        .limit(1);
      if (rows.length !== 1) denied("Project access denied.");
    },
  };

  const references: OperationsSuiteReferenceGuard = {
    async assertUser(scope, userId) {
      assertUuid(scope.organisationId, "Referenced user access denied.");
      assertUuid(userId, "Referenced user access denied.");
      const rows = await db
        .select({
          membership: organisationMemberships,
          userStatus: users.status,
        })
        .from(organisationMemberships)
        .innerJoin(users, eq(users.id, organisationMemberships.userId))
        .where(
          and(
            eq(organisationMemberships.organisationId, scope.organisationId),
            eq(organisationMemberships.userId, userId),
            eq(organisationMemberships.status, "active"),
            eq(users.status, "active"),
          ),
        )
        .limit(1);
      const membership = rows[0]?.membership;
      const now = Date.now();
      if (
        !membership ||
        (membership.accessStartsAt &&
          membership.accessStartsAt.getTime() > now) ||
        (membership.accessExpiresAt &&
          membership.accessExpiresAt.getTime() <= now)
      ) {
        denied("Referenced user access denied.");
      }
    },

    async assertWorkLinks(scope, links) {
      await Promise.all([
        assertExactCount(
          links.requirementIds,
          () =>
            db
              .select({ id: requirements.id })
              .from(requirements)
              .where(
                and(
                  eq(requirements.organisationId, scope.organisationId),
                  eq(requirements.projectId, scope.projectId),
                  inArray(requirements.id, links.requirementIds),
                ),
              ),
          "Referenced requirement access denied.",
        ),
        assertExactCount(
          links.evidenceItemIds,
          () =>
            db
              .select({ id: evidenceItems.id })
              .from(evidenceItems)
              .where(
                and(
                  eq(evidenceItems.organisationId, scope.organisationId),
                  eq(evidenceItems.projectId, scope.projectId),
                  inArray(evidenceItems.id, links.evidenceItemIds),
                ),
              ),
          "Referenced evidence access denied.",
        ),
        assertExactCount(
          links.packageIds,
          () =>
            db
              .select({ id: packages.id })
              .from(packages)
              .where(
                and(
                  eq(packages.organisationId, scope.organisationId),
                  eq(packages.projectId, scope.projectId),
                  inArray(packages.id, links.packageIds),
                ),
              ),
          "Referenced package access denied.",
        ),
      ]);
    },

    async assertDocument(
      scope,
      documentId,
      expectedSha256,
      acceptedContentTypes,
    ) {
      assertUuid(scope.organisationId, "Referenced document access denied.");
      assertUuid(scope.projectId, "Referenced document access denied.");
      assertUuid(documentId, "Referenced document access denied.");
      const rows = await db
        .select({
          id: documents.id,
          sha256: documents.sha256,
          contentType: documents.contentType,
          extractionStatus: documents.extractionStatus,
        })
        .from(documents)
        .where(
          and(
            eq(documents.organisationId, scope.organisationId),
            eq(documents.projectId, scope.projectId),
            eq(documents.id, documentId),
          ),
        )
        .limit(1);
      const document = rows[0];
      const canonicalContentType = document?.contentType
        ?.trim()
        .toLocaleLowerCase("en-US");
      const accepted = (acceptedContentTypes ?? []).map((contentType) =>
        contentType.trim().toLocaleLowerCase("en-US"),
      );
      if (
        !document ||
        document.extractionStatus === "quarantined" ||
        (expectedSha256 !== undefined &&
          (!document.sha256 || document.sha256 !== expectedSha256)) ||
        (accepted.length > 0 &&
          (!canonicalContentType || !accepted.includes(canonicalContentType)))
      ) {
        denied("Referenced document access or integrity denied.");
      }
    },

    async assertDocuments(scope, documentIds) {
      if (documentIds.some((id) => !UUID_PATTERN.test(id))) {
        denied("Referenced document access denied.");
      }
      await assertExactCount(
        documentIds,
        () =>
          db
            .select({
              id: documents.id,
              extractionStatus: documents.extractionStatus,
            })
            .from(documents)
            .where(
              and(
                eq(documents.organisationId, scope.organisationId),
                eq(documents.projectId, scope.projectId),
                inArray(documents.id, [...documentIds]),
                sql`coalesce(${documents.extractionStatus}, 'pending') <> 'quarantined'`,
              ),
            ),
        "Referenced document access denied.",
      );
    },

    async assertPackageVersion(scope, packageVersionId, constraints) {
      const version = await loadCanonicalPackageVersion(
        scope,
        packageVersionId,
      );
      if (
        (constraints?.packageId !== undefined &&
          version.packageId !== constraints.packageId) ||
        (constraints?.manifestSha256 !== undefined &&
          version.manifestHash !== constraints.manifestSha256) ||
        (constraints?.expectedManifestSha256 !== undefined &&
          version.manifestHash !== constraints.expectedManifestSha256) ||
        (constraints?.requireRenderQaPassed === true &&
          version.renderQaStatus !== "passed")
      )
        denied("Referenced package version access denied.");
    },

    async setPackageRenderQaResult(
      scope,
      packageVersionId,
      constraints,
      status,
    ) {
      const version = await loadCanonicalPackageVersion(
        scope,
        packageVersionId,
      );
      if (
        version.manifestHash !== constraints.manifestSha256 ||
        version.manifestHash !== constraints.expectedManifestSha256
      ) {
        // The same facts were checked before the operations record insert. A
        // mismatch here is an invariant failure, not a committable 4xx path.
        throw new Error("Canonical package manifest changed during visual QA");
      }
      const updated = await db
        .update(packageVersions)
        .set({ renderQaStatus: status })
        .where(
          and(
            eq(packageVersions.id, packageVersionId),
            eq(packageVersions.organisationId, scope.organisationId),
            eq(packageVersions.manifestHash, version.manifestHash),
            eq(packageVersions.renderQaStatus, version.renderQaStatus),
          ),
        )
        .returning({ id: packageVersions.id });
      if (updated.length !== 1) {
        throw new Error("Canonical package render QA status CAS failed");
      }
    },

    async assertVaultItemSnapshot(
      scope,
      vaultItemId,
      vaultItemVersion,
      documentSha256,
    ) {
      assertUuid(
        scope.organisationId,
        "Referenced credential snapshot access denied.",
      );
      assertUuid(
        scope.projectId,
        "Referenced credential snapshot access denied.",
      );
      assertUuid(vaultItemId, "Referenced credential snapshot access denied.");
      const projectRows = await db
        .select({ clientId: projects.clientId })
        .from(projects)
        .where(
          and(
            eq(projects.id, scope.projectId),
            eq(projects.organisationId, scope.organisationId),
          ),
        )
        .limit(2);
      if (projectRows.length !== 1) {
        denied("Referenced credential snapshot access denied.");
      }
      const itemRows = await db
        .select({
          id: vaultItems.id,
          version: vaultItems.version,
          sha256: vaultItems.sha256,
          sourceDocumentId: vaultItems.sourceDocumentId,
        })
        .from(vaultItems)
        .where(
          and(
            eq(vaultItems.id, vaultItemId),
            eq(vaultItems.organisationId, scope.organisationId),
            eq(vaultItems.clientId, projectRows[0]!.clientId),
            eq(vaultItems.status, "active"),
            eq(vaultItems.version, vaultItemVersion),
            eq(vaultItems.sha256, documentSha256),
          ),
        )
        .limit(2)
        .for("share");
      const item = itemRows.length === 1 ? itemRows[0] : null;
      if (!item?.sourceDocumentId || item.sha256 !== documentSha256) {
        denied("Referenced credential snapshot access or integrity denied.");
      }
      const documentRows = await db
        .select({
          id: documents.id,
          sha256: documents.sha256,
          extractionStatus: documents.extractionStatus,
          clientId: projects.clientId,
        })
        .from(documents)
        .innerJoin(
          projects,
          and(
            eq(projects.id, documents.projectId),
            eq(projects.organisationId, documents.organisationId),
          ),
        )
        .where(
          and(
            eq(documents.id, item.sourceDocumentId),
            eq(documents.organisationId, scope.organisationId),
            eq(documents.sha256, documentSha256),
            eq(projects.clientId, projectRows[0]!.clientId),
          ),
        )
        .limit(2)
        .for("share");
      if (
        documentRows.length !== 1 ||
        documentRows[0]?.extractionStatus === "quarantined" ||
        documentRows[0]?.sha256 !== documentSha256
      ) {
        denied("Referenced credential source access or integrity denied.");
      }
    },
  };

  return { projectGuard, references };
}

function sendKnownError(res: Response, error: unknown): boolean {
  if (!(error instanceof OperationsSuiteError)) return false;
  res.status(operationsSuiteHttpStatus(error)).json({
    error: error.message,
    code: error.code,
  });
  return true;
}

const boundedBody = createBoundedJsonBody(
  OPERATIONS_SUITE_BOUNDS.requestBodyBytes,
  "operations",
);

type OperationsHandler = (
  service: OperationsSuiteService,
  scope: OperationsScope,
  req: Request,
) => Promise<unknown>;

export function createOperationsSuiteRouter(
  dependencies: OperationsSuiteRouterDependencies,
): IRouter {
  const service =
    dependencies.service ??
    (dependencies.store && dependencies.references
      ? new OperationsSuiteService({
          store: dependencies.store,
          references: dependencies.references,
        })
      : null);
  if (!service) {
    throw new Error(
      "createOperationsSuiteRouter requires service or store + references.",
    );
  }

  const router: IRouter = Router();
  const resolveAuthority =
    dependencies.resolveAuthority ?? resolveCurrentDirectAuthority;
  router.use("/projects/:id/operations-suite", boundedBody);

  const run =
    (handler: OperationsHandler, created = false) =>
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const organisationId = getOrganisationId(req);
        const actor = getLocalUser(req);
        if (!organisationId || !actor) {
          res.status(403).json({ error: "Organisation access denied" });
          return;
        }
        const scope: OperationsScope = {
          organisationId,
          projectId: String(req.params.id),
          actorUserId: actor.id,
        };
        await dependencies.projectGuard.assertProject(scope);
        const result = await handler(service, scope, req);
        if (!["GET", "HEAD"].includes(req.method)) {
          const record =
            result && typeof result === "object" && !Array.isArray(result)
              ? (result as {
                  id?: unknown;
                  kind?: unknown;
                  version?: unknown;
                })
              : null;
          await writeAudit({
            user: actor,
            organisationId,
            projectId: scope.projectId,
            eventType: created
              ? "operations_suite.record_created"
              : "operations_suite.record_updated",
            objectType:
              typeof record?.kind === "string"
                ? `operations_suite.${record.kind}`
                : "operations_suite.record",
            objectId: typeof record?.id === "string" ? record.id : null,
            details: JSON.stringify({
              method: req.method,
              version:
                typeof record?.version === "number" ? record.version : null,
              externalActionPerformedByValo: false,
              authoritativeStatusReason: "versioned_record",
              ...(record?.kind === "visual_qa_report" &&
              result &&
              typeof result === "object" &&
              "result" in result
                ? {
                    packageRenderQaStatus:
                      (result as VisualQaReportRecord).result.status === "pass"
                        ? "passed"
                        : "failed",
                  }
                : {}),
            }),
          });
        }
        res.setHeader("Cache-Control", "private, no-store");
        res.status(created ? 201 : 200).json(result);
      } catch (error) {
        if (!sendKnownError(res, error)) next(error);
      }
    };

  router.get(
    "/projects/:id/operations-suite",
    requirePermissionOrLegacy("project:read"),
    run(async (operations, scope, req) => {
      const snapshot = await operations.snapshot(scope);
      const records = snapshot.records.filter((record) =>
        canReadOperationsRecord(req, record),
      );
      return {
        ...snapshot,
        records,
        counts: Object.fromEntries(
          Object.keys(OPERATIONS_READ_PERMISSION_BY_KIND).map((kind) => [
            kind,
            records.filter((record) => record.kind === kind).length,
          ]),
        ),
        visibility: {
          visibleKinds: readableOperationsKinds(req),
          filtered:
            readableOperationsKinds(req).length !==
            Object.keys(OPERATIONS_READ_PERMISSION_BY_KIND).length,
        },
        authority: {
          opportunityAcquisition: "record_only",
          clientDelivery: "manual_out_of_band",
          credentialVerification: "human_recorded",
          submission: "record_only",
        },
      };
    }),
  );
  router.get(
    "/projects/:id/operations-suite/my-work",
    requirePermissionOrLegacy("project:read"),
    run((operations, scope) => operations.listMyWork(scope)),
  );
  router.get(
    "/projects/:id/operations-suite/mobile-queue",
    requirePermissionOrLegacy("project:read"),
    run((operations, scope, req) =>
      operations.mobileQueue(scope, readableOperationsKinds(req)),
    ),
  );
  router.get(
    "/projects/:id/operations-suite/records/:recordId",
    requirePermissionOrLegacy("project:read"),
    run(async (operations, scope, req) => {
      const record = await operations.getRecord(
        scope,
        String(req.params.recordId),
      );
      if (!canReadOperationsRecord(req, record)) {
        throw new OperationsSuiteError(
          "not_found",
          "The record was not found.",
        );
      }
      return record;
    }),
  );

  router.post(
    "/projects/:id/operations-suite/opportunities",
    requirePermissionOrLegacy("project:update"),
    run(
      (operations, scope, req) => operations.createOpportunity(scope, req.body),
      true,
    ),
  );
  router.post(
    "/projects/:id/operations-suite/opportunities/:recordId/confirm-deadline",
    requirePermissionOrLegacy("project:update"),
    run((operations, scope, req) =>
      operations.confirmOpportunityDeadline(
        scope,
        String(req.params.recordId),
        req.body,
      ),
    ),
  );

  router.post(
    "/projects/:id/operations-suite/work-items",
    requirePermissionOrLegacy("project:update"),
    run(
      (operations, scope, req) => operations.createWorkItem(scope, req.body),
      true,
    ),
  );
  router.patch(
    "/projects/:id/operations-suite/work-items/:recordId",
    requirePermissionOrLegacy("project:update"),
    run((operations, scope, req) =>
      operations.updateWorkItem(scope, String(req.params.recordId), req.body),
    ),
  );
  router.post(
    "/projects/:id/operations-suite/work-items/:recordId/comments",
    requirePermissionOrLegacy("project:update"),
    run((operations, scope, req) =>
      operations.addWorkItemComment(
        scope,
        String(req.params.recordId),
        req.body,
      ),
    ),
  );
  router.post(
    "/projects/:id/operations-suite/work-items/:recordId/field-draft-promotions",
    requirePermissionOrLegacy("project:update"),
    run((operations, scope, req) =>
      operations.promoteFieldDraftToWorkItem(
        scope,
        String(req.params.recordId),
        req.body,
        req.get("Idempotency-Key"),
        async (promotionScope) => {
          await dependencies.projectGuard.assertProject(promotionScope);
          const authority = await resolveAuthority(
            getAccessContext(req),
            promotionScope.actorUserId,
          );
          if (
            !authority ||
            authority.organisationId !== promotionScope.organisationId ||
            authority.actorUserId !== promotionScope.actorUserId ||
            !authority.permissions.has("project:update")
          ) {
            throw new OperationsSuiteError(
              "scope_denied",
              "Current direct project-update authority is required.",
            );
          }
        },
      ),
    ),
  );
  router.post(
    "/projects/:id/operations-suite/work-items/:recordId/approval",
    requirePermissionOrLegacy("project:assign"),
    run((operations, scope, req) =>
      operations.decideWorkItemApproval(
        scope,
        String(req.params.recordId),
        req.body,
      ),
    ),
  );

  router.post(
    "/projects/:id/operations-suite/evidence-requests",
    requirePermissionOrLegacy("evidence:write"),
    run(
      (operations, scope, req) =>
        operations.createEvidenceRequest(scope, req.body),
      true,
    ),
  );
  router.post(
    "/projects/:id/operations-suite/evidence-requests/:recordId/mark-shared",
    requirePermissionOrLegacy("evidence:write"),
    run((operations, scope, req) =>
      operations.markEvidenceRequestShared(
        scope,
        String(req.params.recordId),
        req.body,
      ),
    ),
  );
  router.post(
    "/projects/:id/operations-suite/evidence-requests/:recordId/responses",
    requirePermissionOrLegacy("evidence:write"),
    run((operations, scope, req) =>
      operations.recordEvidenceResponse(
        scope,
        String(req.params.recordId),
        req.body,
      ),
    ),
  );
  router.post(
    "/projects/:id/operations-suite/evidence-requests/:recordId/decisions",
    requirePermissionOrLegacy("evidence:approve"),
    run((operations, scope, req) =>
      operations.decideEvidenceResponse(
        scope,
        String(req.params.recordId),
        req.body,
      ),
    ),
  );

  router.post(
    "/projects/:id/operations-suite/submission-war-rooms",
    requirePermissionOrLegacy("package:export"),
    run(
      (operations, scope, req) =>
        operations.createSubmissionWarRoom(scope, req.body),
      true,
    ),
  );
  router.post(
    "/projects/:id/operations-suite/submission-war-rooms/:recordId/advance",
    requirePermissionOrLegacy("package:export"),
    run((operations, scope, req) =>
      operations.advanceSubmissionWarRoom(
        scope,
        String(req.params.recordId),
        req.body,
      ),
    ),
  );
  router.post(
    "/projects/:id/operations-suite/visual-qa-reports",
    requirePermissionOrLegacy("package:generate"),
    run(
      (operations, scope, req) =>
        operations.createVisualQaReport(scope, req.body),
      true,
    ),
  );
  router.post(
    "/projects/:id/operations-suite/credential-verifications",
    requirePermissionOrLegacy("evidence:approve"),
    run(
      (operations, scope, req) =>
        operations.createCredentialVerification(scope, req.body),
      true,
    ),
  );
  router.post(
    "/projects/:id/operations-suite/missions",
    requirePermissionOrLegacy("project:update"),
    run(
      (operations, scope, req) => operations.createMission(scope, req.body),
      true,
    ),
  );
  router.patch(
    "/projects/:id/operations-suite/missions/:recordId",
    requirePermissionOrLegacy("project:update"),
    run((operations, scope, req) =>
      operations.updateMission(scope, String(req.params.recordId), req.body),
    ),
  );
  router.post(
    "/projects/:id/operations-suite/post-award-items",
    requirePermissionOrLegacy("project:update"),
    run(
      (operations, scope, req) =>
        operations.createPostAwardItem(scope, req.body),
      true,
    ),
  );
  router.patch(
    "/projects/:id/operations-suite/post-award-items/:recordId",
    requirePermissionOrLegacy("project:update"),
    run((operations, scope, req) =>
      operations.updatePostAwardItem(
        scope,
        String(req.params.recordId),
        req.body,
      ),
    ),
  );

  return router;
}

export type {
  OperationsSuiteReferenceGuard,
  OperationsSuiteStore,
  WorkObjectLinks,
};
