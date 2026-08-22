import { canonicalJsonStrict, sha256Hex } from "../canonicalDigest";
import { SHA256_HEX_PATTERN, UUID_PATTERN } from "../identifierPatterns";
import { RETENTION_COMPLETION_BOUNDS } from "./contracts";

export const RETENTION_SOURCE_MANIFEST_SCHEMA =
  "valo.retention-completion-source-manifest/v1" as const;
export const RETENTION_RECONCILIATION_MANIFEST_SCHEMA =
  "valo.retention-completion-reconciliation-manifest/v1" as const;
export const RETENTION_CERTIFICATE_MANIFEST_SCHEMA =
  "valo.retention-completion-certificate-manifest/v1" as const;
export const RETENTION_PURGE_RECEIPT_SCHEMA =
  "valo.retention-project-purge-receipt/v1" as const;

export interface RetentionManifestCategory {
  category: string;
  count: number;
  identitiesSha256: string;
}

export interface RetentionManifestStorageObject {
  objectPathSha256: string;
  sourceKind:
    | "document"
    | "document_version"
    | "report"
    | "package_version"
    | "upload_session";
}

export interface RetentionSourceManifest {
  schema: typeof RETENTION_SOURCE_MANIFEST_SCHEMA;
  organisationId: string;
  retentionRequestId: string;
  retentionActionId: string;
  subjectProjectId: string;
  requestVersion: number;
  projectVersion: number;
  projectStatus: "signed_off" | "exported";
  capturedAt: string;
  idempotencyKeySha256: string;
  attestationSha256: string;
  categories: readonly RetentionManifestCategory[];
  storageObjects: readonly RetentionManifestStorageObject[];
  retainedCategories: readonly {
    category: string;
    reason: string;
    count: number;
  }[];
}

export interface RetentionReconciliationManifestEvent {
  storageEventId: string;
  requestSha256: string;
  objectPathSha256: string;
  boundEventVersion: number;
  terminalDisposition: "deleted" | "already_absent";
  terminalEventVersion: number;
  terminalAt: string;
}

export interface RetentionProjectPurgeReceipt {
  schema: typeof RETENTION_PURGE_RECEIPT_SCHEMA;
  organisationId: string;
  retentionRequestId: string;
  retentionActionId: string;
  subjectProjectId: string;
  sourceManifestSha256: string;
  actionVersionBefore: 2;
  actionVersionAfter: 3;
  deletedProjectRows: 1;
  deletedDocumentVersionSnapshotRows: number;
  detachedLegalHoldRows: number;
  detachedOrderRows: number;
  detachedEntitlementUsageRows: number;
  purgedAt: string;
  method: "owner_held_manifest_bound_project_purge";
}

export interface RetentionReconciliationManifest {
  schema: typeof RETENTION_RECONCILIATION_MANIFEST_SCHEMA;
  organisationId: string;
  retentionRequestId: string;
  retentionActionId: string;
  subjectProjectId: string;
  sourceManifestSha256: string;
  purgeReceiptSha256: string;
  purgedAt: string;
  reconciledAt: string;
  idempotencyKeySha256: string;
  attestationSha256: string;
  events: readonly RetentionReconciliationManifestEvent[];
}

export interface RetentionCertificateManifest {
  schema: typeof RETENTION_CERTIFICATE_MANIFEST_SCHEMA;
  organisationId: string;
  retentionRequestId: string;
  retentionActionId: string;
  subjectProjectId: string;
  sourceManifestSha256: string;
  purgeReceiptSha256: string;
  purgedAt: string;
  reconciliationManifestSha256: string;
  preparedByUserId: string;
  preparedByName: string;
  preparedAt: string;
  checkedByUserId: string;
  checkedByName: string;
  checkedAt: string;
  idempotencyKeySha256: string;
  attestationSha256: string;
  method: "durable_two_phase_detach_reconcile_certify";
}

export class RetentionManifestError extends Error {
  constructor() {
    super("invalid_retention_manifest");
    this.name = "RetentionManifestError";
  }
}

function canonical(value: unknown): string {
  const serialized = canonicalJsonStrict(value, () => {
    throw new RetentionManifestError();
  });
  if (
    Buffer.byteLength(serialized, "utf8") >
    RETENTION_COMPLETION_BOUNDS.manifestBytes
  ) {
    throw new RetentionManifestError();
  }
  return serialized;
}

export function retentionManifestSha256(value: unknown): string {
  return sha256Hex(canonical(value));
}

export function serializeRetentionManifest(value: unknown): string {
  return canonical(value);
}

export function parsePersistedManifest(value: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new RetentionManifestError();
  }
  if (canonical(parsed) !== value) throw new RetentionManifestError();
  return parsed;
}

export function digestSortedIdentities(values: readonly string[]): string {
  const unique = [...new Set(values)].sort();
  return retentionManifestSha256(unique);
}

export function assertManifestIdentity(value: string): string {
  if (!UUID_PATTERN.test(value)) throw new RetentionManifestError();
  return value;
}

export function assertManifestDigest(value: string): string {
  if (!SHA256_HEX_PATTERN.test(value)) throw new RetentionManifestError();
  return value;
}

function record(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RetentionManifestError();
  }
  const candidate = value as Record<string, unknown>;
  const expected = new Set(keys);
  if (
    Object.keys(candidate).length !== expected.size ||
    Object.keys(candidate).some((key) => !expected.has(key))
  ) {
    throw new RetentionManifestError();
  }
  return candidate;
}

function instant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString() === value;
}

function integer(value: unknown, minimum = 0): value is number {
  return Number.isSafeInteger(value) && Number(value) >= minimum;
}

function boundedText(value: unknown, maximum = 512): value is string {
  return (
    typeof value === "string" &&
    value === value.trim() &&
    value.length >= 1 &&
    value.length <= maximum &&
    !/[\u0000-\u001f\u007f\ud800-\udfff]/u.test(value)
  );
}

function requireUuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new RetentionManifestError();
  }
  return value;
}

function requireDigest(value: unknown): string {
  if (typeof value !== "string" || !SHA256_HEX_PATTERN.test(value)) {
    throw new RetentionManifestError();
  }
  return value;
}

function isStrictlySortedUnique(values: readonly string[]): boolean {
  return values.every(
    (value, index) => index === 0 || values[index - 1]! < value,
  );
}

/** Parse and verify the exact immutable source manifest persisted at detach. */
export function parseRetentionSourceManifest(
  value: string,
  expectedSha256?: string,
): RetentionSourceManifest {
  const parsed = parsePersistedManifest(value);
  if (expectedSha256 && retentionManifestSha256(parsed) !== expectedSha256) {
    throw new RetentionManifestError();
  }
  const candidate = record(parsed, [
    "schema",
    "organisationId",
    "retentionRequestId",
    "retentionActionId",
    "subjectProjectId",
    "requestVersion",
    "projectVersion",
    "projectStatus",
    "capturedAt",
    "idempotencyKeySha256",
    "attestationSha256",
    "categories",
    "storageObjects",
    "retainedCategories",
  ]);
  if (
    candidate.schema !== RETENTION_SOURCE_MANIFEST_SCHEMA ||
    !integer(candidate.requestVersion, 1) ||
    !integer(candidate.projectVersion, 1) ||
    (candidate.projectStatus !== "signed_off" &&
      candidate.projectStatus !== "exported") ||
    !instant(candidate.capturedAt) ||
    !Array.isArray(candidate.categories) ||
    candidate.categories.length >
      RETENTION_COMPLETION_BOUNDS.sourceCategories ||
    !Array.isArray(candidate.storageObjects) ||
    candidate.storageObjects.length >
      RETENTION_COMPLETION_BOUNDS.storageObjects ||
    !Array.isArray(candidate.retainedCategories) ||
    candidate.retainedCategories.length >
      RETENTION_COMPLETION_BOUNDS.retainedCategories
  ) {
    throw new RetentionManifestError();
  }
  requireUuid(candidate.organisationId);
  requireUuid(candidate.retentionRequestId);
  requireUuid(candidate.retentionActionId);
  requireUuid(candidate.subjectProjectId);
  requireDigest(candidate.idempotencyKeySha256);
  requireDigest(candidate.attestationSha256);

  const categoryKeys = candidate.categories.map((entry) => {
    const category = record(entry, ["category", "count", "identitiesSha256"]);
    if (!boundedText(category.category, 128) || !integer(category.count)) {
      throw new RetentionManifestError();
    }
    requireDigest(category.identitiesSha256);
    return category.category;
  });
  const objectKeys = candidate.storageObjects.map((entry) => {
    const object = record(entry, ["objectPathSha256", "sourceKind"]);
    requireDigest(object.objectPathSha256);
    if (
      ![
        "document",
        "document_version",
        "report",
        "package_version",
        "upload_session",
      ].includes(String(object.sourceKind))
    ) {
      throw new RetentionManifestError();
    }
    return `${String(object.objectPathSha256)}\0${String(object.sourceKind)}`;
  });
  const retainedKeys = candidate.retainedCategories.map((entry) => {
    const retained = record(entry, ["category", "reason", "count"]);
    if (
      ![
        "audit_evidence",
        "financial_accounting",
        "legal_hold_evidence",
        "retention_control",
        "vault_reference",
      ].includes(String(retained.category)) ||
      !boundedText(retained.category, 128) ||
      !boundedText(retained.reason, 1_024) ||
      !integer(retained.count)
    ) {
      throw new RetentionManifestError();
    }
    return retained.category;
  });
  if (
    !isStrictlySortedUnique(categoryKeys) ||
    !isStrictlySortedUnique(objectKeys) ||
    !isStrictlySortedUnique(retainedKeys)
  ) {
    throw new RetentionManifestError();
  }
  return candidate as unknown as RetentionSourceManifest;
}

/** Parse exact terminal evidence bound to a detached action. */
export function parseRetentionReconciliationManifest(
  value: string,
  expectedSha256?: string,
): RetentionReconciliationManifest {
  const parsed = parsePersistedManifest(value);
  if (expectedSha256 && retentionManifestSha256(parsed) !== expectedSha256) {
    throw new RetentionManifestError();
  }
  const candidate = record(parsed, [
    "schema",
    "organisationId",
    "retentionRequestId",
    "retentionActionId",
    "subjectProjectId",
    "sourceManifestSha256",
    "purgeReceiptSha256",
    "purgedAt",
    "reconciledAt",
    "idempotencyKeySha256",
    "attestationSha256",
    "events",
  ]);
  if (
    candidate.schema !== RETENTION_RECONCILIATION_MANIFEST_SCHEMA ||
    !instant(candidate.purgedAt) ||
    !instant(candidate.reconciledAt) ||
    !Array.isArray(candidate.events) ||
    candidate.events.length > RETENTION_COMPLETION_BOUNDS.storageObjects
  ) {
    throw new RetentionManifestError();
  }
  requireUuid(candidate.organisationId);
  requireUuid(candidate.retentionRequestId);
  requireUuid(candidate.retentionActionId);
  requireUuid(candidate.subjectProjectId);
  requireDigest(candidate.sourceManifestSha256);
  requireDigest(candidate.purgeReceiptSha256);
  requireDigest(candidate.idempotencyKeySha256);
  requireDigest(candidate.attestationSha256);
  const eventKeys = candidate.events.map((entry) => {
    const event = record(entry, [
      "storageEventId",
      "requestSha256",
      "objectPathSha256",
      "boundEventVersion",
      "terminalDisposition",
      "terminalEventVersion",
      "terminalAt",
    ]);
    requireUuid(event.storageEventId);
    requireDigest(event.requestSha256);
    requireDigest(event.objectPathSha256);
    if (
      !integer(event.boundEventVersion, 1) ||
      !integer(event.terminalEventVersion, Number(event.boundEventVersion)) ||
      (event.terminalDisposition !== "deleted" &&
        event.terminalDisposition !== "already_absent") ||
      !instant(event.terminalAt)
    ) {
      throw new RetentionManifestError();
    }
    return String(event.storageEventId);
  });
  if (!isStrictlySortedUnique(eventKeys)) throw new RetentionManifestError();
  return candidate as unknown as RetentionReconciliationManifest;
}

/** Parse the immutable receipt stamped only by the owner-held purge routine. */
export function parseRetentionProjectPurgeReceipt(
  value: string,
  expectedSha256?: string,
): RetentionProjectPurgeReceipt {
  const parsed = parsePersistedManifest(value);
  if (expectedSha256 && retentionManifestSha256(parsed) !== expectedSha256) {
    throw new RetentionManifestError();
  }
  const candidate = record(parsed, [
    "schema",
    "organisationId",
    "retentionRequestId",
    "retentionActionId",
    "subjectProjectId",
    "sourceManifestSha256",
    "actionVersionBefore",
    "actionVersionAfter",
    "deletedProjectRows",
    "deletedDocumentVersionSnapshotRows",
    "detachedLegalHoldRows",
    "detachedOrderRows",
    "detachedEntitlementUsageRows",
    "purgedAt",
    "method",
  ]);
  if (
    candidate.schema !== RETENTION_PURGE_RECEIPT_SCHEMA ||
    candidate.actionVersionBefore !== 2 ||
    candidate.actionVersionAfter !== 3 ||
    candidate.deletedProjectRows !== 1 ||
    !integer(candidate.deletedDocumentVersionSnapshotRows) ||
    !integer(candidate.detachedLegalHoldRows) ||
    !integer(candidate.detachedOrderRows) ||
    !integer(candidate.detachedEntitlementUsageRows) ||
    !instant(candidate.purgedAt) ||
    candidate.method !== "owner_held_manifest_bound_project_purge"
  ) {
    throw new RetentionManifestError();
  }
  for (const key of [
    "organisationId",
    "retentionRequestId",
    "retentionActionId",
    "subjectProjectId",
  ] as const) {
    requireUuid(candidate[key]);
  }
  requireDigest(candidate.sourceManifestSha256);
  return candidate as unknown as RetentionProjectPurgeReceipt;
}

export function parseRetentionCertificateManifest(
  value: string,
  expectedSha256?: string,
): RetentionCertificateManifest {
  const parsed = parsePersistedManifest(value);
  if (expectedSha256 && retentionManifestSha256(parsed) !== expectedSha256) {
    throw new RetentionManifestError();
  }
  const candidate = record(parsed, [
    "schema",
    "organisationId",
    "retentionRequestId",
    "retentionActionId",
    "subjectProjectId",
    "sourceManifestSha256",
    "purgeReceiptSha256",
    "purgedAt",
    "reconciliationManifestSha256",
    "preparedByUserId",
    "preparedByName",
    "preparedAt",
    "checkedByUserId",
    "checkedByName",
    "checkedAt",
    "idempotencyKeySha256",
    "attestationSha256",
    "method",
  ]);
  if (
    candidate.schema !== RETENTION_CERTIFICATE_MANIFEST_SCHEMA ||
    candidate.method !== "durable_two_phase_detach_reconcile_certify" ||
    !boundedText(candidate.preparedByName, 256) ||
    !boundedText(candidate.checkedByName, 256) ||
    !instant(candidate.purgedAt) ||
    !instant(candidate.preparedAt) ||
    !instant(candidate.checkedAt)
  ) {
    throw new RetentionManifestError();
  }
  for (const key of [
    "organisationId",
    "retentionRequestId",
    "retentionActionId",
    "subjectProjectId",
    "preparedByUserId",
    "checkedByUserId",
  ] as const) {
    requireUuid(candidate[key]);
  }
  if (candidate.preparedByUserId === candidate.checkedByUserId) {
    throw new RetentionManifestError();
  }
  for (const key of [
    "sourceManifestSha256",
    "purgeReceiptSha256",
    "reconciliationManifestSha256",
    "idempotencyKeySha256",
    "attestationSha256",
  ] as const) {
    requireDigest(candidate[key]);
  }
  return candidate as unknown as RetentionCertificateManifest;
}
