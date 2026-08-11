import { createHash } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import {
  db,
  packageManifestItems,
  packageVersions,
  packages,
} from "@workspace/db";

export const PROJECT_EXPORT_PACKAGE_TYPE = "project_export" as const;
export const PROJECT_EXPORT_PACKAGE_LIST_LIMIT = 100;
export const PROJECT_EXPORT_MANIFEST_ITEM_LIMIT = 64;

const EXCLUDED_AUDIT_EVENT_TYPES = Object.freeze([
  "package.project_export_version_created",
  "package.project_export_version_reused",
  "package.versions_viewed",
  "project.export_denied",
  "project.exported",
  "report.export_denied",
  "report.exported",
  "report.viewed",
]);
const EXCLUDED_AUDIT_OBJECT_PAIRS = Object.freeze([
  Object.freeze({
    eventType: "operations_suite.record_created",
    objectType: "operations_suite.submission_war_room",
  }),
  Object.freeze({
    eventType: "operations_suite.record_updated",
    objectType: "operations_suite.submission_war_room",
  }),
  Object.freeze({
    eventType: "operations_suite.record_created",
    objectType: "operations_suite.visual_qa_report",
  }),
  Object.freeze({
    eventType: "operations_suite.record_created",
    objectType: "operations_suite.post_award_item",
  }),
  Object.freeze({
    eventType: "operations_suite.record_updated",
    objectType: "operations_suite.post_award_item",
  }),
]);

/**
 * Export/download/QA audit evidence stays in the authoritative tenant chain,
 * but is excluded from the package's embedded audit snapshot so observing or
 * validating a package cannot recursively change that package's own bytes.
 */
export const PROJECT_EXPORT_AUDIT_POLICY = Object.freeze({
  schema: "valo.project-export-audit-policy/v1" as const,
  authoritativeTenantAuditRetained: true as const,
  excludedEventTypes: EXCLUDED_AUDIT_EVENT_TYPES,
  excludedEventObjectPairs: EXCLUDED_AUDIT_OBJECT_PAIRS,
});

export function includeAuditEventInProjectExport(event: {
  eventType: string;
  objectType: string | null;
}): boolean {
  return (
    !EXCLUDED_AUDIT_EVENT_TYPES.includes(event.eventType) &&
    !EXCLUDED_AUDIT_OBJECT_PAIRS.some(
      (pair) =>
        pair.eventType === event.eventType &&
        pair.objectType === event.objectType,
    )
  );
}

type DatabaseTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface ProjectExportArchiveEntry {
  itemType: string;
  sourceObjectId: string | null;
  sourceVersion: number | null;
  filename: string;
  bytes: Buffer;
}

export interface ProjectExportManifestItem {
  ordinal: number;
  itemType: string;
  sourceObjectId: string | null;
  sourceVersion: number | null;
  filename: string;
  sha256: string;
  sizeBytes: number;
}

export interface ProjectExportSnapshotIdentity {
  organisationId: string;
  projectId: string;
  projectVersion: number;
  reportId: string;
  reportVersion: number;
}

export interface CanonicalProjectExportManifest {
  sourceSnapshotHash: string;
  manifestHash: string;
  items: ProjectExportManifestItem[];
}

export interface PersistedProjectExportPackageVersion {
  packageId: string;
  packageVersionId: string;
  versionNumber: number;
  sourceSnapshotHash: string;
  manifestHash: string;
  renderQaStatus: "pending" | "passed" | "failed";
  createdAt: Date;
  created: boolean;
}

export function soleCanonicalProjectExportPackageId(
  rows: readonly { id: string }[],
): string | null {
  if (rows.length > 1) {
    throw new Error("Multiple canonical project export packages were found");
  }
  return rows[0]?.id ?? null;
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const SAFE_ARCHIVE_NAME = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[^\\\u0000]+$/u;

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalManifestPayload(items: readonly ProjectExportManifestItem[]) {
  return {
    schema: "valo.project-export-manifest/v1",
    entries: items.map((item) => ({
      ordinal: item.ordinal,
      itemType: item.itemType,
      sourceObjectId: item.sourceObjectId,
      sourceVersion: item.sourceVersion,
      filename: item.filename,
      sha256: item.sha256,
      sizeBytes: item.sizeBytes,
    })),
  };
}

export function computeProjectExportManifestHash(
  items: readonly ProjectExportManifestItem[],
): string {
  return sha256(JSON.stringify(canonicalManifestPayload(items)));
}

/**
 * Builds the hash identities from the exact byte buffers later appended to the
 * ZIP. The manifest is metadata-only: no report, tender or register content is
 * copied into the package lifecycle relations.
 */
export function buildCanonicalProjectExportManifest(
  identity: ProjectExportSnapshotIdentity,
  entries: readonly ProjectExportArchiveEntry[],
): CanonicalProjectExportManifest {
  if (
    entries.length === 0 ||
    entries.length > PROJECT_EXPORT_MANIFEST_ITEM_LIMIT
  ) {
    throw new Error("Project export manifest entry count is outside the bound");
  }
  const filenames = new Set<string>();
  const items = entries.map((entry, index): ProjectExportManifestItem => {
    if (
      !entry.itemType.trim() ||
      entry.itemType.length > 128 ||
      !SAFE_ARCHIVE_NAME.test(entry.filename) ||
      entry.filename.length > 256 ||
      filenames.has(entry.filename) ||
      !Number.isSafeInteger(entry.bytes.byteLength) ||
      entry.bytes.byteLength < 0
    ) {
      throw new Error("Project export manifest entry is invalid");
    }
    if (
      entry.sourceVersion !== null &&
      (!Number.isSafeInteger(entry.sourceVersion) || entry.sourceVersion < 1)
    ) {
      throw new Error("Project export source version is invalid");
    }
    filenames.add(entry.filename);
    return {
      ordinal: index + 1,
      itemType: entry.itemType,
      sourceObjectId: entry.sourceObjectId,
      sourceVersion: entry.sourceVersion,
      filename: entry.filename,
      sha256: sha256(entry.bytes),
      sizeBytes: entry.bytes.byteLength,
    };
  });
  const manifestHash = computeProjectExportManifestHash(items);
  const sourceSnapshotHash = sha256(
    JSON.stringify({
      schema: "valo.project-export-source-snapshot/v1",
      organisationId: identity.organisationId,
      projectId: identity.projectId,
      projectVersion: identity.projectVersion,
      reportId: identity.reportId,
      reportVersion: identity.reportVersion,
      manifestHash,
      entries: canonicalManifestPayload(items).entries,
    }),
  );
  return { sourceSnapshotHash, manifestHash, items };
}

function sameManifestItems(
  left: readonly ProjectExportManifestItem[],
  right: readonly ProjectExportManifestItem[],
): boolean {
  return (
    JSON.stringify(canonicalManifestPayload(left)) ===
    JSON.stringify(canonicalManifestPayload(right))
  );
}

async function loadManifestItems(
  tx: DatabaseTx,
  organisationId: string,
  packageVersionId: string,
): Promise<ProjectExportManifestItem[]> {
  const rows = await tx
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
        eq(packageManifestItems.organisationId, organisationId),
        eq(packageManifestItems.packageVersionId, packageVersionId),
      ),
    )
    .orderBy(asc(packageManifestItems.ordinal))
    .limit(PROJECT_EXPORT_MANIFEST_ITEM_LIMIT + 1);
  if (
    rows.length === 0 ||
    rows.length > PROJECT_EXPORT_MANIFEST_ITEM_LIMIT ||
    rows.some(
      (row, index) =>
        row.ordinal !== index + 1 ||
        !SHA256_PATTERN.test(row.sha256) ||
        !Number.isSafeInteger(row.sizeBytes) ||
        row.sizeBytes < 0,
    )
  ) {
    throw new Error("Persisted project export manifest failed validation");
  }
  return rows;
}

/**
 * Creates or versions the single canonical project-export package. Callers are
 * already inside the request tenant transaction; the project advisory lock and
 * package version CAS make the one-package/current-version invariant explicit.
 */
export async function persistCanonicalProjectExportPackage(
  tx: DatabaseTx,
  input: {
    identity: ProjectExportSnapshotIdentity;
    manifest: CanonicalProjectExportManifest;
    generatedByUserId: string | null;
  },
): Promise<PersistedProjectExportPackageVersion> {
  const { identity, manifest } = input;
  if (
    !SHA256_PATTERN.test(manifest.sourceSnapshotHash) ||
    !SHA256_PATTERN.test(manifest.manifestHash) ||
    manifest.manifestHash !== computeProjectExportManifestHash(manifest.items)
  ) {
    throw new Error("Canonical project export hashes failed validation");
  }

  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${identity.projectId}, 0))`,
  );
  const existingPackages = await tx
    .select()
    .from(packages)
    .where(
      and(
        eq(packages.organisationId, identity.organisationId),
        eq(packages.projectId, identity.projectId),
        eq(packages.packageType, PROJECT_EXPORT_PACKAGE_TYPE),
      ),
    )
    .orderBy(asc(packages.createdAt), asc(packages.id))
    .limit(2)
    .for("update");
  soleCanonicalProjectExportPackageId(existingPackages);

  const packageRow =
    existingPackages[0] ??
    (
      await tx
        .insert(packages)
        .values({
          organisationId: identity.organisationId,
          projectId: identity.projectId,
          packageType: PROJECT_EXPORT_PACKAGE_TYPE,
          status: "draft",
          currentVersionNumber: 0,
        })
        .returning()
    )[0];
  if (!packageRow) {
    throw new Error("Canonical project export package could not be created");
  }

  if (packageRow.currentVersionNumber > 0) {
    const currentRows = await tx
      .select()
      .from(packageVersions)
      .where(
        and(
          eq(packageVersions.organisationId, identity.organisationId),
          eq(packageVersions.packageId, packageRow.id),
          eq(packageVersions.versionNumber, packageRow.currentVersionNumber),
        ),
      )
      .limit(2);
    if (currentRows.length !== 1) {
      throw new Error("Canonical package current version failed validation");
    }
    const current = currentRows[0]!;
    if (
      current.sourceSnapshotHash === manifest.sourceSnapshotHash &&
      current.manifestHash === manifest.manifestHash
    ) {
      const currentItems = await loadManifestItems(
        tx,
        identity.organisationId,
        current.id,
      );
      if (!sameManifestItems(currentItems, manifest.items)) {
        throw new Error(
          "Canonical package manifest rows do not match its hash",
        );
      }
      if (
        current.renderQaStatus !== "pending" &&
        current.renderQaStatus !== "passed" &&
        current.renderQaStatus !== "failed"
      ) {
        throw new Error("Canonical package render QA status is invalid");
      }
      return {
        packageId: packageRow.id,
        packageVersionId: current.id,
        versionNumber: current.versionNumber,
        sourceSnapshotHash: current.sourceSnapshotHash,
        manifestHash: current.manifestHash,
        renderQaStatus: current.renderQaStatus,
        createdAt: current.createdAt,
        created: false,
      };
    }
  }

  const nextVersionNumber = packageRow.currentVersionNumber + 1;
  const readinessSnapshot = JSON.stringify({
    schema: "valo.project-export-readiness/v1",
    submissionReadiness: "passed",
    renderQaStatus: "pending",
    projectId: identity.projectId,
    projectVersion: identity.projectVersion,
    reportId: identity.reportId,
    reportVersion: identity.reportVersion,
    sourceSnapshotHash: manifest.sourceSnapshotHash,
    manifestHash: manifest.manifestHash,
    entryCount: manifest.items.length,
  });
  const [versionRow] = await tx
    .insert(packageVersions)
    .values({
      organisationId: identity.organisationId,
      packageId: packageRow.id,
      versionNumber: nextVersionNumber,
      sourceSnapshotHash: manifest.sourceSnapshotHash,
      manifestHash: manifest.manifestHash,
      renderQaStatus: "pending",
      readinessSnapshot,
      generatedByUserId: input.generatedByUserId,
    })
    .returning();
  if (!versionRow) {
    throw new Error("Canonical project export version could not be created");
  }
  await tx.insert(packageManifestItems).values(
    manifest.items.map((item) => ({
      organisationId: identity.organisationId,
      packageVersionId: versionRow.id,
      ordinal: item.ordinal,
      itemType: item.itemType,
      sourceObjectId: item.sourceObjectId,
      sourceVersion: item.sourceVersion,
      filename: item.filename,
      sha256: item.sha256,
      sizeBytes: item.sizeBytes,
    })),
  );
  const updated = await tx
    .update(packages)
    .set({
      currentVersionNumber: nextVersionNumber,
      version: sql`${packages.version} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(packages.id, packageRow.id),
        eq(packages.organisationId, identity.organisationId),
        eq(packages.projectId, identity.projectId),
        eq(packages.packageType, PROJECT_EXPORT_PACKAGE_TYPE),
        eq(packages.currentVersionNumber, packageRow.currentVersionNumber),
        eq(packages.version, packageRow.version),
      ),
    )
    .returning({ id: packages.id });
  if (updated.length !== 1) {
    throw new Error("Canonical project export package CAS failed");
  }
  return {
    packageId: packageRow.id,
    packageVersionId: versionRow.id,
    versionNumber: versionRow.versionNumber,
    sourceSnapshotHash: versionRow.sourceSnapshotHash,
    manifestHash: versionRow.manifestHash,
    renderQaStatus: "pending",
    createdAt: versionRow.createdAt,
    created: true,
  };
}
