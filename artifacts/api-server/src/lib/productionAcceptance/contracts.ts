export const PRODUCTION_ACCEPTANCE_CATEGORIES = [
  "migration",
  "rls",
  "tenant_isolation",
  "browser_accessibility",
  "backup",
  "restore",
  "rollback",
] as const;

export type ProductionAcceptanceCategory =
  (typeof PRODUCTION_ACCEPTANCE_CATEGORIES)[number];

export type ProductionAcceptanceEnvironment =
  | "staging"
  | "production"
  | "recovery_rehearsal";

export type ProductionAcceptanceOutcome = "passed" | "failed";

export type ProductionAcceptanceState =
  | "passed"
  | "failed"
  | "missing"
  | "expired"
  | "release_mismatch"
  | "integrity_failed";

export const PRODUCTION_ACCEPTANCE_EVIDENCE_SCHEMA =
  "valo.production-acceptance-evidence/v1" as const;

export const PRODUCTION_ACCEPTANCE_BOUNDS = Object.freeze({
  maxEvidenceRecords: 500,
  maxAuthorities: 100,
  maxIdCodeUnits: 128,
  maxReferenceCodeUnits: 256,
  maxSummaryCodeUnits: 1_000,
  maxFutureClockSkewMs: 5 * 60 * 1_000,
});

export interface ProductionAcceptanceEvidenceDraft {
  category: ProductionAcceptanceCategory;
  outcome: ProductionAcceptanceOutcome;
  environment: ProductionAcceptanceEnvironment;
  releaseSha256: string;
  ownerUserId: string;
  observedAt: string;
  expiresAt: string;
  evidenceReference: string;
  artifactSha256: string;
  summary: string;
  idempotencyKey: string;
}

export interface ProductionAcceptanceEvidenceRecord {
  schema: typeof PRODUCTION_ACCEPTANCE_EVIDENCE_SCHEMA;
  id: string;
  organisationId: string;
  category: ProductionAcceptanceCategory;
  outcome: ProductionAcceptanceOutcome;
  environment: ProductionAcceptanceEnvironment;
  releaseSha256: string;
  ownerUserId: string;
  verifiedByUserId: string;
  observedAt: string;
  expiresAt: string;
  evidenceReference: string;
  artifactSha256: string;
  summary: string;
  recordedAt: string;
  evidenceDigest: string;
}

export interface ProductionAcceptanceCategorySnapshot {
  category: ProductionAcceptanceCategory;
  label: string;
  state: ProductionAcceptanceState;
  required: true;
  latestEvidence: ProductionAcceptanceEvidenceRecord | null;
}

export interface ProductionAcceptanceBlocker {
  code: string;
  category: ProductionAcceptanceCategory | null;
  message: string;
}

export interface ProductionAcceptanceSnapshot {
  generatedAt: string;
  organisationId: string;
  expectedReleaseSha256: string | null;
  recommendedDecision: "go" | "no_go";
  deploymentAuthorized: false;
  requiresNamedHumanApproval: true;
  categories: readonly ProductionAcceptanceCategorySnapshot[];
  blockers: readonly ProductionAcceptanceBlocker[];
  authorityNote: string;
}

export interface ProductionAcceptanceScope {
  organisationId: string;
  actorUserId: string;
}

export interface ProductionAcceptanceAuthority {
  userId: string;
  name: string;
}

export type ProductionAcceptanceAppendResult =
  | {
      outcome: "appended" | "replayed";
      record: ProductionAcceptanceEvidenceRecord;
    }
  | { outcome: "idempotency_conflict" };

export interface ProductionAcceptanceRepository {
  listAuthorities(
    scope: ProductionAcceptanceScope,
    limit: number,
  ): Promise<readonly ProductionAcceptanceAuthority[]>;
  listEvidence(
    scope: ProductionAcceptanceScope,
    limit: number,
  ): Promise<readonly ProductionAcceptanceEvidenceRecord[]>;
  appendEvidence(
    scope: ProductionAcceptanceScope,
    idempotencyKey: string,
    requestDigest: string,
    record: ProductionAcceptanceEvidenceRecord,
  ): Promise<ProductionAcceptanceAppendResult>;
}

export class ProductionAcceptanceRepositoryUnavailableError extends Error {
  readonly name = "ProductionAcceptanceRepositoryUnavailableError";

  constructor() {
    super("Production acceptance repository is unavailable");
  }
}

export const unavailableProductionAcceptanceRepository: ProductionAcceptanceRepository =
  {
    listAuthorities: async () => {
      throw new ProductionAcceptanceRepositoryUnavailableError();
    },
    listEvidence: async () => {
      throw new ProductionAcceptanceRepositoryUnavailableError();
    },
    appendEvidence: async () => {
      throw new ProductionAcceptanceRepositoryUnavailableError();
    },
  };

const CATEGORY_SET = new Set<string>(PRODUCTION_ACCEPTANCE_CATEGORIES);
const ENVIRONMENT_SET = new Set<string>([
  "staging",
  "production",
  "recovery_rehearsal",
]);
const OUTCOME_SET = new Set<string>(["passed", "failed"]);
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const IDEMPOTENCY_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{15,127}$/u;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return (
    actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index])
  );
}

function boundedText(
  value: unknown,
  maxCodeUnits: number,
  allowNewlines: boolean,
): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxCodeUnits) return false;
  return allowNewlines
    ? !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(trimmed)
    : !/[\u0000-\u001f\u007f]/u.test(trimmed);
}

function validDate(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

export function isSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

export function parseProductionAcceptanceEvidenceDraft(
  value: unknown,
): ProductionAcceptanceEvidenceDraft | null {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, [
      "artifactSha256",
      "category",
      "environment",
      "evidenceReference",
      "expiresAt",
      "idempotencyKey",
      "observedAt",
      "outcome",
      "ownerUserId",
      "releaseSha256",
      "summary",
    ]) ||
    typeof value.category !== "string" ||
    !CATEGORY_SET.has(value.category) ||
    typeof value.environment !== "string" ||
    !ENVIRONMENT_SET.has(value.environment) ||
    typeof value.outcome !== "string" ||
    !OUTCOME_SET.has(value.outcome) ||
    !isSha256(value.releaseSha256) ||
    typeof value.ownerUserId !== "string" ||
    !UUID_PATTERN.test(value.ownerUserId) ||
    !validDate(value.observedAt) ||
    !validDate(value.expiresAt) ||
    !boundedText(
      value.evidenceReference,
      PRODUCTION_ACCEPTANCE_BOUNDS.maxReferenceCodeUnits,
      false,
    ) ||
    !isSha256(value.artifactSha256) ||
    !boundedText(
      value.summary,
      PRODUCTION_ACCEPTANCE_BOUNDS.maxSummaryCodeUnits,
      true,
    ) ||
    typeof value.idempotencyKey !== "string" ||
    !IDEMPOTENCY_PATTERN.test(value.idempotencyKey)
  ) {
    return null;
  }

  return {
    category: value.category as ProductionAcceptanceCategory,
    outcome: value.outcome as ProductionAcceptanceOutcome,
    environment: value.environment as ProductionAcceptanceEnvironment,
    releaseSha256: value.releaseSha256,
    ownerUserId: value.ownerUserId,
    observedAt: value.observedAt,
    expiresAt: value.expiresAt,
    evidenceReference: value.evidenceReference.trim(),
    artifactSha256: value.artifactSha256,
    summary: value.summary.trim(),
    idempotencyKey: value.idempotencyKey,
  };
}
