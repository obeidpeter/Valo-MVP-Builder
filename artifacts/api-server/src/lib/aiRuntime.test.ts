import assert from "node:assert/strict";
import test from "node:test";
import { AI_PROMPT_REGISTRY, canonicalJson, sha256 } from "./aiPromptRegistry";

process.env.DATABASE_URL ??=
  "postgresql://test:test@database.test.invalid:5432/valo_test";

const {
  configuredAiExpectedVersions,
  configuredAiReleaseGateStatus,
  configuredAiReleaseRuntimeMismatchCodes,
  configuredAiRuntime,
} = await import("./aiRuntime");

test("production runtime is disabled without explicit activation and approvals", () => {
  const runtime = configuredAiRuntime({ NODE_ENV: "production" });
  assert.equal(runtime.globalKillSwitchEngaged, true);
  assert.equal(runtime.modelConfiguration.configurationVersion, "");
  assert.equal(runtime.modelConfiguration.status, "draft");
  assert.equal(runtime.modelConfiguration.evaluationApproved, false);
  assert.equal(runtime.budget, null);
  assert.equal(runtime.providerPolicy.requiredRegion, "");
  assert.equal(runtime.providerPolicy.maxRetentionDays, -1);
  assert.deepEqual(configuredAiExpectedVersions(runtime, {}), {
    model: "gpt-5.4",
    modelConfiguration: "",
    prompt: "ai-foundation-v1",
    promptRegistry: configuredAiExpectedVersions(runtime, {}).promptRegistry,
    schema: configuredAiExpectedVersions(runtime, {}).schema,
    retrieval: "",
    index: "",
  });
  assert.match(
    configuredAiExpectedVersions(runtime, {}).schema,
    /^[a-f0-9]{64}$/,
  );
  assert.match(
    configuredAiExpectedVersions(runtime, {}).promptRegistry,
    /^[a-f0-9]{64}$/,
  );
  assert.equal(
    configuredAiExpectedVersions(runtime, {}).promptRegistry,
    sha256(
      canonicalJson(
        Object.fromEntries(
          Object.entries(AI_PROMPT_REGISTRY).map(([capability, definition]) => [
            capability,
            {
              promptVersion: definition.promptVersion,
              promptHash: definition.promptHash,
            },
          ]),
        ),
      ),
    ),
  );
  assert.equal(
    configuredAiExpectedVersions(runtime, {}).schema,
    sha256(
      canonicalJson(
        Object.fromEntries(
          Object.entries(AI_PROMPT_REGISTRY).map(([capability, definition]) => [
            capability,
            {
              schemaVersion: definition.schemaVersion,
              schemaHash: definition.schemaHash,
            },
          ]),
        ),
      ),
    ),
  );
  assert.deepEqual(configuredAiReleaseGateStatus(runtime, {}), {
    applicable: true,
    allowed: false,
    blockerCodes: [
      "release_evidence_missing",
      "retrieval_registry_unavailable",
    ],
  });
});

test("operator-authored retrieval labels cannot unlock absent infrastructure", () => {
  const runtime = configuredAiRuntime({ NODE_ENV: "production" });
  const variables = {
    VALO_AI_RETRIEVAL_VERSION: "invented-retrieval-v99",
    VALO_AI_INDEX_VERSION: "invented-index-v99",
  };
  assert.deepEqual(configuredAiExpectedVersions(runtime, variables), {
    ...configuredAiExpectedVersions(runtime, {}),
    retrieval: "",
    index: "",
  });
  assert.ok(
    configuredAiReleaseGateStatus(runtime, variables).blockerCodes.includes(
      "retrieval_registry_unavailable",
    ),
  );
});

test("runtime accepts only complete, integer, explicitly approved budget evidence", () => {
  const complete = configuredAiRuntime({
    NODE_ENV: "production",
    VALO_AI_GLOBAL_ENABLED: "true",
    VALO_AI_MODEL_ID: "approved-model",
    VALO_AI_MODEL_CONFIGURATION_VERSION: "model-config-v4",
    VALO_AI_MODEL_STATUS: "promoted",
    VALO_AI_MODEL_EVALUATION_APPROVED: "true",
    VALO_AI_BUDGET_APPROVED: "true",
    VALO_AI_BUDGET_CURRENCY: "NGN",
    VALO_AI_APPROVED_BUDGET_REMAINING_MINOR: "200000",
    VALO_AI_INPUT_COST_MINOR_PER_1K_TOKENS: "12",
    VALO_AI_OUTPUT_COST_MINOR_PER_1K_TOKENS: "30",
    VALO_AI_RATE_CARD_VERSION: "rate-card-2026-08",
    VALO_AI_REQUIRED_REGION: "ng",
    VALO_AI_REQUIRE_ZERO_RETENTION: "true",
    VALO_AI_MAX_RETENTION_DAYS: "0",
  });
  assert.equal(complete.globalKillSwitchEngaged, false);
  assert.deepEqual(complete.budget, {
    approved: true,
    currency: "NGN",
    remainingMinor: 200000,
    inputCostMinorPerThousandTokens: 12,
    outputCostMinorPerThousandTokens: 30,
    rateCardVersion: "rate-card-2026-08",
  });
  assert.deepEqual(complete.providerPolicy, {
    requiredRegion: "ng",
    requireZeroRetention: true,
    maxRetentionDays: 0,
  });
  assert.deepEqual(complete.modelConfiguration, {
    model: "approved-model",
    configurationVersion: "model-config-v4",
    status: "promoted",
    evaluationApproved: true,
  });

  const malformed = configuredAiRuntime({
    NODE_ENV: "test",
    VALO_AI_BUDGET_APPROVED: "true",
    VALO_AI_BUDGET_CURRENCY: "NGN",
    VALO_AI_APPROVED_BUDGET_REMAINING_MINOR: "1.5",
    VALO_AI_INPUT_COST_MINOR_PER_1K_TOKENS: "12",
    VALO_AI_OUTPUT_COST_MINOR_PER_1K_TOKENS: "30",
    VALO_AI_RATE_CARD_VERSION: "rate-card",
  });
  assert.equal(malformed.budget, null);
  const zeroRate = configuredAiRuntime({
    NODE_ENV: "test",
    VALO_AI_BUDGET_APPROVED: "true",
    VALO_AI_BUDGET_CURRENCY: "NGN",
    VALO_AI_APPROVED_BUDGET_REMAINING_MINOR: "1000",
    VALO_AI_INPUT_COST_MINOR_PER_1K_TOKENS: "0",
    VALO_AI_OUTPUT_COST_MINOR_PER_1K_TOKENS: "30",
    VALO_AI_RATE_CARD_VERSION: "rate-card",
  });
  assert.equal(zeroRate.budget, null);
  for (const currency of [undefined, "", "USD", "ngn"]) {
    const variables: NodeJS.ProcessEnv = {
      NODE_ENV: "test",
      VALO_AI_BUDGET_APPROVED: "true",
      VALO_AI_APPROVED_BUDGET_REMAINING_MINOR: "1000",
      VALO_AI_INPUT_COST_MINOR_PER_1K_TOKENS: "12",
      VALO_AI_OUTPUT_COST_MINOR_PER_1K_TOKENS: "30",
      VALO_AI_RATE_CARD_VERSION: "rate-card",
    };
    if (currency !== undefined) variables.VALO_AI_BUDGET_CURRENCY = currency;
    assert.equal(configuredAiRuntime(variables).budget, null);
  }
});

test("development is not globally enabled when the emergency switch is set", () => {
  const runtime = configuredAiRuntime({
    NODE_ENV: "development",
    VALO_AI_KILL_SWITCH: "true",
  });
  assert.equal(runtime.globalKillSwitchEngaged, true);
  assert.deepEqual(configuredAiReleaseGateStatus(runtime, {}), {
    applicable: false,
    allowed: false,
    blockerCodes: [],
  });
});

test("unknown or missing NODE_ENV fails closed as production", () => {
  for (const value of [undefined, "prodution", "staging"]) {
    const runtime = configuredAiRuntime(
      value === undefined ? {} : { NODE_ENV: value },
    );
    assert.equal(runtime.environment, "production");
    assert.equal(runtime.globalKillSwitchEngaged, true);
    assert.equal(configuredAiReleaseGateStatus(runtime, {}).applicable, true);
  }
});

test("release decisions must match the configured provider and rate card", () => {
  const variables = {
    NODE_ENV: "production",
    VALO_AI_BUDGET_APPROVED: "true",
    VALO_AI_BUDGET_CURRENCY: "NGN",
    VALO_AI_APPROVED_BUDGET_REMAINING_MINOR: "500000",
    VALO_AI_INPUT_COST_MINOR_PER_1K_TOKENS: "12",
    VALO_AI_OUTPUT_COST_MINOR_PER_1K_TOKENS: "30",
    VALO_AI_RATE_CARD_VERSION: "rate-card-v1",
    VALO_AI_REQUIRED_REGION: "ng",
    VALO_AI_REQUIRE_ZERO_RETENTION: "true",
    VALO_AI_MAX_RETENTION_DAYS: "0",
    AI_INTEGRATIONS_OPENAI_BASE_URL: "https://approved.example.invalid/v1",
    OPENAI_ADAPTER_APPROVED_BASE_URL: "https://approved.example.invalid/v1",
    OPENAI_ADAPTER_NO_TRAINING_VERIFIED: "true",
    OPENAI_ADAPTER_DPA_APPROVED: "true",
    OPENAI_ADAPTER_RETENTION_MODE: "zero",
    OPENAI_ADAPTER_APPROVED_REGIONS: "ng",
    OPENAI_ADAPTER_GOVERNANCE_EVIDENCE_VERSION: "governance-v1",
  } satisfies NodeJS.ProcessEnv;
  const runtime = configuredAiRuntime(variables);
  const evidence = {
    provider: {
      approved: true,
      provider: "openai",
      region: "ng",
      modelAllowlist: [runtime.modelConfiguration.model],
      trainingUseDisabled: true,
      retentionDays: 0,
      approvalReference: "provider-approval-v1",
    },
    budget: {
      approved: true,
      currency: "NGN",
      maxCostPerRunMinor: 500_000,
      maxMonthlyCostMinor: 1_000_000,
      maxInputTokens: 60_000_000,
      maxOutputTokens: 8_192,
      maxLatencyMs: 60_000,
      rateCardVersion: "rate-card-v1",
      inputCostMinorPerThousandTokens: 12,
      outputCostMinorPerThousandTokens: 30,
      approvalReference: "budget-approval-v1",
    },
  };
  assert.deepEqual(
    configuredAiReleaseRuntimeMismatchCodes(runtime, evidence, variables),
    [],
  );
  assert.deepEqual(
    configuredAiReleaseRuntimeMismatchCodes(
      runtime,
      {
        ...evidence,
        provider: { ...evidence.provider, provider: "unapproved-proxy" },
        budget: { ...evidence.budget, rateCardVersion: "stale-rate-card" },
      },
      variables,
    ),
    ["provider_runtime_mismatch", "budget_runtime_mismatch"],
  );
});
