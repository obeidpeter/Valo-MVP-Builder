import { createHash } from "node:crypto";

const MAX_SOURCE_RECORDS = 32_768;
const MAX_ID_LENGTH = 200;
const MAX_FINGERPRINT_PAYLOAD_BYTES = 4_000_000;
const SHA256 = /^[a-f0-9]{64}$/u;

export const INTELLIGENCE_SOURCE_VERSION_BOUNDS = Object.freeze({
  maxSourceRecords: MAX_SOURCE_RECORDS,
  maxIdLength: MAX_ID_LENGTH,
  maxFingerprintPayloadBytes: MAX_FINGERPRINT_PAYLOAD_BYTES,
});

export interface IntelligenceSourceVersionRecord {
  kind: string;
  id: string;
  version: number;
  fingerprint?: string;
}

export interface IntelligenceSourceVersion {
  version: number;
  manifestHash: string;
}

function validToken(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= MAX_ID_LENGTH &&
    !/[\u0000-\u001f]/u.test(value)
  );
}

function canonicalValue(value: unknown, seen: Set<object>): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new Error("AI_SOURCE_FINGERPRINT_INVALID");
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value === "bigint") return `bigint:${value.toString(10)}`;
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime()))
      throw new Error("AI_SOURCE_FINGERPRINT_INVALID");
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new Error("AI_SOURCE_FINGERPRINT_INVALID");
    seen.add(value);
    const output = value.map((item) => canonicalValue(item, seen));
    seen.delete(value);
    return output;
  }
  if (typeof value !== "object" || value === undefined)
    throw new Error("AI_SOURCE_FINGERPRINT_INVALID");
  if (seen.has(value)) throw new Error("AI_SOURCE_FINGERPRINT_INVALID");
  seen.add(value);
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const item = (value as Record<string, unknown>)[key];
    output[key] =
      item === undefined ? "__valo_undefined__" : canonicalValue(item, seen);
  }
  seen.delete(value);
  return output;
}

/**
 * Produces a content-safe canonical fingerprint. Callers persist or bind only
 * the digest; raw mutable fields never enter the review manifest.
 */
export function hashIntelligenceSourceFields(value: unknown): string {
  const canonical = JSON.stringify(canonicalValue(value, new Set()));
  if (Buffer.byteLength(canonical, "utf8") > MAX_FINGERPRINT_PAYLOAD_BYTES)
    throw new Error("AI_SOURCE_FINGERPRINT_BOUND_EXCEEDED");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function computeIntelligenceSourceVersion(input: {
  projectId: string;
  records: readonly IntelligenceSourceVersionRecord[];
}): IntelligenceSourceVersion {
  if (!validToken(input.projectId)) {
    throw new Error("AI_SOURCE_VERSION_INVALID_SCOPE");
  }
  if (input.records.length === 0 || input.records.length > MAX_SOURCE_RECORDS) {
    throw new Error("AI_SOURCE_VERSION_INVALID_RECORD_COUNT");
  }

  const seen = new Set<string>();
  const canonical = input.records
    .map((record) => {
      if (
        !validToken(record.kind) ||
        !validToken(record.id) ||
        !Number.isSafeInteger(record.version) ||
        record.version < 1 ||
        (record.fingerprint !== undefined && !SHA256.test(record.fingerprint))
      ) {
        throw new Error("AI_SOURCE_VERSION_INVALID_RECORD");
      }
      const identity = `${record.kind}\u001f${record.id}`;
      if (seen.has(identity))
        throw new Error("AI_SOURCE_VERSION_DUPLICATE_RECORD");
      seen.add(identity);
      return `${record.kind}\u001f${record.id}\u001f${record.version}\u001f${record.fingerprint ?? "-"}`;
    })
    .sort((left, right) => left.localeCompare(right));
  const manifestHash = createHash("sha256")
    .update(`${input.projectId}\u001e${canonical.join("\u001e")}`, "utf8")
    .digest("hex");
  // reviews.source_version is a positive PostgreSQL integer. Keep the full
  // SHA-256 alongside API evidence while deriving a stable non-zero lock value.
  const version =
    (Number.parseInt(manifestHash.slice(0, 8), 16) % 2_147_483_646) + 1;
  return { version, manifestHash };
}
