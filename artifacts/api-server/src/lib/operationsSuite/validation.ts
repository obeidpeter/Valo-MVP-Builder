import { ID_PATTERN, OPERATIONS_SUITE_BOUNDS, SHA256_PATTERN } from "./bounds";
import { OperationsSuiteError } from "./errors";

export function invalid(message: string): never {
  throw new OperationsSuiteError("invalid_request", message);
}

export function requireObject(
  value: unknown,
  label = "request",
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalid(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

export function assertOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label = "request",
): void {
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
  if (unexpected) invalid(`${label} contains unsupported field ${unexpected}.`);
}

export function requiredText(
  value: unknown,
  label: string,
  max: number = OPERATIONS_SUITE_BOUNDS.textCodeUnits,
): string {
  if (typeof value !== "string") invalid(`${label} must be text.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    invalid(`${label} must contain 1-${max} code units.`);
  }
  return normalized;
}

export function optionalText(
  value: unknown,
  label: string,
  max: number = OPERATIONS_SUITE_BOUNDS.textCodeUnits,
): string | null {
  if (value === undefined || value === null) return null;
  return requiredText(value, label, max);
}

export function requiredId(value: unknown, label: string): string {
  const id = requiredText(
    value,
    label,
    OPERATIONS_SUITE_BOUNDS.shortTextCodeUnits,
  );
  if (!ID_PATTERN.test(id))
    invalid(`${label} has an invalid identifier format.`);
  return id;
}

export function optionalId(value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null;
  return requiredId(value, label);
}

export function requiredSha256(value: unknown, label: string): string {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    invalid(`${label} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

export function optionalSha256(value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null;
  return requiredSha256(value, label);
}

export function isoInstant(value: unknown, label: string): string {
  if (typeof value !== "string") invalid(`${label} must be an ISO timestamp.`);
  const time = Date.parse(value);
  if (!Number.isFinite(time)) invalid(`${label} must be an ISO timestamp.`);
  return new Date(time).toISOString();
}

export function optionalIsoInstant(
  value: unknown,
  label: string,
): string | null {
  if (value === undefined || value === null) return null;
  return isoInstant(value, label);
}

export function requiredBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") invalid(`${label} must be a boolean.`);
  return value;
}

export function optionalBoolean(
  value: unknown,
  label: string,
  fallback: boolean,
): boolean {
  return value === undefined ? fallback : requiredBoolean(value, label);
}

export function safeInteger(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < minimum ||
    (value as number) > maximum
  ) {
    invalid(`${label} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value as number;
}

export function expectedVersion(value: unknown): number {
  return safeInteger(value, "expectedVersion", 1, Number.MAX_SAFE_INTEGER);
}

export function oneOf<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  label: string,
): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) {
    invalid(`${label} is not supported.`);
  }
  return value as T[number];
}

export function boundedArray(
  value: unknown,
  label: string,
  maximum: number,
): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) {
    invalid(`${label} must be an array of no more than ${maximum} items.`);
  }
  return value;
}

export function uniqueIds(
  value: unknown,
  label: string,
  maximum: number = OPERATIONS_SUITE_BOUNDS.linksPerType,
): string[] {
  if (value === undefined) return [];
  const ids = boundedArray(value, label, maximum).map((item, index) =>
    requiredId(item, `${label}[${index}]`),
  );
  if (new Set(ids).size !== ids.length)
    invalid(`${label} contains duplicates.`);
  return ids;
}

export function requiredReason(value: unknown, label = "reason"): string {
  return requiredText(value, label, 1_024);
}

export function cloneValue<T>(value: T): T {
  return structuredClone(value);
}
