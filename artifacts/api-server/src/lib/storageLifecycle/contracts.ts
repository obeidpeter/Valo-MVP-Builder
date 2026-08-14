import { canonicalJsonStrict, sha256Hex } from "../canonicalDigest";

export const CLIENT_UPLOAD_LEASE_SCHEMA =
  "valo.client-action-upload-lease/v1" as const;
export const STORAGE_DELETION_INTENT_SCHEMA =
  "valo.storage-deletion-intent/v1" as const;

export const STORAGE_LIFECYCLE_BOUNDS = Object.freeze({
  uploadLeaseMinutes: 15,
  uploadSignedUrlMaximumSeconds: 840,
  uploadSignedUrlLeaseCushionSeconds: 60,
  uploadPostExpiryGraceSeconds: 300,
  uploadLeaseMaximumBytes: 52_428_800,
  uploadLeaseEnvelopeBytes: 2_048,
  deletionEnvelopeBytes: 2_048,
  reconciliationBatch: 25,
  maximumAttempts: 5,
  maximumDeadLetterReplays: 3,
  terminalRetentionDays: 90,
  deletionProviderTimeoutMs: 30_000,
  deletionRetryBaseSeconds: 300,
  deletionRetryMaximumSeconds: 21_600,
  activeUploadLeasesPerProject: 200,
  filenameCodeUnits: 255,
  contentTypeCodeUnits: 192,
  objectPathCodeUnits: 512,
  lateRewriteClosure: "bounded-cushion-and-post-expiry-reconcile",
});

import {
  SHA256_HEX_PATTERN as SHA256,
  UUID_PATTERN as UUID,
} from "../identifierPatterns";
const MIME =
  /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/u;
const CONTROL = /[\u0000-\u001f\u007f\ud800-\udfff]/u;

export interface ClientUploadLeaseEnvelope {
  schema: typeof CLIENT_UPLOAD_LEASE_SCHEMA;
  idempotencyKeySha256: string;
  actorUserId: string;
  recordId: string;
  recordVersion: number;
  slotId: string;
  intentId: string;
  contentType: string;
}

export interface StorageDeletionIntentEnvelope {
  schema: typeof STORAGE_DELETION_INTENT_SCHEMA;
  organisationId: string;
  projectId: string | null;
  objectPath: string;
  aggregateType: "document" | "vault_item" | "upload_session";
  aggregateId: string;
  reason: "record_deleted" | "reference_replaced" | "lease_expired";
  requestedAt: string;
  requestSha256: string;
  maximumAttempts: 5;
}

export class StorageLifecycleContractError extends Error {
  constructor(readonly code: "invalid" | "corrupt") {
    super(code);
    this.name = "StorageLifecycleContractError";
  }
}

function canonicalJson(value: unknown): string {
  return canonicalJsonStrict(value, () => {
    throw new StorageLifecycleContractError("invalid");
  });
}

export function storageLifecycleSha256(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

function exactObject(value: unknown, keys: readonly string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const expected = new Set(keys);
  return Object.keys(record).length === expected.size &&
    Object.keys(record).every((key) => expected.has(key))
    ? record
    : null;
}

function boundedText(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value === value.trim() &&
    value.length >= 1 &&
    value.length <= maximum &&
    !CONTROL.test(value)
  );
}

function instant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString() === value;
}

export function clientUploadObjectPath(
  organisationId: string,
  leaseId: string,
): string {
  if (!UUID.test(organisationId) || !UUID.test(leaseId)) {
    throw new StorageLifecycleContractError("invalid");
  }
  return `/objects/tenants/${organisationId}/uploads/${leaseId}`;
}

export function clientUploadDocumentPath(
  organisationId: string,
  leaseId: string,
): string {
  if (!UUID.test(organisationId) || !UUID.test(leaseId)) {
    throw new StorageLifecycleContractError("invalid");
  }
  return `/objects/tenants/${organisationId}/documents/${leaseId}`;
}

export function clientUploadQuarantinePath(
  organisationId: string,
  leaseId: string,
): string {
  if (!UUID.test(organisationId) || !UUID.test(leaseId)) {
    throw new StorageLifecycleContractError("invalid");
  }
  return `/objects/tenants/${organisationId}/quarantine/${leaseId}`;
}

export function createClientUploadLeaseEnvelope(input: {
  idempotencyKey: string;
  actorUserId: string;
  recordId: string;
  recordVersion: number;
  slotId: string;
  intentId: string;
  contentType: string;
}): ClientUploadLeaseEnvelope {
  const contentType = input.contentType.trim().toLocaleLowerCase("en-US");
  if (
    !boundedText(input.idempotencyKey, 128) ||
    input.idempotencyKey.length < 16 ||
    !UUID.test(input.actorUserId) ||
    !UUID.test(input.recordId) ||
    !Number.isSafeInteger(input.recordVersion) ||
    input.recordVersion < 1 ||
    !UUID.test(input.slotId) ||
    !UUID.test(input.intentId) ||
    !MIME.test(contentType)
  ) {
    throw new StorageLifecycleContractError("invalid");
  }
  return {
    schema: CLIENT_UPLOAD_LEASE_SCHEMA,
    idempotencyKeySha256: storageLifecycleSha256(input.idempotencyKey),
    actorUserId: input.actorUserId,
    recordId: input.recordId,
    recordVersion: input.recordVersion,
    slotId: input.slotId,
    intentId: input.intentId,
    contentType,
  };
}

export function serializeClientUploadLeaseEnvelope(
  envelope: ClientUploadLeaseEnvelope,
): string {
  const value = canonicalJson(envelope);
  if (
    Buffer.byteLength(value, "utf8") >
    STORAGE_LIFECYCLE_BOUNDS.uploadLeaseEnvelopeBytes
  ) {
    throw new StorageLifecycleContractError("invalid");
  }
  return value;
}

export function parseClientUploadLeaseEnvelope(
  value: string,
): ClientUploadLeaseEnvelope {
  let raw: unknown;
  try {
    raw = JSON.parse(value);
  } catch {
    throw new StorageLifecycleContractError("corrupt");
  }
  const parsed = exactObject(raw, [
    "schema",
    "idempotencyKeySha256",
    "actorUserId",
    "recordId",
    "recordVersion",
    "slotId",
    "intentId",
    "contentType",
  ]);
  if (
    !parsed ||
    parsed.schema !== CLIENT_UPLOAD_LEASE_SCHEMA ||
    typeof parsed.idempotencyKeySha256 !== "string" ||
    !SHA256.test(parsed.idempotencyKeySha256) ||
    typeof parsed.actorUserId !== "string" ||
    !UUID.test(parsed.actorUserId) ||
    typeof parsed.recordId !== "string" ||
    !UUID.test(parsed.recordId) ||
    !Number.isSafeInteger(parsed.recordVersion) ||
    (parsed.recordVersion as number) < 1 ||
    typeof parsed.slotId !== "string" ||
    !UUID.test(parsed.slotId) ||
    typeof parsed.intentId !== "string" ||
    !UUID.test(parsed.intentId) ||
    typeof parsed.contentType !== "string" ||
    !MIME.test(parsed.contentType)
  ) {
    throw new StorageLifecycleContractError("corrupt");
  }
  return parsed as unknown as ClientUploadLeaseEnvelope;
}

function deletionMaterial(input: {
  organisationId: string;
  projectId: string | null;
  objectPath: string;
  aggregateType: StorageDeletionIntentEnvelope["aggregateType"];
  aggregateId: string;
  reason: StorageDeletionIntentEnvelope["reason"];
  requestedAt: string;
}) {
  return {
    schema: STORAGE_DELETION_INTENT_SCHEMA,
    ...input,
    maximumAttempts: STORAGE_LIFECYCLE_BOUNDS.maximumAttempts as 5,
  };
}

export function createStorageDeletionIntent(input: {
  organisationId: string;
  projectId: string | null;
  objectPath: string;
  aggregateType: StorageDeletionIntentEnvelope["aggregateType"];
  aggregateId: string;
  reason: StorageDeletionIntentEnvelope["reason"];
  requestedAt: string;
}): StorageDeletionIntentEnvelope {
  if (
    !UUID.test(input.organisationId) ||
    (input.projectId !== null && !UUID.test(input.projectId)) ||
    !boundedText(
      input.objectPath,
      STORAGE_LIFECYCLE_BOUNDS.objectPathCodeUnits,
    ) ||
    !input.objectPath.startsWith(`/objects/tenants/${input.organisationId}/`) ||
    !UUID.test(input.aggregateId) ||
    !instant(input.requestedAt)
  ) {
    throw new StorageLifecycleContractError("invalid");
  }
  const material = deletionMaterial(input);
  return { ...material, requestSha256: storageLifecycleSha256(material) };
}

export function serializeStorageDeletionIntent(
  envelope: StorageDeletionIntentEnvelope,
): string {
  const value = canonicalJson(envelope);
  if (
    Buffer.byteLength(value, "utf8") >
    STORAGE_LIFECYCLE_BOUNDS.deletionEnvelopeBytes
  ) {
    throw new StorageLifecycleContractError("invalid");
  }
  return value;
}

export function parseStorageDeletionIntent(
  value: string,
): StorageDeletionIntentEnvelope {
  let raw: unknown;
  try {
    raw = JSON.parse(value);
  } catch {
    throw new StorageLifecycleContractError("corrupt");
  }
  const parsed = exactObject(raw, [
    "schema",
    "organisationId",
    "projectId",
    "objectPath",
    "aggregateType",
    "aggregateId",
    "reason",
    "requestedAt",
    "requestSha256",
    "maximumAttempts",
  ]);
  if (!parsed) throw new StorageLifecycleContractError("corrupt");
  const candidate = parsed as unknown as StorageDeletionIntentEnvelope;
  if (
    candidate.schema !== STORAGE_DELETION_INTENT_SCHEMA ||
    !UUID.test(candidate.organisationId) ||
    (candidate.projectId !== null && !UUID.test(String(candidate.projectId))) ||
    !boundedText(
      candidate.objectPath,
      STORAGE_LIFECYCLE_BOUNDS.objectPathCodeUnits,
    ) ||
    !candidate.objectPath.startsWith(
      `/objects/tenants/${candidate.organisationId}/`,
    ) ||
    !["document", "vault_item", "upload_session"].includes(
      candidate.aggregateType,
    ) ||
    !UUID.test(candidate.aggregateId) ||
    !["record_deleted", "reference_replaced", "lease_expired"].includes(
      candidate.reason,
    ) ||
    !instant(candidate.requestedAt) ||
    candidate.maximumAttempts !== STORAGE_LIFECYCLE_BOUNDS.maximumAttempts ||
    !SHA256.test(candidate.requestSha256)
  ) {
    throw new StorageLifecycleContractError("corrupt");
  }
  const { requestSha256, ...material } = candidate;
  if (storageLifecycleSha256(material) !== requestSha256) {
    throw new StorageLifecycleContractError("corrupt");
  }
  return candidate;
}
