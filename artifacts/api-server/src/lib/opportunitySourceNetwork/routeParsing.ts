import type {
  OpportunitySourceDecision,
  OpportunitySourceInput,
} from "./contracts";

const INPUT_KEYS = [
  "sourceKind",
  "sourceSystem",
  "sourceAuthority",
  "sourceLocator",
  "sourceLicenceReference",
  "externalReference",
  "title",
  "procuringEntity",
  "jurisdiction",
  "fundingSource",
  "procurementCategory",
  "publishedAt",
  "submissionDeadline",
  "observedAt",
  "sourceContentSha256",
] as const;

function isPlain(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const expected = new Set(keys);
  return (
    Object.keys(value).length === expected.size &&
    Object.keys(value).every((key) => expected.has(key))
  );
}

export function parseManualOpportunitySourceBody(
  value: unknown,
): OpportunitySourceInput | null {
  if (!isPlain(value) || !exactKeys(value, INPUT_KEYS)) return null;
  return value as unknown as OpportunitySourceInput;
}

export function parseOpportunitySourceDecisionBody(
  value: unknown,
): OpportunitySourceDecision | null {
  if (
    !isPlain(value) ||
    !exactKeys(value, ["expectedVersion", "decision", "reason"]) ||
    !Number.isSafeInteger(value.expectedVersion) ||
    (value.expectedVersion as number) < 1 ||
    (value.decision !== "accept" && value.decision !== "reject") ||
    typeof value.reason !== "string"
  ) {
    return null;
  }
  return value as unknown as OpportunitySourceDecision;
}
