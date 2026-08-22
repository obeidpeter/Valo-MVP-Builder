import { canonicalJsonStrict, sha256Hex } from "./canonicalDigest";
import {
  REQUIRED_CONTINUOUS_EVAL_COHORTS,
  type AiEvalCohort,
} from "./aiContinuousEval";
import {
  EVAL_PRODUCTION_MIN_CORPUS,
  REQUIRED_PRODUCTION_COHORTS,
  type EvalCorpusCohort,
} from "./evalHarness";
import { AI_CAPABILITY_IDS, type AiCapabilityId } from "./aiPolicy";
import type { AiShadowPlan } from "./aiShadowProgramme";
import { SHA256_HEX_PATTERN, UUID_PATTERN } from "./identifierPatterns";
import { isPlainRecord } from "./typeGuards";

/**
 * The second-wave runner boundary is deliberately useful without being an
 * activation switch. It can validate and bind an authorised, private case
 * manifest to an existing shadow plan, but it has no provider adapter, raw
 * fixture loader, result writer, release writer or customer-output path.
 */
export const CONTROLLED_EVALUATION_RUNNER_STATUS = Object.freeze({
  manifestBindingImplemented: true,
  tenantAndProjectBindingRequired: true,
  privateFixtureLoaderConnected: false,
  privateAuthorisationEvidenceConnected: false,
  centralGatewayConnected: false,
  continuousEvaluationWriterConnected: false,
  rawFixturePersistenceAllowed: false,
  rawOutputPersistenceAllowed: false,
  customerVisible: false,
  authorisedProductionCorpusAvailable: false,
  productionActivationGranted: false,
  activation: "blocked" as const,
});

export const CONTROLLED_EVALUATION_MANIFEST_SCHEMA =
  "valo.controlled-evaluation-private-manifest/v1" as const;

const CASE_KEYS = [
  "adjudicatorUserId",
  "annotationStatus",
  "annotatorUserIds",
  "authorizationReferenceSha256",
  "caseId",
  "dataScope",
  "documentCohorts",
  "expectedDisposition",
  "fixtureSha256",
  "labelSha256",
  "productionEligible",
  "riskCohorts",
  "split",
] as const;
const MANIFEST_KEYS = [
  "capabilityId",
  "cases",
  "corpusVersion",
  "createdAt",
  "organisationId",
  "planId",
  "projectId",
  "schema",
] as const;
const CONTROL = /[\u0000-\u001f\u007f\ud800-\udfff]/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const CAPABILITIES = new Set<string>(AI_CAPABILITY_IDS);
const RISK_COHORTS = new Set<string>(REQUIRED_CONTINUOUS_EVAL_COHORTS);
const DOCUMENT_COHORTS = new Set<string>(REQUIRED_PRODUCTION_COHORTS);

export interface ControlledEvaluationPrivateCase {
  caseId: string;
  fixtureSha256: string;
  authorizationReferenceSha256: string;
  labelSha256: string;
  dataScope: "synthetic" | "approved_redacted";
  productionEligible: boolean;
  split: "development" | "validation" | "holdout" | "red_team";
  expectedDisposition: "completed" | "abstained" | "safe_failure";
  riskCohorts: AiEvalCohort[];
  documentCohorts: EvalCorpusCohort[];
  annotationStatus: "unverified" | "single_review" | "adjudicated";
  annotatorUserIds: string[];
  adjudicatorUserId: string | null;
}

export interface ControlledEvaluationPrivateManifest {
  schema: typeof CONTROLLED_EVALUATION_MANIFEST_SCHEMA;
  organisationId: string;
  projectId: string;
  planId: string;
  capabilityId: AiCapabilityId;
  corpusVersion: string;
  createdAt: string;
  cases: ControlledEvaluationPrivateCase[];
}

export type ControlledEvaluationManifestBlocker =
  | "manifest_invalid"
  | "plan_inactive"
  | "plan_expired"
  | "plan_scope_mismatch"
  | "manifest_digest_mismatch"
  | "corpus_digest_mismatch"
  | "case_count_mismatch"
  | "production_case_count_below_floor"
  | "case_duplicate"
  | "risk_cohort_missing"
  | "document_cohort_missing"
  | "authorisation_missing"
  | "independent_adjudication_missing"
  | "holdout_case_count_below_floor"
  | "authorisation_evidence_unverified"
  | "private_fixture_loader_disconnected"
  | "central_gateway_disconnected"
  | "evaluation_writer_disconnected"
  | "production_activation_denied";

export interface ControlledEvaluationManifestBinding {
  schema: "valo.controlled-evaluation-manifest-binding/v1";
  organisationId: string;
  projectId: string;
  planId: string;
  capabilityId: AiCapabilityId;
  manifestSha256: string | null;
  corpusSha256: string | null;
  caseCount: number;
  productionEligibleCaseCount: number;
  authorisedHoldoutCaseCount: number;
  sourceBindingValid: boolean;
  readyForExecution: false;
  blockers: ControlledEvaluationManifestBlocker[];
  rawFixturePersisted: false;
  rawOutputPersisted: false;
  productionActivationGranted: false;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function identifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    IDENTIFIER.test(value) &&
    !CONTROL.test(value) &&
    !/^(?:none|unknown|unset|draft|not[_-]implemented)$/iu.test(value)
  );
}

function instant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString() === value;
}

function exactStringSet<T extends string>(
  value: unknown,
  allowed: ReadonlySet<string>,
  maximum: number,
): value is T[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= maximum &&
    new Set(value).size === value.length &&
    value.every((item) => typeof item === "string" && allowed.has(item))
  );
}

function parseCase(value: unknown): ControlledEvaluationPrivateCase | null {
  if (!isPlainRecord(value) || !exactKeys(value, CASE_KEYS)) return null;
  if (
    !identifier(value.caseId) ||
    typeof value.fixtureSha256 !== "string" ||
    !SHA256_HEX_PATTERN.test(value.fixtureSha256) ||
    typeof value.authorizationReferenceSha256 !== "string" ||
    !SHA256_HEX_PATTERN.test(value.authorizationReferenceSha256) ||
    typeof value.labelSha256 !== "string" ||
    !SHA256_HEX_PATTERN.test(value.labelSha256) ||
    !new Set(["synthetic", "approved_redacted"]).has(String(value.dataScope)) ||
    typeof value.productionEligible !== "boolean" ||
    !new Set(["development", "validation", "holdout", "red_team"]).has(
      String(value.split),
    ) ||
    !new Set(["completed", "abstained", "safe_failure"]).has(
      String(value.expectedDisposition),
    ) ||
    !exactStringSet<AiEvalCohort>(
      value.riskCohorts,
      RISK_COHORTS,
      REQUIRED_CONTINUOUS_EVAL_COHORTS.length,
    ) ||
    !exactStringSet<EvalCorpusCohort>(
      value.documentCohorts,
      DOCUMENT_COHORTS,
      REQUIRED_PRODUCTION_COHORTS.length,
    ) ||
    !new Set(["unverified", "single_review", "adjudicated"]).has(
      String(value.annotationStatus),
    ) ||
    !Array.isArray(value.annotatorUserIds) ||
    value.annotatorUserIds.length > 10 ||
    new Set(value.annotatorUserIds).size !== value.annotatorUserIds.length ||
    !value.annotatorUserIds.every(
      (userId) => typeof userId === "string" && UUID_PATTERN.test(userId),
    ) ||
    !(
      value.adjudicatorUserId === null ||
      (typeof value.adjudicatorUserId === "string" &&
        UUID_PATTERN.test(value.adjudicatorUserId))
    )
  ) {
    return null;
  }
  return {
    caseId: value.caseId,
    fixtureSha256: value.fixtureSha256,
    authorizationReferenceSha256: value.authorizationReferenceSha256,
    labelSha256: value.labelSha256,
    dataScope: value.dataScope as ControlledEvaluationPrivateCase["dataScope"],
    productionEligible: value.productionEligible,
    split: value.split as ControlledEvaluationPrivateCase["split"],
    expectedDisposition:
      value.expectedDisposition as ControlledEvaluationPrivateCase["expectedDisposition"],
    riskCohorts: value.riskCohorts,
    documentCohorts: value.documentCohorts,
    annotationStatus:
      value.annotationStatus as ControlledEvaluationPrivateCase["annotationStatus"],
    annotatorUserIds: value.annotatorUserIds as string[],
    adjudicatorUserId: value.adjudicatorUserId as string | null,
  };
}

export function parseControlledEvaluationPrivateManifest(
  value: unknown,
): ControlledEvaluationPrivateManifest | null {
  if (!isPlainRecord(value) || !exactKeys(value, MANIFEST_KEYS)) return null;
  if (
    value.schema !== CONTROLLED_EVALUATION_MANIFEST_SCHEMA ||
    typeof value.organisationId !== "string" ||
    !UUID_PATTERN.test(value.organisationId) ||
    typeof value.projectId !== "string" ||
    !UUID_PATTERN.test(value.projectId) ||
    typeof value.planId !== "string" ||
    !UUID_PATTERN.test(value.planId) ||
    typeof value.capabilityId !== "string" ||
    !CAPABILITIES.has(value.capabilityId) ||
    !identifier(value.corpusVersion) ||
    !instant(value.createdAt) ||
    !Array.isArray(value.cases) ||
    value.cases.length === 0 ||
    value.cases.length > 100_000
  ) {
    return null;
  }
  const cases = value.cases.map(parseCase);
  if (cases.some((item) => item === null)) return null;
  return {
    schema: CONTROLLED_EVALUATION_MANIFEST_SCHEMA,
    organisationId: value.organisationId,
    projectId: value.projectId,
    planId: value.planId,
    capabilityId: value.capabilityId as AiCapabilityId,
    corpusVersion: value.corpusVersion,
    createdAt: value.createdAt,
    cases: cases as ControlledEvaluationPrivateCase[],
  };
}

function canonicalManifest(manifest: ControlledEvaluationPrivateManifest) {
  return {
    ...manifest,
    cases: [...manifest.cases]
      .sort((left, right) =>
        left.caseId < right.caseId ? -1 : left.caseId > right.caseId ? 1 : 0,
      )
      .map((item) => ({
        ...item,
        annotatorUserIds: [...item.annotatorUserIds].sort(),
        riskCohorts: [...item.riskCohorts].sort(),
        documentCohorts: [...item.documentCohorts].sort(),
      })),
  };
}

function canonicalJson(value: unknown): string {
  return canonicalJsonStrict(value, () => {
    throw new TypeError("Controlled evaluation manifest is not canonical JSON");
  });
}

export function controlledEvaluationManifestSha256(
  manifest: ControlledEvaluationPrivateManifest,
): string {
  // The shadow plan's expected-case digest is supplied before the server
  // allocates a plan ID. Bind the immutable case material here and enforce
  // organisation/project/plan scope separately at launch to avoid a circular
  // digest that no caller could construct before plan creation.
  return sha256Hex(
    canonicalJson({
      schema: "valo.controlled-evaluation-expected-case-manifest/v1",
      capabilityId: manifest.capabilityId,
      corpusVersion: manifest.corpusVersion,
      cases: canonicalManifest(manifest).cases,
    }),
  );
}

export function controlledEvaluationCorpusSha256(
  manifest: ControlledEvaluationPrivateManifest,
): string {
  return sha256Hex(
    canonicalJson({
      schema: "valo.controlled-evaluation-corpus-binding/v1",
      capabilityId: manifest.capabilityId,
      corpusVersion: manifest.corpusVersion,
      cases: canonicalManifest(manifest).cases,
    }),
  );
}

export function bindControlledEvaluationManifest(input: {
  plan: AiShadowPlan;
  projectId: string;
  manifest: unknown;
  now?: Date;
}): ControlledEvaluationManifestBinding {
  const manifest = parseControlledEvaluationPrivateManifest(input.manifest);
  const blockers: ControlledEvaluationManifestBlocker[] = [];
  if (!manifest || !UUID_PATTERN.test(input.projectId)) {
    blockers.push("manifest_invalid");
  }
  const manifestSha256 = manifest
    ? controlledEvaluationManifestSha256(manifest)
    : null;
  const corpusSha256 = manifest
    ? controlledEvaluationCorpusSha256(manifest)
    : null;
  const cases = manifest?.cases ?? [];
  const productionCases = cases.filter((item) => item.productionEligible);
  const independentlyAdjudicated = (
    item: ControlledEvaluationPrivateCase,
  ): boolean =>
    item.annotationStatus === "adjudicated" &&
    item.annotatorUserIds.length >= 2 &&
    item.adjudicatorUserId !== null &&
    !item.annotatorUserIds.includes(item.adjudicatorUserId);
  const authorisedHoldoutCases = productionCases.filter(
    (item) =>
      item.split === "holdout" &&
      item.dataScope === "approved_redacted" &&
      SHA256_HEX_PATTERN.test(item.authorizationReferenceSha256) &&
      independentlyAdjudicated(item),
  );
  if (input.plan.status !== "active") blockers.push("plan_inactive");
  if (Date.parse(input.plan.expiresAt) <= (input.now ?? new Date()).valueOf()) {
    blockers.push("plan_expired");
  }
  if (
    !manifest ||
    manifest.organisationId !== input.plan.organisationId ||
    manifest.projectId !== input.projectId ||
    manifest.planId !== input.plan.id ||
    manifest.capabilityId !== input.plan.capabilityId
  ) {
    blockers.push("plan_scope_mismatch");
  }
  if (manifestSha256 !== input.plan.versions.expectedCaseManifestSha256) {
    blockers.push("manifest_digest_mismatch");
  }
  if (corpusSha256 !== input.plan.versions.corpusManifestSha256) {
    blockers.push("corpus_digest_mismatch");
  }
  if (cases.length !== input.plan.expectedCaseCount) {
    blockers.push("case_count_mismatch");
  }
  if (productionCases.length < EVAL_PRODUCTION_MIN_CORPUS) {
    blockers.push("production_case_count_below_floor");
  }
  if (new Set(cases.map((item) => item.caseId)).size !== cases.length) {
    blockers.push("case_duplicate");
  }
  const coveredRiskCohorts = new Set(
    authorisedHoldoutCases.flatMap((item) => item.riskCohorts),
  );
  if (
    REQUIRED_CONTINUOUS_EVAL_COHORTS.some(
      (cohort) => !coveredRiskCohorts.has(cohort),
    )
  ) {
    blockers.push("risk_cohort_missing");
  }
  const coveredDocumentCohorts = new Set(
    authorisedHoldoutCases.flatMap((item) => item.documentCohorts),
  );
  if (
    REQUIRED_PRODUCTION_COHORTS.some(
      (cohort) => !coveredDocumentCohorts.has(cohort),
    )
  ) {
    blockers.push("document_cohort_missing");
  }
  if (
    productionCases.some(
      (item) =>
        item.dataScope !== "approved_redacted" ||
        !SHA256_HEX_PATTERN.test(item.authorizationReferenceSha256),
    )
  ) {
    blockers.push("authorisation_missing");
  }
  if (productionCases.some((item) => !independentlyAdjudicated(item))) {
    blockers.push("independent_adjudication_missing");
  }
  if (authorisedHoldoutCases.length < EVAL_PRODUCTION_MIN_CORPUS) {
    blockers.push("holdout_case_count_below_floor");
  }

  const sourceBindingBlockers = new Set<ControlledEvaluationManifestBlocker>([
    "manifest_invalid",
    "plan_inactive",
    "plan_expired",
    "plan_scope_mismatch",
    "manifest_digest_mismatch",
    "corpus_digest_mismatch",
    "case_count_mismatch",
    "production_case_count_below_floor",
    "case_duplicate",
    "risk_cohort_missing",
    "document_cohort_missing",
    "authorisation_missing",
    "independent_adjudication_missing",
    "holdout_case_count_below_floor",
  ]);
  const sourceBindingValid = !blockers.some((code) =>
    sourceBindingBlockers.has(code),
  );
  blockers.push(
    "authorisation_evidence_unverified",
    "private_fixture_loader_disconnected",
    "central_gateway_disconnected",
    "evaluation_writer_disconnected",
    "production_activation_denied",
  );
  return {
    schema: "valo.controlled-evaluation-manifest-binding/v1",
    organisationId: input.plan.organisationId,
    projectId: input.projectId,
    planId: input.plan.id,
    capabilityId: input.plan.capabilityId,
    manifestSha256,
    corpusSha256,
    caseCount: cases.length,
    productionEligibleCaseCount: productionCases.length,
    authorisedHoldoutCaseCount: authorisedHoldoutCases.length,
    sourceBindingValid,
    readyForExecution: false,
    blockers: [...new Set(blockers)].sort(),
    rawFixturePersisted: false,
    rawOutputPersisted: false,
    productionActivationGranted: false,
  };
}
