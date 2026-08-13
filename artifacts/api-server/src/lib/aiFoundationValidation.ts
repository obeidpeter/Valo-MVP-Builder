import { SHA256_HEX_PATTERN } from "./identifierPatterns";

/**
 * Shared fail-closed validation primitives for the AI foundation modules
 * (control plane, retrieval pipeline, continuous eval). Semantics are frozen:
 * loosening any predicate loosens three governance surfaces at once.
 */
export const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export const SHA256 = SHA256_HEX_PATTERN;
export const RFC3339_UTC =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

export const hasText = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

export const validIdentifier = (value: unknown): value is string =>
  hasText(value) && IDENTIFIER.test(value);

export const validIsoTimestamp = (value: unknown): value is string =>
  hasText(value) &&
  RFC3339_UTC.test(value) &&
  Number.isFinite(Date.parse(value));

export const validUnitScore = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= 1;

export const validNonNegativeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
