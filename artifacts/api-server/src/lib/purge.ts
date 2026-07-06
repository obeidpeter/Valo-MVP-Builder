import { eq, inArray } from "drizzle-orm";
import { db, documents, reports, vaultItems } from "@workspace/db";
import type { ObjectStorageService } from "./objectStorage";

/**
 * Shared blob-purge planning for the two "remove this engagement" paths
 * (DELETE /projects/:id and retention completion) plus single-document
 * deletion. Centralised so the paths cannot drift on one crucial rule:
 * a blob referenced by a Certificate Vault item belongs to the *client's*
 * long-lived vault, not to the engagement, and must survive engagement
 * purges.
 */
export interface BlobPurgePlan {
  /** Blob paths owned solely by the engagement — safe to delete. */
  paths: string[];
  /** Blob paths retained because a vault item references them. */
  vaultRetained: string[];
}

export async function planProjectBlobPurge(projectId: string): Promise<BlobPurgePlan> {
  const docs = await db
    .select({ objectPath: documents.objectPath })
    .from(documents)
    .where(eq(documents.projectId, projectId));
  const reps = await db
    .select({ docxPath: reports.docxPath })
    .from(reports)
    .where(eq(reports.projectId, projectId));
  const candidates = [
    ...docs.map((d) => d.objectPath),
    ...reps.map((r) => r.docxPath).filter((p): p is string => !!p),
  ];
  const protectedPaths = await vaultReferencedPaths(candidates);
  return {
    paths: candidates.filter((p) => !protectedPaths.has(p)),
    vaultRetained: candidates.filter((p) => protectedPaths.has(p)),
  };
}

/** The subset of `paths` that some vault item still points at. */
export async function vaultReferencedPaths(paths: string[]): Promise<Set<string>> {
  if (paths.length === 0) return new Set();
  const rows = await db
    .select({ objectPath: vaultItems.objectPath })
    .from(vaultItems)
    .where(inArray(vaultItems.objectPath, paths));
  return new Set(rows.map((r) => r.objectPath).filter((p): p is string => !!p));
}

export interface BlobPurgeResult {
  purged: number;
  /** Paths whose deletion threw — the blob may still exist in storage. */
  failed: string[];
}

/**
 * Deletes blobs best-effort and reports failures instead of swallowing them,
 * so callers can refuse to certify a purge that did not fully happen.
 * "Not found" counts as already-purged, not as a failure.
 */
export async function purgeBlobs(
  objectStorage: ObjectStorageService,
  paths: string[],
  onError?: (path: string, error: unknown) => void,
): Promise<BlobPurgeResult> {
  let purged = 0;
  const failed: string[] = [];
  for (const path of paths) {
    try {
      // deleteObjectEntity returns false for a not-found object. That still
      // satisfies the purge postcondition (the blob is gone) — crucially so on
      // a RETRY after a partial failure, where the certificate must not
      // understate blobs deleted by the first attempt.
      await objectStorage.deleteObjectEntity(path);
      purged++;
    } catch (error) {
      failed.push(path);
      onError?.(path, error);
    }
  }
  return { purged, failed };
}
