import { createHash } from "node:crypto";

/**
 * Deterministic UUID derivations shared by durable services and repositories.
 *
 * The outputs of both helpers are PERSISTED as row identities and replay
 * keys. The algorithms must never change — any alteration would break
 * idempotent replay against rows already written with the previous outputs.
 */

/**
 * sha256(seed) -> first 16 digest bytes -> RFC 4122 version/variant bit
 * twiddling (version nibble forced to 4, variant bits to 10xx).
 *
 * Outputs are PERSISTED; the algorithm must never change.
 */
export function deterministicUuidFromBytes(seed: string): string {
  const bytes = Buffer.from(
    createHash("sha256").update(seed).digest("hex").slice(0, 32),
    "hex",
  );
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * sha256(seed) hex -> dash-grouped slices with literal version "5" and
 * variant "a" nibbles spliced in (hex characters 12 and 16 are dropped).
 * Note this is NOT output-compatible with deterministicUuidFromBytes.
 *
 * Outputs are PERSISTED; the algorithm must never change.
 */
export function deterministicUuidFromHex(seed: string): string {
  const hex = createHash("sha256")
    .update(seed, "utf8")
    .digest("hex")
    .slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
