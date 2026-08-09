const UUID_SEGMENT =
  "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

/**
 * Only opaque objects issued into the current tenant's staging namespace are
 * eligible for cleanup. Signed URLs, arbitrary storage URLs, quarantine paths,
 * and another tenant's objects are never accepted as deletion authority.
 */
export function isOwnedStagedUploadPath(
  objectPath: string,
  organisationId: string | null,
): boolean {
  const namespace = organisationId
    ? `tenants/${organisationId.toLowerCase()}`
    : "legacy";
  return new RegExp(
    `^/objects/${namespace}/uploads/${UUID_SEGMENT}$`,
    "i",
  ).test(objectPath);
}

export type StagedUploadCleanupResult =
  | "deleted"
  | "already_absent"
  | "referenced";

export class UnsafeStagedUploadPathError extends Error {
  constructor() {
    super("Upload object is outside the authorised staging namespace");
    this.name = "UnsafeStagedUploadPathError";
  }
}

export async function discardStagedUpload(
  input: {
    objectPath: string;
    organisationId: string | null;
  },
  dependencies: {
    isReferenced: (objectPath: string) => Promise<boolean>;
    deleteObject: (objectPath: string) => Promise<boolean>;
  },
): Promise<StagedUploadCleanupResult> {
  if (!isOwnedStagedUploadPath(input.objectPath, input.organisationId)) {
    throw new UnsafeStagedUploadPathError();
  }
  if (await dependencies.isReferenced(input.objectPath)) return "referenced";
  return (await dependencies.deleteObject(input.objectPath))
    ? "deleted"
    : "already_absent";
}
