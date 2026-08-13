import { File } from "@google-cloud/storage";

const ACL_POLICY_METADATA_KEY = "custom:aclPolicy";

// Stored as object custom metadata under "custom:aclPolicy" (JSON string).
// Only the visibility marker is consumed today (cache-control selection in
// objectStorage.downloadObject); nothing in the application writes policies.
export interface ObjectAclPolicy {
  owner: string;
  visibility: "public" | "private";
}

export async function getObjectAclPolicy(
  objectFile: File,
): Promise<ObjectAclPolicy | null> {
  const [metadata] = await objectFile.getMetadata();
  const aclPolicy = metadata?.metadata?.[ACL_POLICY_METADATA_KEY];
  if (!aclPolicy) {
    return null;
  }
  return JSON.parse(aclPolicy as string);
}
