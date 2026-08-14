/**
 * Shared structural guards for parsing request bodies and persisted
 * envelopes. The strict and loose variants treat class instances
 * differently — they are NOT interchangeable at a call site.
 */

/**
 * Strict: accepts only records whose prototype is Object.prototype or null.
 * Class instances (Date, Map, Buffer, ...) are rejected.
 */
export function isPlainRecord(
  value: unknown,
): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Loose: any non-null, non-array object — class instances included.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
