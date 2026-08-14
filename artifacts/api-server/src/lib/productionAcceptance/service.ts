import { canonicalJsonCodeUnit, sha256Hex } from "../canonicalDigest";
import {
  PRODUCTION_ACCEPTANCE_BOUNDS,
  PRODUCTION_ACCEPTANCE_CATEGORIES,
  PRODUCTION_ACCEPTANCE_EVIDENCE_SCHEMA,
  ProductionAcceptanceRepositoryUnavailableError,
  isSha256,
  type ProductionAcceptanceAppendResult,
  type ProductionAcceptanceBlocker,
  type ProductionAcceptanceCategory,
  type ProductionAcceptanceCategorySnapshot,
  type ProductionAcceptanceEvidenceDraft,
  type ProductionAcceptanceEvidenceRecord,
  type ProductionAcceptanceRepository,
  type ProductionAcceptanceScope,
  type ProductionAcceptanceSnapshot,
} from "./contracts";

const AUTHORITY_NOTE =
  "This console records and verifies evidence references only. It cannot run a migration, restore a backup, roll back a release or authorise deployment. A named human release authority must inspect the retained artefacts and make the final decision.";
import { UUID_PATTERN } from "../identifierPatterns";

const CATEGORY_LABELS: Readonly<Record<ProductionAcceptanceCategory, string>> =
  Object.freeze({
    migration: "Migration rehearsal",
    rls: "Row-level security",
    tenant_isolation: "Tenant isolation",
    browser_accessibility: "Browser and accessibility",
    backup: "Backup freshness",
    restore: "Restore rehearsal",
    rollback: "Rollback rehearsal",
  });

const MAX_VALIDITY_MS: Readonly<Record<ProductionAcceptanceCategory, number>> =
  Object.freeze({
    migration: 31 * 24 * 60 * 60 * 1_000,
    rls: 31 * 24 * 60 * 60 * 1_000,
    tenant_isolation: 31 * 24 * 60 * 60 * 1_000,
    browser_accessibility: 31 * 24 * 60 * 60 * 1_000,
    backup: 8 * 24 * 60 * 60 * 1_000,
    restore: 31 * 24 * 60 * 60 * 1_000,
    rollback: 91 * 24 * 60 * 60 * 1_000,
  });

type ValidationCode =
  | "INVALID_TIME_WINDOW"
  | "EVIDENCE_ALREADY_EXPIRED"
  | "EVIDENCE_WINDOW_TOO_LONG"
  | "OWNER_VERIFIER_CONFLICT";

export class ProductionAcceptanceValidationError extends Error {
  readonly name = "ProductionAcceptanceValidationError";

  constructor(readonly code: ValidationCode) {
    super(code);
  }
}

type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalValue[]
  | { readonly [key: string]: CanonicalValue };

function canonicalJson(value: CanonicalValue): string {
  return canonicalJsonCodeUnit(value);
}

function evidenceDigest(
  input: Omit<ProductionAcceptanceEvidenceRecord, "id" | "evidenceDigest">,
): string {
  return sha256Hex(canonicalJson(input));
}

function evidenceCore(
  record: ProductionAcceptanceEvidenceRecord,
): Omit<ProductionAcceptanceEvidenceRecord, "id" | "evidenceDigest"> {
  return {
    schema: record.schema,
    organisationId: record.organisationId,
    category: record.category,
    outcome: record.outcome,
    environment: record.environment,
    releaseSha256: record.releaseSha256,
    ownerUserId: record.ownerUserId,
    verifiedByUserId: record.verifiedByUserId,
    observedAt: record.observedAt,
    expiresAt: record.expiresAt,
    evidenceReference: record.evidenceReference,
    artifactSha256: record.artifactSha256,
    summary: record.summary,
    recordedAt: record.recordedAt,
  };
}

function evidenceRequestDigest(
  record: ProductionAcceptanceEvidenceRecord,
): string {
  const { recordedAt: _recordedAt, ...requestCore } = evidenceCore(record);
  return sha256Hex(canonicalJson(requestCore));
}

function normalizeIso(value: string): string {
  return new Date(value).toISOString();
}

export function createProductionAcceptanceEvidence(input: {
  draft: ProductionAcceptanceEvidenceDraft;
  scope: ProductionAcceptanceScope;
  now: Date;
}): ProductionAcceptanceEvidenceRecord {
  const observedAtMs = Date.parse(input.draft.observedAt);
  const expiresAtMs = Date.parse(input.draft.expiresAt);
  const nowMs = input.now.getTime();
  if (
    !Number.isFinite(nowMs) ||
    !Number.isFinite(observedAtMs) ||
    !Number.isFinite(expiresAtMs) ||
    observedAtMs > nowMs + PRODUCTION_ACCEPTANCE_BOUNDS.maxFutureClockSkewMs ||
    expiresAtMs <= observedAtMs
  ) {
    throw new ProductionAcceptanceValidationError("INVALID_TIME_WINDOW");
  }
  if (expiresAtMs <= nowMs) {
    throw new ProductionAcceptanceValidationError("EVIDENCE_ALREADY_EXPIRED");
  }
  if (expiresAtMs - observedAtMs > MAX_VALIDITY_MS[input.draft.category]) {
    throw new ProductionAcceptanceValidationError("EVIDENCE_WINDOW_TOO_LONG");
  }
  if (input.draft.ownerUserId === input.scope.actorUserId) {
    throw new ProductionAcceptanceValidationError("OWNER_VERIFIER_CONFLICT");
  }

  const core: Omit<
    ProductionAcceptanceEvidenceRecord,
    "id" | "evidenceDigest"
  > = {
    schema: PRODUCTION_ACCEPTANCE_EVIDENCE_SCHEMA,
    organisationId: input.scope.organisationId,
    category: input.draft.category,
    outcome: input.draft.outcome,
    environment: input.draft.environment,
    releaseSha256: input.draft.releaseSha256,
    ownerUserId: input.draft.ownerUserId,
    verifiedByUserId: input.scope.actorUserId,
    observedAt: normalizeIso(input.draft.observedAt),
    expiresAt: normalizeIso(input.draft.expiresAt),
    evidenceReference: input.draft.evidenceReference,
    artifactSha256: input.draft.artifactSha256,
    summary: input.draft.summary,
    recordedAt: input.now.toISOString(),
  };
  const digest = evidenceDigest(core);
  return { ...core, id: digest, evidenceDigest: digest };
}

function isEvidenceRecord(
  value: unknown,
): value is ProductionAcceptanceEvidenceRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const expectedKeys = [
    "artifactSha256",
    "category",
    "environment",
    "evidenceDigest",
    "evidenceReference",
    "expiresAt",
    "id",
    "observedAt",
    "organisationId",
    "outcome",
    "ownerUserId",
    "recordedAt",
    "releaseSha256",
    "schema",
    "summary",
    "verifiedByUserId",
  ];
  const keys = Object.keys(record).sort();
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index]) ||
    record.schema !== PRODUCTION_ACCEPTANCE_EVIDENCE_SCHEMA ||
    typeof record.category !== "string" ||
    !PRODUCTION_ACCEPTANCE_CATEGORIES.includes(
      record.category as ProductionAcceptanceCategory,
    ) ||
    (record.outcome !== "passed" && record.outcome !== "failed") ||
    !["staging", "production", "recovery_rehearsal"].includes(
      String(record.environment),
    ) ||
    !isSha256(record.releaseSha256) ||
    !isSha256(record.artifactSha256) ||
    !isSha256(record.id) ||
    !isSha256(record.evidenceDigest) ||
    record.id !== record.evidenceDigest ||
    typeof record.organisationId !== "string" ||
    !UUID_PATTERN.test(record.organisationId) ||
    typeof record.ownerUserId !== "string" ||
    !UUID_PATTERN.test(record.ownerUserId) ||
    typeof record.verifiedByUserId !== "string" ||
    !UUID_PATTERN.test(record.verifiedByUserId) ||
    record.ownerUserId === record.verifiedByUserId ||
    typeof record.evidenceReference !== "string" ||
    !record.evidenceReference ||
    typeof record.summary !== "string" ||
    !record.summary ||
    typeof record.observedAt !== "string" ||
    Number.isNaN(Date.parse(record.observedAt)) ||
    typeof record.expiresAt !== "string" ||
    Number.isNaN(Date.parse(record.expiresAt)) ||
    typeof record.recordedAt !== "string" ||
    Number.isNaN(Date.parse(record.recordedAt))
  ) {
    return false;
  }
  return true;
}

export function verifyProductionAcceptanceEvidenceDigest(
  value: unknown,
): value is ProductionAcceptanceEvidenceRecord {
  return (
    isEvidenceRecord(value) &&
    evidenceDigest(evidenceCore(value)) === value.evidenceDigest
  );
}

function latestRecord(
  records: readonly ProductionAcceptanceEvidenceRecord[],
): ProductionAcceptanceEvidenceRecord | null {
  return (
    [...records].sort((left, right) => {
      const observedDifference =
        Date.parse(right.observedAt) - Date.parse(left.observedAt);
      if (observedDifference !== 0) return observedDifference;
      const recordedDifference =
        Date.parse(right.recordedAt) - Date.parse(left.recordedAt);
      if (recordedDifference !== 0) return recordedDifference;
      return right.evidenceDigest.localeCompare(left.evidenceDigest);
    })[0] ?? null
  );
}

function blocker(
  category: ProductionAcceptanceCategory,
  suffix: string,
  message: string,
): ProductionAcceptanceBlocker {
  return {
    code: `${category.toUpperCase()}_${suffix}`,
    category,
    message,
  };
}

export function buildProductionAcceptanceSnapshot(input: {
  organisationId: string;
  evidence: readonly unknown[];
  expectedReleaseSha256: string | null;
  now: Date;
}): ProductionAcceptanceSnapshot {
  const nowMs = input.now.getTime();
  const expectedReleaseSha256 = isSha256(input.expectedReleaseSha256)
    ? input.expectedReleaseSha256
    : null;
  const blockers: ProductionAcceptanceBlocker[] = [];
  let globalIntegrityFailure =
    input.evidence.length > PRODUCTION_ACCEPTANCE_BOUNDS.maxEvidenceRecords;
  const validEvidence: ProductionAcceptanceEvidenceRecord[] = [];
  const invalidCategories = new Set<ProductionAcceptanceCategory>();

  for (const candidate of input.evidence.slice(
    0,
    PRODUCTION_ACCEPTANCE_BOUNDS.maxEvidenceRecords,
  )) {
    if (
      !verifyProductionAcceptanceEvidenceDigest(candidate) ||
      candidate.organisationId !== input.organisationId
    ) {
      if (
        typeof candidate === "object" &&
        candidate !== null &&
        "category" in candidate &&
        typeof candidate.category === "string" &&
        PRODUCTION_ACCEPTANCE_CATEGORIES.includes(
          candidate.category as ProductionAcceptanceCategory,
        )
      ) {
        invalidCategories.add(
          candidate.category as ProductionAcceptanceCategory,
        );
      } else {
        globalIntegrityFailure = true;
      }
      continue;
    }
    validEvidence.push(candidate);
  }

  if (!expectedReleaseSha256) {
    blockers.push({
      code: "CURRENT_RELEASE_UNAVAILABLE",
      category: null,
      message:
        "The exact release SHA-256 is not configured, so evidence cannot be bound to the candidate being assessed.",
    });
  }
  if (globalIntegrityFailure) {
    blockers.push({
      code: "EVIDENCE_INTEGRITY_FAILED",
      category: null,
      message:
        "At least one stored evidence record is malformed, cross-tenant or exceeds the bounded evidence register.",
    });
  }

  const categories: ProductionAcceptanceCategorySnapshot[] =
    PRODUCTION_ACCEPTANCE_CATEGORIES.map((category) => {
      if (invalidCategories.has(category)) {
        blockers.push(
          blocker(
            category,
            "INTEGRITY_FAILED",
            `${CATEGORY_LABELS[category]} evidence failed immutable digest verification.`,
          ),
        );
        return {
          category,
          label: CATEGORY_LABELS[category],
          state: "integrity_failed",
          required: true,
          latestEvidence: null,
        };
      }
      const latest = latestRecord(
        validEvidence.filter((record) => record.category === category),
      );
      if (!latest) {
        blockers.push(
          blocker(
            category,
            "MISSING",
            `${CATEGORY_LABELS[category]} has no retained evidence.`,
          ),
        );
        return {
          category,
          label: CATEGORY_LABELS[category],
          state: "missing",
          required: true,
          latestEvidence: null,
        };
      }
      if (
        !expectedReleaseSha256 ||
        latest.releaseSha256 !== expectedReleaseSha256
      ) {
        blockers.push(
          blocker(
            category,
            "RELEASE_MISMATCH",
            `${CATEGORY_LABELS[category]} is not bound to the configured release candidate.`,
          ),
        );
        return {
          category,
          label: CATEGORY_LABELS[category],
          state: "release_mismatch",
          required: true,
          latestEvidence: latest,
        };
      }
      if (Date.parse(latest.expiresAt) <= nowMs) {
        blockers.push(
          blocker(
            category,
            "EXPIRED",
            `${CATEGORY_LABELS[category]} evidence has expired.`,
          ),
        );
        return {
          category,
          label: CATEGORY_LABELS[category],
          state: "expired",
          required: true,
          latestEvidence: latest,
        };
      }
      if (latest.outcome !== "passed") {
        blockers.push(
          blocker(
            category,
            "FAILED",
            `${CATEGORY_LABELS[category]} most recently recorded a failed outcome.`,
          ),
        );
        return {
          category,
          label: CATEGORY_LABELS[category],
          state: "failed",
          required: true,
          latestEvidence: latest,
        };
      }
      return {
        category,
        label: CATEGORY_LABELS[category],
        state: "passed",
        required: true,
        latestEvidence: latest,
      };
    });

  return {
    generatedAt: input.now.toISOString(),
    organisationId: input.organisationId,
    expectedReleaseSha256,
    recommendedDecision: blockers.length === 0 ? "go" : "no_go",
    deploymentAuthorized: false,
    requiresNamedHumanApproval: true,
    categories,
    blockers,
    authorityNote: AUTHORITY_NOTE,
  };
}

export async function appendProductionAcceptanceEvidence(input: {
  repository: ProductionAcceptanceRepository;
  scope: ProductionAcceptanceScope;
  draft: ProductionAcceptanceEvidenceDraft;
  now: Date;
}): Promise<ProductionAcceptanceAppendResult> {
  const record = createProductionAcceptanceEvidence(input);
  const requestDigest = evidenceRequestDigest(record);
  const result = await input.repository.appendEvidence(
    input.scope,
    input.draft.idempotencyKey,
    requestDigest,
    record,
  );
  if (result.outcome === "idempotency_conflict") return result;
  if (
    result.record.organisationId !== input.scope.organisationId ||
    !verifyProductionAcceptanceEvidenceDigest(result.record) ||
    (result.outcome === "appended" &&
      result.record.evidenceDigest !== record.evidenceDigest) ||
    (result.outcome === "replayed" &&
      evidenceRequestDigest(result.record) !== requestDigest)
  ) {
    throw new ProductionAcceptanceRepositoryUnavailableError();
  }
  return result;
}

export { AUTHORITY_NOTE as PRODUCTION_ACCEPTANCE_AUTHORITY_NOTE };
