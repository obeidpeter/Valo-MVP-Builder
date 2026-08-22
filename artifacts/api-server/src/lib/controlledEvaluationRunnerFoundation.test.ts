import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  REQUIRED_CONTINUOUS_EVAL_COHORTS,
  type AiEvalCohort,
} from "./aiContinuousEval";
import {
  REQUIRED_PRODUCTION_COHORTS,
  type EvalCorpusCohort,
} from "./evalHarness";
import type { AiShadowPlan } from "./aiShadowProgramme";
import {
  CONTROLLED_EVALUATION_MANIFEST_SCHEMA,
  bindControlledEvaluationManifest,
  controlledEvaluationCorpusSha256,
  controlledEvaluationManifestSha256,
  parseControlledEvaluationPrivateManifest,
  type ControlledEvaluationPrivateCase,
  type ControlledEvaluationPrivateManifest,
} from "./controlledEvaluationRunnerFoundation";

const hash = (character: string) => character.repeat(64);

function evaluationCase(index: number): ControlledEvaluationPrivateCase {
  return {
    caseId: `authorised-case-${String(index + 1).padStart(2, "0")}`,
    fixtureSha256: hash(((index % 9) + 1).toString()),
    authorizationReferenceSha256: hash("a"),
    labelSha256: hash("b"),
    dataScope: "approved_redacted",
    productionEligible: true,
    split: "holdout",
    expectedDisposition: "completed",
    riskCohorts: [
      REQUIRED_CONTINUOUS_EVAL_COHORTS[
        index % REQUIRED_CONTINUOUS_EVAL_COHORTS.length
      ]!,
    ] as AiEvalCohort[],
    documentCohorts: [
      REQUIRED_PRODUCTION_COHORTS[index % REQUIRED_PRODUCTION_COHORTS.length]!,
    ] as EvalCorpusCohort[],
    annotationStatus: "adjudicated",
    annotatorUserIds: [
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000002",
    ],
    adjudicatorUserId: "00000000-0000-4000-8000-000000000003",
  };
}

function fixture() {
  const organisationId = randomUUID();
  const projectId = randomUUID();
  const planId = randomUUID();
  const manifest: ControlledEvaluationPrivateManifest = {
    schema: CONTROLLED_EVALUATION_MANIFEST_SCHEMA,
    organisationId,
    projectId,
    planId,
    capabilityId: "extract_requirements",
    corpusVersion: "authorised-holdout-v1",
    createdAt: "2026-08-22T12:00:00.000Z",
    cases: Array.from({ length: 25 }, (_, index) => evaluationCase(index)),
  };
  const plan: AiShadowPlan = {
    schema: "valo.ai-shadow-plan/v1",
    id: planId,
    organisationId,
    capabilityId: "extract_requirements",
    title: "Controlled holdout",
    purpose: "Provider-governed private holdout evaluation.",
    versions: {
      applicationReleaseSha256: hash("1"),
      modelSnapshotSha256: hash("2"),
      modelConfigurationSha256: hash("3"),
      promptSha256: hash("4"),
      schemaSha256: hash("5"),
      retrievalPolicySha256: hash("6"),
      corpusManifestSha256: controlledEvaluationCorpusSha256(manifest),
      governanceDecisionSha256: hash("7"),
      expectedCaseManifestSha256: controlledEvaluationManifestSha256(manifest),
    },
    cohorts: [...REQUIRED_CONTINUOUS_EVAL_COHORTS],
    expectedCaseCount: 25,
    expiresAt: "2026-09-01T00:00:00.000Z",
    status: "active",
    version: 1,
    executionMode: "no_output_shadow",
    customerVisible: false,
    productionActivationGranted: false,
    createdByUserId: randomUUID(),
    createdByName: "Evaluation owner",
    createdAt: "2026-08-22T12:00:00.000Z",
    closedByUserId: null,
    closedByName: null,
    closedAt: null,
    closeReason: null,
    evaluationRecommendation: "not_evaluated",
  };
  return { manifest, plan, projectId };
}

test("binds exact authorised case and corpus digests without enabling execution", () => {
  const { manifest, plan, projectId } = fixture();
  const binding = bindControlledEvaluationManifest({
    manifest,
    plan,
    projectId,
    now: new Date("2026-08-22T13:00:00.000Z"),
  });
  assert.equal(binding.sourceBindingValid, true);
  assert.equal(binding.caseCount, 25);
  assert.equal(binding.productionEligibleCaseCount, 25);
  assert.equal(binding.authorisedHoldoutCaseCount, 25);
  assert.equal(binding.readyForExecution, false);
  assert.equal(binding.rawFixturePersisted, false);
  assert.equal(binding.rawOutputPersisted, false);
  assert.equal(binding.productionActivationGranted, false);
  assert.deepEqual(binding.blockers, [
    "authorisation_evidence_unverified",
    "central_gateway_disconnected",
    "evaluation_writer_disconnected",
    "private_fixture_loader_disconnected",
    "production_activation_denied",
  ]);
});

test("case and cohort input order cannot change the canonical bindings", () => {
  const { manifest } = fixture();
  const reordered = {
    ...manifest,
    cases: [...manifest.cases].reverse().map((item) => ({
      ...item,
      annotatorUserIds: [...item.annotatorUserIds].reverse(),
      riskCohorts: [...item.riskCohorts].reverse(),
      documentCohorts: [...item.documentCohorts].reverse(),
    })),
  };
  assert.equal(
    controlledEvaluationManifestSha256(reordered),
    controlledEvaluationManifestSha256(manifest),
  );
  assert.equal(
    controlledEvaluationCorpusSha256(reordered),
    controlledEvaluationCorpusSha256(manifest),
  );
});

test("requires 25 authorised holdout cases and holdout cohort coverage", () => {
  const { manifest, plan, projectId } = fixture();
  const mostlyValidation = {
    ...manifest,
    cases: manifest.cases.map((item, index) => ({
      ...item,
      split: index === 0 ? ("holdout" as const) : ("validation" as const),
    })),
  };
  const reboundPlan = {
    ...plan,
    versions: {
      ...plan.versions,
      expectedCaseManifestSha256:
        controlledEvaluationManifestSha256(mostlyValidation),
      corpusManifestSha256: controlledEvaluationCorpusSha256(mostlyValidation),
    },
  };
  const binding = bindControlledEvaluationManifest({
    manifest: mostlyValidation,
    plan: reboundPlan,
    projectId,
    now: new Date("2026-08-22T13:00:00.000Z"),
  });
  assert.equal(binding.authorisedHoldoutCaseCount, 1);
  assert.equal(binding.sourceBindingValid, false);
  assert.equal(
    binding.blockers.includes("holdout_case_count_below_floor"),
    true,
  );
  assert.equal(binding.blockers.includes("risk_cohort_missing"), true);
  assert.equal(binding.blockers.includes("document_cohort_missing"), true);
});

test("rejects raw fixture fields instead of accepting a content-bearing manifest", () => {
  const { manifest } = fixture();
  const unsafe = {
    ...manifest,
    cases: manifest.cases.map((item, index) =>
      index === 0
        ? { ...item, rawTenderText: "confidential tender content" }
        : item,
    ),
  };
  assert.equal(parseControlledEvaluationPrivateManifest(unsafe), null);
});

test("fails source binding when authorisation, adjudication and exact hashes drift", () => {
  const { manifest, plan, projectId } = fixture();
  const drifted = {
    ...manifest,
    cases: manifest.cases.map((item, index) =>
      index === 0
        ? {
            ...item,
            dataScope: "synthetic" as const,
            annotationStatus: "single_review" as const,
            annotatorUserIds: [item.annotatorUserIds[0]!],
            adjudicatorUserId: null,
          }
        : item,
    ),
  };
  const binding = bindControlledEvaluationManifest({
    manifest: drifted,
    plan,
    projectId,
    now: new Date("2026-08-22T13:00:00.000Z"),
  });
  assert.equal(binding.sourceBindingValid, false);
  assert.equal(binding.authorisedHoldoutCaseCount, 24);
  assert.equal(binding.blockers.includes("authorisation_missing"), true);
  assert.equal(
    binding.blockers.includes("independent_adjudication_missing"),
    true,
  );
  assert.equal(binding.blockers.includes("manifest_digest_mismatch"), true);
  assert.equal(binding.blockers.includes("corpus_digest_mismatch"), true);
});

test("checked activation truth keeps every execution and production effect disconnected", async () => {
  const config = JSON.parse(
    await readFile(
      new URL(
        "../../../../config/operations/controlled-evaluation-runner.v1.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as Record<string, unknown>;
  assert.equal(config.deliveryState, "foundation_only");
  assert.equal(config.manifestBindingImplemented, true);
  assert.equal(config.privateFixtureLoaderConnected, false);
  assert.equal(config.privateAuthorisationEvidenceConnected, false);
  assert.equal(config.centralGatewayConnected, false);
  assert.equal(config.continuousEvaluationWriterConnected, false);
  assert.equal(config.rawFixturePersistenceAllowed, false);
  assert.equal(config.rawOutputPersistenceAllowed, false);
  assert.equal(config.authorisedProductionCorpusAvailable, false);
  assert.equal(config.productionActivationGranted, false);
  assert.equal(config.activation, "blocked");
});
