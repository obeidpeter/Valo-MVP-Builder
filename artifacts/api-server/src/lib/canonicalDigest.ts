import { createHash } from "node:crypto";

/**
 * Canonical-JSON serializers backing persisted audit digests.
 *
 * Three dialects exist on purpose and MUST NOT be merged: sorted key order
 * differs between `localeCompare` and code-unit `sort()` for non-ASCII keys,
 * and the strict dialect rejects non-JSON primitives instead of serializing
 * them. Every dialect's output feeds sha256 digests that are persisted in
 * audit ledgers, so each byte of output is a compatibility contract — see
 * canonicalDigest.golden.test.ts.
 */

type JsonRecord = Readonly<Record<string, unknown>>;

/** Dialect: recursive, keys sorted with `String.prototype.localeCompare`. */
export function canonicalJsonLocale(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJsonLocale).join(",")}]`;
  }
  return `{${Object.entries(value as JsonRecord)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJsonLocale(item)}`)
    .join(",")}}`;
}

/** Dialect: recursive, keys sorted by UTF-16 code units (`Array.sort()`). */
export function canonicalJsonCodeUnit(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJsonCodeUnit).join(",")}]`;
  }
  const record = value as JsonRecord;
  return `{${Object.keys(record)
    .sort()
    .map(
      (key) => `${JSON.stringify(key)}:${canonicalJsonCodeUnit(record[key])}`,
    )
    .join(",")}}`;
}

/**
 * Dialect: code-unit key order with a strict JSON-primitive whitelist; any
 * other value (undefined, function, symbol, bigint) invokes the vertical's
 * `onInvalid` callback, which must throw its module error.
 */
export function canonicalJsonStrict(
  value: unknown,
  onInvalid: () => never,
): string {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJsonStrict(item, onInvalid)).join(",")}]`;
  }
  if (typeof value !== "object") {
    onInvalid();
  }
  const record = value as JsonRecord;
  return `{${Object.keys(record)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${canonicalJsonStrict(record[key]!, onInvalid)}`,
    )
    .join(",")}}`;
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
