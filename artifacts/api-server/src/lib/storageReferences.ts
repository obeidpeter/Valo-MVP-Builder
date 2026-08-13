import {
  db,
  documents,
  documentVersions,
  packageVersions,
  partnerBranding,
  reports,
  uploadSessions,
  vaultItems,
} from "@workspace/db";
import { and, eq, ne, or } from "drizzle-orm";

export type StoragePathReferenceKind =
  | "document"
  | "document_version"
  | "vault_item"
  | "report"
  | "package_version"
  | "partner_branding"
  | "upload_session";

/**
 * Return every persisted tenant artefact category that still owns a storage
 * path. Cleanup and replacement paths use this fail-closed inventory instead
 * of assuming only document rows can point into the upload namespace.
 */
export async function storagePathReferenceKinds(
  objectPath: string,
  options?: {
    excludeDocumentId?: string;
    excludeUploadSessionId?: string;
  },
): Promise<StoragePathReferenceKind[]> {
  const references: StoragePathReferenceKind[] = [];

  const [document] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(
      options?.excludeDocumentId
        ? and(
            eq(documents.objectPath, objectPath),
            ne(documents.id, options.excludeDocumentId),
          )
        : eq(documents.objectPath, objectPath),
    )
    .limit(1);
  if (document) references.push("document");

  const [documentVersion] = await db
    .select({ id: documentVersions.id })
    .from(documentVersions)
    .where(eq(documentVersions.objectPath, objectPath))
    .limit(1);
  if (documentVersion) references.push("document_version");

  const [vaultItem] = await db
    .select({ id: vaultItems.id })
    .from(vaultItems)
    .where(eq(vaultItems.objectPath, objectPath))
    .limit(1);
  if (vaultItem) references.push("vault_item");

  const [report] = await db
    .select({ id: reports.id })
    .from(reports)
    .where(
      or(eq(reports.docxPath, objectPath), eq(reports.pdfPath, objectPath)),
    )
    .limit(1);
  if (report) references.push("report");

  const [packageVersion] = await db
    .select({ id: packageVersions.id })
    .from(packageVersions)
    .where(
      or(
        eq(packageVersions.docxObjectPath, objectPath),
        eq(packageVersions.pdfObjectPath, objectPath),
        eq(packageVersions.zipObjectPath, objectPath),
      ),
    )
    .limit(1);
  if (packageVersion) references.push("package_version");

  const [branding] = await db
    .select({ id: partnerBranding.id })
    .from(partnerBranding)
    .where(eq(partnerBranding.logoObjectPath, objectPath))
    .limit(1);
  if (branding) references.push("partner_branding");

  const stagedUpload =
    /^\/objects\/tenants\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/uploads\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/iu.exec(
      objectPath,
    );
  if (
    stagedUpload &&
    stagedUpload[2]?.toLowerCase() !==
      options?.excludeUploadSessionId?.toLowerCase()
  ) {
    const [uploadSession] = await db
      .select({ id: uploadSessions.id })
      .from(uploadSessions)
      .where(
        and(
          eq(uploadSessions.id, stagedUpload[2]!),
          eq(uploadSessions.organisationId, stagedUpload[1]!),
          or(
            eq(uploadSessions.status, "open"),
            eq(uploadSessions.status, "completed"),
            eq(uploadSessions.status, "rejected"),
            eq(uploadSessions.status, "quarantined"),
            eq(uploadSessions.status, "cleanup_unconfirmed"),
          ),
        ),
      )
      .limit(1);
    if (uploadSession) references.push("upload_session");
  }

  return references;
}

export async function isStoragePathReferenced(
  objectPath: string,
): Promise<boolean> {
  return (await storagePathReferenceKinds(objectPath)).length > 0;
}

/**
 * Re-inspection can logically quarantine a registered document without a
 * non-atomic object move. Generic storage serving must consult that persisted
 * state and fail closed even if another readable reference shares the path.
 */
export async function hasSecurityQuarantinedDocumentReference(
  objectPath: string,
): Promise<boolean> {
  const [document] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(
        eq(documents.objectPath, objectPath),
        eq(documents.extractionStatus, "quarantined"),
      ),
    )
    .limit(1);
  return Boolean(document);
}
