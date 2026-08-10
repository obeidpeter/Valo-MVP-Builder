import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateProductionAdapters,
  executeJsonWithFallback,
  hasVerifiedModelDataGovernance,
  ProviderChainError,
  type AdapterDescriptor,
  type JsonModelAdapter,
} from "./providerContracts";

const adapter = (
  provider: string,
  responses: Array<"ok" | Error>,
): JsonModelAdapter => ({
  descriptor: {
    kind: "model",
    provider,
    mode: "production",
    productionApproved: true,
    capabilities: ["json"],
  },
  async health() {
    return { healthy: true, checkedAt: "2026-08-08T00:00:00Z", message: "ok" };
  },
  async completeJson() {
    const response = responses.shift();
    if (response instanceof Error) throw response;
    return { content: "{}", promptTokens: 1, completionTokens: 1 };
  },
});

test("production readiness rejects absent, development-only, and unapproved adapters", () => {
  const issues = evaluateProductionAdapters(
    ["model", "ocr", "malware_scan"],
    [
      {
        kind: "model",
        provider: "dev",
        mode: "development",
        productionApproved: false,
        capabilities: [],
      },
      {
        kind: "ocr",
        provider: "candidate",
        mode: "production",
        productionApproved: false,
        capabilities: [],
      },
    ],
  );
  assert.deepEqual(
    issues.map((issue) => issue.code),
    ["development_only", "not_approved", "missing"],
  );
});

test("provider fallback retries transient failures then advances", async () => {
  const first = adapter("first", [new Error("timeout"), new Error("timeout")]);
  const second = adapter("second", ["ok"]);
  const result = await executeJsonWithFallback({
    request: {
      model: "model",
      messages: [],
      maxOutputTokens: 10,
      timeoutMs: 1000,
      idempotencyKey: "key",
    },
    adapters: [first, second],
    attemptsPerAdapter: 2,
    retryable: () => true,
  });
  assert.equal(result.provider, "second");
  assert.equal(result.attempt, 1);
});

test("non-retryable errors skip directly to the next provider", async () => {
  const result = await executeJsonWithFallback({
    request: {
      model: "model",
      messages: [],
      maxOutputTokens: 10,
      timeoutMs: 1000,
      idempotencyKey: "key",
    },
    adapters: [
      adapter("first", [new Error("schema")]),
      adapter("second", ["ok"]),
    ],
    attemptsPerAdapter: 5,
    retryable: () => false,
  });
  assert.equal(result.provider, "second");
});

test("complete outage reports bounded provider failures", async () => {
  await assert.rejects(
    executeJsonWithFallback({
      request: {
        model: "model",
        messages: [],
        maxOutputTokens: 10,
        timeoutMs: 1000,
        idempotencyKey: "key",
      },
      adapters: [adapter("only", [new Error("down")])],
      attemptsPerAdapter: 1,
      retryable: () => true,
    }),
    (error: unknown) =>
      error instanceof ProviderChainError && error.failures.length === 1,
  );
});

const governedModel = (): AdapterDescriptor => ({
  kind: "model",
  provider: "reviewed-model-provider",
  mode: "production",
  productionApproved: true,
  capabilities: ["structured_json"],
  dataGovernance: {
    externallyHosted: true,
    noTrainingVerified: true,
    retentionMode: "zero",
    maxRetentionDays: null,
    regions: ["ng"],
    dpaApproved: true,
    restrictedModeEligible: false,
    evidenceVersion: "legal-review-v1",
  },
});

test("production model readiness separately requires verified governance", () => {
  const withoutGovernance = governedModel();
  delete withoutGovernance.dataGovernance;
  assert.deepEqual(evaluateProductionAdapters(["model"], [withoutGovernance]), [
    {
      kind: "model",
      code: "privacy_unverified",
      message:
        "model has no production-approved privacy, retention, region and DPA evidence.",
    },
  ]);
  assert.deepEqual(
    evaluateProductionAdapters(["model"], [governedModel()]),
    [],
  );
});

test("verified governance rejects implicit retention, missing evidence and invalid bounds", () => {
  assert.equal(hasVerifiedModelDataGovernance(governedModel()), true);
  for (const dataGovernance of [
    { ...governedModel().dataGovernance!, noTrainingVerified: false },
    { ...governedModel().dataGovernance!, dpaApproved: false },
    { ...governedModel().dataGovernance!, evidenceVersion: null },
    { ...governedModel().dataGovernance!, regions: [] },
    {
      ...governedModel().dataGovernance!,
      retentionMode: "provider_default" as const,
    },
    {
      ...governedModel().dataGovernance!,
      retentionMode: "bounded" as const,
      maxRetentionDays: -1,
    },
  ]) {
    assert.equal(
      hasVerifiedModelDataGovernance({ ...governedModel(), dataGovernance }),
      false,
    );
  }
});
