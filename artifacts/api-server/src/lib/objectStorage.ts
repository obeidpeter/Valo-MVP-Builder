import { Storage, File } from "@google-cloud/storage";
import { Readable } from "stream";
import { randomUUID } from "crypto";
import {
  ObjectAclPolicy,
  ObjectPermission,
  canAccessObject,
  getObjectAclPolicy,
  setObjectAclPolicy,
} from "./objectAcl";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

export const objectStorageClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: {
        type: "json",
        subject_token_field_name: "access_token",
      },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
  // Bound every provider request with the SDK's native abort path. This is
  // materially safer than racing the Promise in application code: a timed-out
  // delete must not continue unobserved after the path advisory lock is gone.
  timeout: 30_000,
  retryOptions: {
    autoRetry: true,
    maxRetries: 2,
    retryDelayMultiplier: 2,
    maxRetryDelay: 5,
    totalTimeout: 30,
  },
});

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

export class ObjectTooLargeError extends Error {
  constructor(
    public readonly maxBytes: number,
    public readonly observedBytes: number,
  ) {
    super(`Object exceeds the ${maxBytes}-byte intake limit`);
    this.name = "ObjectTooLargeError";
    Object.setPrototypeOf(this, ObjectTooLargeError.prototype);
  }
}

export class ObjectPromotionCleanupError extends Error {
  constructor(
    public readonly destinationPath: string,
    public readonly promotionCause: unknown,
    public readonly cleanupCause: unknown,
  ) {
    super("Promoted object cleanup could not be confirmed");
    this.name = "ObjectPromotionCleanupError";
    Object.setPrototypeOf(this, ObjectPromotionCleanupError.prototype);
  }
}

export class ObjectQuarantinePartialMoveError extends Error {
  constructor(
    public readonly quarantinePath: string,
    public readonly moveCause: unknown,
    public readonly quarantineCopyConfirmed: boolean,
  ) {
    super(
      quarantineCopyConfirmed
        ? "The quarantine copy exists, but the move did not complete"
        : "The quarantine copy may exist, but its disposition could not be confirmed",
    );
    this.name = "ObjectQuarantinePartialMoveError";
    Object.setPrototypeOf(this, ObjectQuarantinePartialMoveError.prototype);
  }
}

export interface ObjectEntityIntake {
  bytes: Buffer;
  contentType: string | null;
  metadataSizeBytes: number | null;
}

/**
 * A delete acknowledgement is not enough to describe a distributed object
 * cleanup as complete. Confirm the object is absent after the delete attempt;
 * if the delete acknowledgement was lost but the absence probe succeeds, the
 * cleanup is still known to be complete.
 */
async function deleteAndConfirmAbsent(file: File): Promise<void> {
  const [metadata] = await file.getMetadata();
  const generation = metadata.generation;
  if (
    (typeof generation !== "string" && typeof generation !== "number") ||
    !/^\d+$/u.test(String(generation))
  ) {
    throw new Error("Object generation is unavailable for guarded deletion");
  }
  const guardedFile = file.bucket.file(file.name, {
    generation,
    preconditionOpts: { ifGenerationMatch: generation },
  });
  let deleteError: unknown;
  try {
    await guardedFile.delete({ ignoreNotFound: true });
  } catch (error) {
    deleteError = error;
  }

  try {
    const [exists] = await file.exists();
    if (!exists) return;
    throw new Error("Object still exists after cleanup attempt");
  } catch (probeError) {
    throw new AggregateError(
      [deleteError, probeError].filter(
        (error): error is NonNullable<unknown> => error != null,
      ),
      "Object cleanup could not be confirmed",
    );
  }
}

/**
 * Collect a storage stream without ever buffering more than the configured
 * intake ceiling. The metadata check performed by the caller is only an early
 * rejection; this byte counter is the authoritative guard against stale or
 * misleading metadata and oversized replacement uploads.
 */
export async function collectStreamWithLimit(
  stream: AsyncIterable<Buffer | Uint8Array | string>,
  maxBytes: number,
): Promise<Buffer> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error("maxBytes must be a positive safe integer");
  }

  const chunks: Buffer[] = [];
  let observedBytes = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    observedBytes += buffer.length;
    if (observedBytes > maxBytes) {
      const destroyable = stream as { destroy?: (error?: Error) => void };
      destroyable.destroy?.();
      throw new ObjectTooLargeError(maxBytes, observedBytes);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, observedBytes);
}

const MAX_PUBLIC_OBJECT_KEY_CODE_UNITS = 512;
// One or more slash-separated segments of word characters, dots and hyphens.
// A segment must contain at least one non-dot character, which excludes the
// "." and ".." traversal segments without banning ordinary file extensions.
const PUBLIC_OBJECT_KEY_SEGMENT = /^[\w.-]*[\w-][\w.-]*$/u;

/**
 * A caller-supplied public-object key is servable only when it is a bounded,
 * already-normalised relative key: no empty/dot-only segments, no leading or
 * doubled slashes, no backslashes, and only conservative segment characters.
 * Anything else fails closed as not-found rather than being normalised.
 */
export function isServablePublicObjectKey(filePath: string): boolean {
  if (
    typeof filePath !== "string" ||
    filePath.length === 0 ||
    filePath.length > MAX_PUBLIC_OBJECT_KEY_CODE_UNITS
  ) {
    return false;
  }
  return filePath
    .split("/")
    .every((segment) => PUBLIC_OBJECT_KEY_SEGMENT.test(segment));
}

function withTrailingSlash(path: string): string {
  return path.endsWith("/") ? path : `${path}/`;
}

/**
 * The public search namespace must never be able to reach the private,
 * tenant-prefixed namespace. Overlap in either direction (equality, a public
 * path inside the private dir, or a public path that is a parent of the
 * private dir) would let the ACL-free public route serve tenant documents,
 * so it is rejected fail-closed before any lookup.
 */
export function assertPublicSearchPathsDisjointFromPrivateDir(
  publicSearchPaths: ReadonlyArray<string>,
  privateObjectDir: string,
): void {
  const privateDir = withTrailingSlash(privateObjectDir);
  for (const searchPath of publicSearchPaths) {
    const publicPath = withTrailingSlash(searchPath);
    if (
      publicPath === privateDir ||
      publicPath.startsWith(privateDir) ||
      privateDir.startsWith(publicPath)
    ) {
      throw new Error(
        "PUBLIC_OBJECT_SEARCH_PATHS overlaps PRIVATE_OBJECT_DIR. The public " +
          "object route performs no ACL checks, so the public and private " +
          "storage namespaces must be disjoint.",
      );
    }
  }
}

export class ObjectStorageService {
  constructor() {}

  getPublicObjectSearchPaths(): Array<string> {
    const pathsStr = process.env.PUBLIC_OBJECT_SEARCH_PATHS || "";
    const paths = Array.from(
      new Set(
        pathsStr
          .split(",")
          .map((path) => path.trim())
          .filter((path) => path.length > 0),
      ),
    );
    if (paths.length === 0) {
      throw new Error(
        "PUBLIC_OBJECT_SEARCH_PATHS not set. Create a bucket in 'Object Storage' " +
          "tool and set PUBLIC_OBJECT_SEARCH_PATHS env var (comma-separated paths).",
      );
    }
    assertPublicSearchPathsDisjointFromPrivateDir(
      paths,
      this.getPrivateObjectDir(),
    );
    return paths;
  }

  getPrivateObjectDir(): string {
    const dir = process.env.PRIVATE_OBJECT_DIR || "";
    if (!dir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          "tool and set PRIVATE_OBJECT_DIR env var.",
      );
    }
    return dir;
  }

  async searchPublicObject(filePath: string): Promise<File | null> {
    if (!isServablePublicObjectKey(filePath)) {
      return null;
    }
    for (const searchPath of this.getPublicObjectSearchPaths()) {
      const fullPath = `${searchPath}/${filePath}`;

      const { bucketName, objectName } = parseObjectPath(fullPath);
      const bucket = objectStorageClient.bucket(bucketName);
      const file = bucket.file(objectName);

      const [exists] = await file.exists();
      if (exists) {
        return file;
      }
    }

    return null;
  }

  async downloadObject(
    file: File,
    cacheTtlSec: number = 3600,
  ): Promise<Response> {
    const [metadata] = await file.getMetadata();
    const aclPolicy = await getObjectAclPolicy(file);
    const isPublic = aclPolicy?.visibility === "public";

    const nodeStream = file.createReadStream();
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;

    const headers: Record<string, string> = {
      "Content-Type":
        (metadata.contentType as string) || "application/octet-stream",
      "Cache-Control": `${isPublic ? "public" : "private"}, max-age=${cacheTtlSec}`,
    };
    if (metadata.size) {
      headers["Content-Length"] = String(metadata.size);
    }

    return new Response(webStream, { headers });
  }

  async getObjectEntityUploadURL(
    organisationId?: string,
    requestedObjectId?: string,
    ttlSec = 900,
    notAfter?: Date,
  ): Promise<string> {
    const privateObjectDir = this.getPrivateObjectDir();
    if (!privateObjectDir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          "tool and set PRIVATE_OBJECT_DIR env var.",
      );
    }

    const uuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (organisationId && !uuid.test(organisationId)) {
      throw new Error("Invalid organisation namespace");
    }
    if (requestedObjectId && !uuid.test(requestedObjectId)) {
      throw new Error("Invalid requested upload object identity");
    }
    if (!Number.isSafeInteger(ttlSec) || ttlSec < 1 || ttlSec > 900) {
      throw new Error("Invalid upload URL lifetime");
    }
    const objectId = requestedObjectId ?? randomUUID();
    const namespace = organisationId ? `tenants/${organisationId}` : "legacy";
    const fullPath = `${privateObjectDir}/${namespace}/uploads/${objectId}`;

    const { bucketName, objectName } = parseObjectPath(fullPath);

    return signObjectURL({
      bucketName,
      objectName,
      method: "PUT",
      ttlSec,
      notAfter,
    });
  }

  async getObjectEntityFile(objectPath: string): Promise<File> {
    if (!objectPath.startsWith("/objects/")) {
      throw new ObjectNotFoundError();
    }

    const parts = objectPath.slice(1).split("/");
    if (parts.length < 2) {
      throw new ObjectNotFoundError();
    }

    const entityId = parts.slice(1).join("/");
    let entityDir = this.getPrivateObjectDir();
    if (!entityDir.endsWith("/")) {
      entityDir = `${entityDir}/`;
    }
    const objectEntityPath = `${entityDir}${entityId}`;
    const { bucketName, objectName } = parseObjectPath(objectEntityPath);
    const bucket = objectStorageClient.bucket(bucketName);
    const objectFile = bucket.file(objectName);
    const [exists] = await objectFile.exists();
    if (!exists) {
      throw new ObjectNotFoundError();
    }
    return objectFile;
  }

  /**
   * Read a private object with a hard in-process byte ceiling. Never replace
   * this with File.download() on an untrusted intake path: that API buffers the
   * complete object before the application can enforce a limit.
   */
  async downloadObjectEntityBuffer(
    objectPath: string,
    maxBytes: number,
  ): Promise<Buffer> {
    const file = await this.getObjectEntityFile(objectPath);
    const [metadata] = await file.getMetadata();
    const metadataSize = Number(metadata.size);
    if (Number.isFinite(metadataSize) && metadataSize > maxBytes) {
      throw new ObjectTooLargeError(maxBytes, metadataSize);
    }
    return collectStreamWithLimit(file.createReadStream(), maxBytes);
  }

  /**
   * Read untrusted staged bytes exactly once while retaining the object
   * metadata needed by governed upload finalisation. Metadata is only an
   * early consistency check; the bounded stream remains authoritative.
   */
  async downloadObjectEntityForIntake(
    objectPath: string,
    maxBytes: number,
  ): Promise<ObjectEntityIntake> {
    const file = await this.getObjectEntityFile(objectPath);
    const [metadata] = await file.getMetadata();
    const rawSize = Number(metadata.size);
    const metadataSizeBytes =
      Number.isSafeInteger(rawSize) && rawSize >= 0 ? rawSize : null;
    if (metadataSizeBytes !== null && metadataSizeBytes > maxBytes) {
      throw new ObjectTooLargeError(maxBytes, metadataSizeBytes);
    }
    const bytes = await collectStreamWithLimit(
      file.createReadStream(),
      maxBytes,
    );
    const contentType =
      typeof metadata.contentType === "string" && metadata.contentType.trim()
        ? metadata.contentType.trim().toLocaleLowerCase("en-US")
        : null;
    return { bytes, contentType, metadataSizeBytes };
  }

  async deleteObjectEntity(objectPath: string): Promise<boolean> {
    try {
      const file = await this.getObjectEntityFile(objectPath);
      await deleteAndConfirmAbsent(file);
      return true;
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Move an untrusted tenant upload out of the ordinary upload namespace.
   * Quarantined paths are denied by the private-object route and are retained
   * only for an authorised scanner/admin recovery workflow.
   */
  async quarantineObjectEntity(
    objectPath: string,
    inspectedBytes: Buffer,
    contentType: string | null,
    requestedQuarantineId?: string,
  ): Promise<string> {
    if (
      !/^\/objects\/tenants\/[0-9a-f-]{36}\/uploads\/[^/]+$/i.test(objectPath)
    ) {
      throw new Error("Only tenant upload objects can be quarantined");
    }
    const file = await this.getObjectEntityFile(objectPath);
    if (!file.name.includes("/uploads/")) {
      throw new Error("Upload object is outside the quarantine move boundary");
    }
    const uuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (requestedQuarantineId && !uuid.test(requestedQuarantineId)) {
      throw new Error("Invalid requested quarantine object identity");
    }
    // Governed callers supply their durable lease identity, making every
    // possible quarantine side effect discoverable after a process crash.
    // Legacy callers retain an isolated random identity.
    const quarantineId = requestedQuarantineId ?? randomUUID();
    const destinationName = file.name.replace(
      /\/uploads\/[^/]+$/,
      `/quarantine/${quarantineId}`,
    );
    if (destinationName === file.name) {
      throw new Error("Upload object is outside the quarantine move boundary");
    }
    const destination = file.bucket.file(destinationName);
    const quarantinePath = objectPath.replace(
      /\/uploads\/[^/]+$/,
      `/quarantine/${quarantineId}`,
    );
    try {
      // Persist exactly the bytes that were hashed and inspected. The
      // create-only destination cannot be overwritten by the signed staging
      // PUT or by a later retry.
      await destination.save(inspectedBytes, {
        resumable: false,
        validation: "crc32c",
        metadata: {
          contentType: contentType ?? "application/octet-stream",
        },
        preconditionOpts: { ifGenerationMatch: 0 },
      });
      const storedBytes = await collectStreamWithLimit(
        destination.createReadStream(),
        Math.max(1, inspectedBytes.length + 1),
      );
      if (!storedBytes.equals(inspectedBytes)) {
        throw new Error(
          "Quarantine object did not match the inspected intake bytes",
        );
      }
    } catch (error) {
      // save() may commit remotely and lose only its response. Delete and
      // probe the unique destination. Only confirmed absence permits the
      // caller to fall back to a definite non-quarantine disposition.
      try {
        await deleteAndConfirmAbsent(destination);
      } catch (cleanupError) {
        throw new ObjectQuarantinePartialMoveError(
          quarantinePath,
          new AggregateError(
            [error, cleanupError],
            "Quarantine copy cleanup ambiguous",
          ),
          false,
        );
      }
      throw error;
    }
    try {
      await file.delete({ ignoreNotFound: true });
    } catch (error) {
      // The destination exists even when the move's source-delete half loses
      // its acknowledgement. Preserve that fact for truthful response/audit
      // handling instead of falling back to a false "purged" disposition.
      throw new ObjectQuarantinePartialMoveError(quarantinePath, error, true);
    }
    return quarantinePath;
  }

  /**
   * Promote inspected tenant bytes out of the still-writable signed-upload
   * namespace into a server-controlled document path. The destination is
   * create-only, so a retry can never overwrite an existing immutable source.
   */
  async promoteStagedUploadToDocument(
    objectPath: string,
    documentId: string,
    inspectedBytes: Buffer,
    contentType: string | null,
  ): Promise<string> {
    if (
      !/^\/objects\/tenants\/[0-9a-f-]{36}\/uploads\/[0-9a-f-]{36}$/i.test(
        objectPath,
      ) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        documentId,
      )
    ) {
      throw new Error("Only tenant staged uploads can be promoted");
    }
    const source = await this.getObjectEntityFile(objectPath);
    const destinationName = source.name.replace(
      /\/uploads\/[0-9a-f-]{36}$/i,
      `/documents/${documentId}`,
    );
    if (destinationName === source.name) {
      throw new Error("Staged upload path could not be promoted");
    }
    const destination = source.bucket.file(destinationName);
    const destinationPath = objectPath.replace(
      /\/uploads\/[0-9a-f-]{36}$/i,
      `/documents/${documentId}`,
    );
    // Persist the exact bytes that passed intake inspection. Copying `source`
    // here would be unsafe: its signed PUT remains usable for a short time and
    // could replace the staged generation between inspection and promotion.
    try {
      await destination.save(inspectedBytes, {
        resumable: false,
        validation: "crc32c",
        metadata: {
          contentType: contentType ?? "application/octet-stream",
        },
        // GCS generation 0 means "destination must not exist".
        preconditionOpts: { ifGenerationMatch: 0 },
      });
    } catch (error) {
      // A failed save promise is ambiguous: GCS may have committed the bytes
      // and lost only the acknowledgement. Delete and probe the deterministic
      // destination before allowing the caller to say no promoted copy exists.
      try {
        await deleteAndConfirmAbsent(destination);
      } catch (cleanupError) {
        throw new ObjectPromotionCleanupError(
          destinationPath,
          error,
          cleanupError,
        );
      }
      throw error;
    }
    try {
      await source.delete({ ignoreNotFound: true });
    } catch (error) {
      // Roll back the promoted copy when we cannot revoke the writable staging
      // path. If rollback also fails, propagate the original failure; the
      // caller records cleanup as unconfirmed and stops retry.
      try {
        await deleteAndConfirmAbsent(destination);
      } catch (cleanupError) {
        throw new ObjectPromotionCleanupError(
          destinationPath,
          error,
          cleanupError,
        );
      }
      throw error;
    }
    return destinationPath;
  }

  normalizeObjectEntityPath(rawPath: string): string {
    if (!rawPath.startsWith("https://storage.googleapis.com/")) {
      return rawPath;
    }

    const url = new URL(rawPath);
    const rawObjectPath = url.pathname;

    let objectEntityDir = this.getPrivateObjectDir();
    if (!objectEntityDir.endsWith("/")) {
      objectEntityDir = `${objectEntityDir}/`;
    }

    if (!rawObjectPath.startsWith(objectEntityDir)) {
      return rawObjectPath;
    }

    const entityId = rawObjectPath.slice(objectEntityDir.length);
    return `/objects/${entityId}`;
  }

  async trySetObjectEntityAclPolicy(
    rawPath: string,
    aclPolicy: ObjectAclPolicy,
  ): Promise<string> {
    const normalizedPath = this.normalizeObjectEntityPath(rawPath);
    if (!normalizedPath.startsWith("/")) {
      return normalizedPath;
    }

    const objectFile = await this.getObjectEntityFile(normalizedPath);
    await setObjectAclPolicy(objectFile, aclPolicy);
    return normalizedPath;
  }

  async canAccessObjectEntity({
    userId,
    objectFile,
    requestedPermission,
  }: {
    userId?: string;
    objectFile: File;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    return canAccessObject({
      userId,
      objectFile,
      requestedPermission: requestedPermission ?? ObjectPermission.READ,
    });
  }
}

function parseObjectPath(path: string): {
  bucketName: string;
  objectName: string;
} {
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  const pathParts = path.split("/");
  if (pathParts.length < 3) {
    throw new Error("Invalid path: must contain at least a bucket name");
  }

  const bucketName = pathParts[1];
  const objectName = pathParts.slice(2).join("/");

  return {
    bucketName,
    objectName,
  };
}

async function signObjectURL({
  bucketName,
  objectName,
  method,
  ttlSec,
  notAfter,
}: {
  bucketName: string;
  objectName: string;
  method: "GET" | "PUT" | "DELETE" | "HEAD";
  ttlSec: number;
  notAfter?: Date;
}): Promise<string> {
  const request = {
    bucket_name: bucketName,
    object_name: objectName,
    method,
    expires_at: boundedSignedObjectExpiration(ttlSec, notAfter).toISOString(),
  };
  const response = await fetch(
    `${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) {
    throw new Error(
      `Failed to sign object URL, errorcode: ${response.status}, ` +
        `make sure you're running on Replit`,
    );
  }

  const { signed_url: signedURL } = (await response.json()) as {
    signed_url: string;
  };
  return signedURL;
}

/**
 * Bound a sidecar signature by an authority clock supplied by the caller.
 * The upload lease uses the database clock; this cap prevents an application
 * clock skew from extending the signed PUT beyond that lease boundary.
 */
export function boundedSignedObjectExpiration(
  ttlSec: number,
  notAfter?: Date,
  now = new Date(),
): Date {
  if (
    !Number.isSafeInteger(ttlSec) ||
    ttlSec < 1 ||
    ttlSec > 900 ||
    !Number.isFinite(now.valueOf()) ||
    (notAfter !== undefined && !Number.isFinite(notAfter.valueOf()))
  ) {
    throw new Error("Invalid signed object URL lifetime");
  }
  const expiresAt = new Date(
    Math.min(
      now.valueOf() + ttlSec * 1_000,
      notAfter?.valueOf() ?? Number.POSITIVE_INFINITY,
    ),
  );
  if (expiresAt.valueOf() <= now.valueOf()) {
    throw new Error("Signed object URL authority window is closed");
  }
  return expiresAt;
}
