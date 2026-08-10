import assert from "node:assert/strict";
import test from "node:test";
import {
  AiGatewayError,
  evaluateAiProviderEligibility,
  executeAiGatewayRequest,
  providerRequestIdempotencyKey,
  providerGovernanceAtLeastAsProtective,
  type AiGatewayRequest,
} from "./aiGateway";
import { AI_CAPABILITY_POLICY } from "./aiPolicy";
import { AI_PROMPT_REGISTRY } from "./aiPromptRegistry";
import type {
  AdapterHealth,
  JsonModelAdapter,
  JsonModelRequest,
  JsonModelResponse,
  ProviderDataGovernance,
} from "./providerContracts";

const checkedAt = "2026-08-09T12:00:00.000Z";

function governance(
  overrides: Partial<ProviderDataGovernance> = {},
): ProviderDataGovernance {
  return {
    externallyHosted: true,
    noTrainingVerified: true,
    retentionMode: "zero",
    maxRetentionDays: null,
    regions: ["ng"],
    dpaApproved: true,
    restrictedModeEligible: false,
    evidenceVersion: "dpa-2026-08-v1",
    ...overrides,
  };
}

interface FakeAdapterOptions {
  provider?: string;
  mode?: "development" | "production";
  productionApproved?: boolean;
  capabilities?: string[];
  dataGovernance?: ProviderDataGovernance;
  health?: AdapterHealth | Error;
  responses?: Array<JsonModelResponse | Error>;
}

function fakeAdapter(options: FakeAdapterOptions = {}): {
  adapter: JsonModelAdapter;
  requests: JsonModelRequest[];
} {
  const requests: JsonModelRequest[] = [];
  const responses = options.responses ?? [
    {
      content: JSON.stringify({ review: "Pending named-human confirmation." }),
      promptTokens: 1200,
      completionTokens: 400,
      providerRequestId: "provider-request-1",
    },
  ];
  return {
    requests,
    adapter: {
      descriptor: {
        kind: "model",
        provider: options.provider ?? "verified-provider",
        mode: options.mode ?? "production",
        productionApproved: options.productionApproved ?? true,
        capabilities: options.capabilities ?? [
          "structured_json",
          "multimodal_pdf",
          "usage_telemetry",
        ],
        dataGovernance: options.dataGovernance ?? governance(),
      },
      async health() {
        if (options.health instanceof Error) throw options.health;
        return (
          options.health ?? {
            healthy: true,
            checkedAt,
            message: "ok",
          }
        );
      },
      async completeJson(request) {
        requests.push(request);
        const next = responses.shift();
        if (next instanceof Error) throw next;
        if (!next) throw new Error("fake response queue exhausted");
        return next;
      },
    },
  };
}

function baseRequest(
  adapter: JsonModelAdapter,
  overrides: Partial<AiGatewayRequest> = {},
): AiGatewayRequest {
  return {
    capability: "responsiveness_review",
    environment: "test",
    globalKillSwitchEngaged: false,
    restrictedMode: false,
    modelConfiguration: {
      model: "model-2026-08",
      configurationVersion: "model-config-v3",
      status: "promoted",
      evaluationApproved: true,
    },
    budget: {
      approved: true,
      currency: "NGN",
      remainingMinor: 1_000_000,
      inputCostMinorPerThousandTokens: 20,
      outputCostMinorPerThousandTokens: 50,
      rateCardVersion: "rate-card-v2",
    },
    providerPolicy: {
      requiredRegion: "ng",
      requireZeroRetention: true,
      maxRetentionDays: 0,
    },
    adapters: [adapter],
    userContent: { confirmedFacts: ["One fact"] },
    idempotencyKey: "tenant-1:responsiveness:1",
    ...overrides,
  };
}

async function assertGatewayCode(
  promise: Promise<unknown>,
  code: AiGatewayError["code"],
): Promise<AiGatewayError> {
  let captured: AiGatewayError | undefined;
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof AiGatewayError);
    assert.equal(error.code, code);
    assert.match(error.message, /^AI |^This |^The |^An |^No |^External /);
    captured = error;
    return true;
  });
  return captured!;
}

test("gateway sends the exact strict schema and returns complete deterministic provenance", async () => {
  const fake = fakeAdapter();
  const times = [1000, 1042];
  const result = await executeAiGatewayRequest(baseRequest(fake.adapter), {
    now: () => times.shift() ?? 1042,
  });

  assert.deepEqual(result.output, {
    review: "Pending named-human confirmation.",
  });
  assert.equal(fake.requests.length, 1);
  const providerRequest = fake.requests[0];
  assert.equal(providerRequest.model, "model-2026-08");
  assert.equal(providerRequest.maxOutputTokens, 2048);
  assert.equal(providerRequest.timeoutMs, 45_000);
  assert.equal(providerRequest.outputSchema?.strict, true);
  assert.equal(
    providerRequest.outputSchema?.name,
    "responsiveness_review_responsiveness-preview-v1",
  );
  assert.deepEqual(
    providerRequest.outputSchema?.schema,
    AI_PROMPT_REGISTRY.responsiveness_review.outputSchema,
  );
  assert.match(providerRequest.idempotencyKey, /^[a-f0-9]{64}$/);
  assert.notEqual(providerRequest.idempotencyKey, "tenant-1:responsiveness:1");
  assert.deepEqual(result.telemetry, {
    capability: "responsiveness_review",
    provider: "verified-provider",
    providerRequestId: "provider-request-1",
    providerAttempt: 1,
    fallbackUsed: false,
    latencyMs: 42,
    promptTokens: 1200,
    completionTokens: 400,
    costMinor: 44,
    costCurrency: "NGN",
    costRateCardVersion: "rate-card-v2",
    model: "model-2026-08",
    modelConfigurationVersion: "model-config-v3",
    promptVersion: AI_PROMPT_REGISTRY.responsiveness_review.promptVersion,
    promptHash: AI_PROMPT_REGISTRY.responsiveness_review.promptHash,
    schemaVersion: AI_PROMPT_REGISTRY.responsiveness_review.schemaVersion,
    schemaHash: AI_PROMPT_REGISTRY.responsiveness_review.schemaHash,
    providerGovernanceEvidenceVersion: "dpa-2026-08-v1",
    providerHealthCheckedAt: checkedAt,
  });
});

test("provider idempotency binds model configuration, prompt and schema artifacts", () => {
  const base = {
    callerKey: "source-key",
    capability: "responsiveness_review" as const,
    model: "model-v1",
    modelConfigurationVersion: "model-config-v1",
    promptVersion: "prompt-v1",
    promptHash: "prompt-hash-v1",
    schemaVersion: "schema-v1",
    schemaHash: "schema-hash-v1",
  };
  const original = providerRequestIdempotencyKey(base);
  for (const changed of [
    { ...base, model: "model-v2" },
    { ...base, modelConfigurationVersion: "model-config-v2" },
    { ...base, promptHash: "prompt-hash-v2" },
    { ...base, schemaHash: "schema-hash-v2" },
  ]) {
    assert.notEqual(providerRequestIdempotencyKey(changed), original);
  }
});

test("zero rate cards and retry/fallback under-reservation fail closed", async () => {
  const fake = fakeAdapter();
  await assertGatewayCode(
    executeAiGatewayRequest(
      baseRequest(fake.adapter, {
        budget: {
          approved: true,
          currency: "NGN",
          remainingMinor: 1_000_000,
          inputCostMinorPerThousandTokens: 0,
          outputCostMinorPerThousandTokens: 50,
          rateCardVersion: "rate-card-v2",
        },
      }),
    ),
    "AI_BUDGET_UNAVAILABLE",
  );

  await assertGatewayCode(
    executeAiGatewayRequest(
      baseRequest(fake.adapter, {
        budget: {
          approved: true,
          currency: "NGN",
          remainingMinor: 300,
          inputCostMinorPerThousandTokens: 20,
          outputCostMinorPerThousandTokens: 50,
          rateCardVersion: "rate-card-v2",
        },
      }),
    ),
    "AI_BUDGET_EXCEEDED",
  );
  assert.equal(fake.requests.length, 0);
});

test("production fails closed for kill switch, capability gate, and unpromoted model config", async () => {
  const fake = fakeAdapter();
  const production = baseRequest(fake.adapter, {
    environment: "production",
    resolveCapabilityEnabled: () => true,
  });
  await assertGatewayCode(
    executeAiGatewayRequest({
      ...production,
      globalKillSwitchEngaged: true,
    }),
    "AI_GLOBAL_DISABLED",
  );
  await assertGatewayCode(
    executeAiGatewayRequest({
      ...production,
      resolveCapabilityEnabled: undefined,
    }),
    "AI_CAPABILITY_GATE_UNAVAILABLE",
  );
  await assertGatewayCode(
    executeAiGatewayRequest({
      ...production,
      resolveCapabilityEnabled: () => false,
    }),
    "AI_CAPABILITY_DISABLED",
  );
  await assertGatewayCode(
    executeAiGatewayRequest({
      ...production,
      modelConfiguration: {
        ...production.modelConfiguration,
        status: "draft",
      },
    }),
    "AI_MODEL_CONFIGURATION_UNAVAILABLE",
  );
  await assertGatewayCode(
    executeAiGatewayRequest({
      ...baseRequest(fake.adapter),
      modelConfiguration: {
        ...production.modelConfiguration,
        status: "retired",
      },
    }),
    "AI_MODEL_CONFIGURATION_UNAVAILABLE",
  );
  assert.equal(fake.requests.length, 0);
});

test("budget authority, currency, conservative reservation, and rate card fail closed", async () => {
  const fake = fakeAdapter();
  const request = baseRequest(fake.adapter);
  await assertGatewayCode(
    executeAiGatewayRequest({ ...request, budget: null }),
    "AI_BUDGET_UNAVAILABLE",
  );
  await assertGatewayCode(
    executeAiGatewayRequest({
      ...request,
      budget: { ...request.budget!, approved: false },
    }),
    "AI_BUDGET_UNAVAILABLE",
  );
  await assertGatewayCode(
    executeAiGatewayRequest({
      ...request,
      budget: { ...request.budget!, rateCardVersion: "" },
    }),
    "AI_BUDGET_UNAVAILABLE",
  );
  await assertGatewayCode(
    executeAiGatewayRequest({
      ...request,
      budget: { ...request.budget!, currency: "USD" },
    }),
    "AI_BUDGET_CURRENCY_MISMATCH",
  );
  await assertGatewayCode(
    executeAiGatewayRequest({
      ...request,
      budget: { ...request.budget!, remainingMinor: 0 },
    }),
    "AI_BUDGET_EXCEEDED",
  );
  assert.equal(fake.requests.length, 0);
});

test("provider eligibility is derived from approval, privacy, region, retention and Restricted Mode", () => {
  const descriptor = fakeAdapter().adapter.descriptor;
  assert.deepEqual(
    evaluateAiProviderEligibility({
      descriptor,
      environment: "production",
      restrictedMode: false,
      policy: {
        requiredRegion: "NG",
        requireZeroRetention: true,
        maxRetentionDays: 0,
      },
    }),
    { eligible: true },
  );
  assert.equal(
    evaluateAiProviderEligibility({
      descriptor: { ...descriptor, productionApproved: false },
      environment: "production",
      restrictedMode: false,
      policy: {
        requiredRegion: "ng",
        requireZeroRetention: true,
        maxRetentionDays: 0,
      },
    }).code,
    "AI_PROVIDER_NOT_APPROVED",
  );
  assert.equal(
    evaluateAiProviderEligibility({
      descriptor: { ...descriptor, dataGovernance: undefined },
      environment: "production",
      restrictedMode: false,
      policy: {
        requiredRegion: "ng",
        requireZeroRetention: true,
        maxRetentionDays: 0,
      },
    }).code,
    "AI_PROVIDER_PRIVACY_UNVERIFIED",
  );
  assert.equal(
    evaluateAiProviderEligibility({
      descriptor,
      environment: "production",
      restrictedMode: false,
      policy: {
        requiredRegion: "eu",
        requireZeroRetention: true,
        maxRetentionDays: 0,
      },
    }).code,
    "AI_PROVIDER_REGION_UNAVAILABLE",
  );
  assert.equal(
    evaluateAiProviderEligibility({
      descriptor: {
        ...descriptor,
        dataGovernance: governance({
          retentionMode: "bounded",
          maxRetentionDays: 7,
        }),
      },
      environment: "production",
      restrictedMode: false,
      policy: {
        requiredRegion: "ng",
        requireZeroRetention: true,
        maxRetentionDays: 0,
      },
    }).code,
    "AI_PROVIDER_RETENTION_INCOMPATIBLE",
  );
  assert.equal(
    evaluateAiProviderEligibility({
      descriptor,
      environment: "production",
      restrictedMode: true,
      policy: {
        requiredRegion: "ng",
        requireZeroRetention: true,
        maxRetentionDays: 0,
      },
    }).code,
    "AI_RESTRICTED_MODE_DENIED",
  );
});

test("invalid retention metadata and missing governance evidence cannot become eligible", () => {
  const descriptor = fakeAdapter().adapter.descriptor;
  for (const dataGovernance of [
    governance({ noTrainingVerified: false }),
    governance({ dpaApproved: false }),
    governance({ evidenceVersion: null }),
    governance({ regions: [] }),
    governance({ retentionMode: "unknown" }),
    governance({ retentionMode: "bounded", maxRetentionDays: -1 }),
  ]) {
    const decision = evaluateAiProviderEligibility({
      descriptor: { ...descriptor, dataGovernance },
      environment: "production",
      restrictedMode: false,
      policy: {
        requiredRegion: "ng",
        requireZeroRetention: false,
        maxRetentionDays: 30,
      },
    });
    assert.equal(decision.eligible, false);
    assert.ok(
      decision.code === "AI_PROVIDER_PRIVACY_UNVERIFIED" ||
        decision.code === "AI_PROVIDER_REGION_UNAVAILABLE" ||
        decision.code === "AI_PROVIDER_RETENTION_INCOMPATIBLE",
    );
  }
});

test("gateway requires structured-json capability and healthy timestamped providers", async () => {
  const missingCapability = fakeAdapter({ capabilities: ["usage_telemetry"] });
  await assertGatewayCode(
    executeAiGatewayRequest(baseRequest(missingCapability.adapter)),
    "AI_PROVIDER_UNAVAILABLE",
  );
  const unhealthy = fakeAdapter({
    health: { healthy: false, checkedAt, message: "down" },
  });
  await assertGatewayCode(
    executeAiGatewayRequest(baseRequest(unhealthy.adapter)),
    "AI_PROVIDER_UNHEALTHY",
  );
  const noHealthProof = fakeAdapter({
    health: { healthy: true, checkedAt: "", message: "ok" },
  });
  await assertGatewayCode(
    executeAiGatewayRequest(baseRequest(noHealthProof.adapter)),
    "AI_PROVIDER_UNHEALTHY",
  );
  const healthThrows = fakeAdapter({ health: new Error("secret endpoint") });
  const error = await assertGatewayCode(
    executeAiGatewayRequest(baseRequest(healthThrows.adapter)),
    "AI_PROVIDER_UNHEALTHY",
  );
  assert.doesNotMatch(error.message, /secret|endpoint/i);
});

test("fallback retries are bounded and only equivalent-or-stronger providers run", async () => {
  const first = fakeAdapter({
    provider: "primary",
    responses: [new Error("network timeout"), new Error("network timeout")],
  });
  const second = fakeAdapter({ provider: "equivalent-fallback" });
  const result = await executeAiGatewayRequest(
    baseRequest(first.adapter, { adapters: [first.adapter, second.adapter] }),
  );
  assert.equal(first.requests.length, 2);
  assert.equal(second.requests.length, 1);
  assert.equal(result.telemetry.provider, "equivalent-fallback");
  assert.equal(result.telemetry.providerAttempt, 1);
  assert.equal(result.telemetry.fallbackUsed, true);

  const localPrimary = fakeAdapter({
    provider: "local-primary",
    dataGovernance: governance({
      externallyHosted: false,
      restrictedModeEligible: true,
    }),
    responses: [new Error("network timeout"), new Error("network timeout")],
  });
  const externalFallback = fakeAdapter({ provider: "external-fallback" });
  assert.equal(
    providerGovernanceAtLeastAsProtective(
      externalFallback.adapter.descriptor.dataGovernance!,
      localPrimary.adapter.descriptor.dataGovernance!,
    ),
    false,
  );
  const failure = await assertGatewayCode(
    executeAiGatewayRequest(
      baseRequest(localPrimary.adapter, {
        adapters: [localPrimary.adapter, externalFallback.adapter],
      }),
    ),
    "AI_PROVIDER_FAILED",
  );
  assert.equal(externalFallback.requests.length, 0);
  assert.doesNotMatch(failure.message, /network/i);
});

test("usage and schema failures are safe; schema failures retain auditable provenance", async () => {
  const missingUsage = fakeAdapter({
    responses: [
      {
        content: JSON.stringify({ review: "Draft" }),
        promptTokens: null,
        completionTokens: 1,
      },
    ],
  });
  await assertGatewayCode(
    executeAiGatewayRequest(baseRequest(missingUsage.adapter)),
    "AI_USAGE_UNAVAILABLE",
  );

  const invalidOutput = fakeAdapter({
    responses: [
      {
        content: JSON.stringify({ review: "Draft", approved: true }),
        promptTokens: 4,
        completionTokens: 2,
        providerRequestId: "invalid-schema-request",
      },
    ],
  });
  const error = await assertGatewayCode(
    executeAiGatewayRequest(baseRequest(invalidOutput.adapter)),
    "AI_OUTPUT_SCHEMA_INVALID",
  );
  assert.equal(error.telemetry?.provider, "verified-provider");
  assert.equal(error.telemetry?.providerRequestId, "invalid-schema-request");
  assert.equal(
    error.telemetry?.schemaHash,
    AI_PROMPT_REGISTRY.responsiveness_review.schemaHash,
  );
});

test("input limits, invalid canonical data, and caller cancellation stop before disclosure", async () => {
  const tooLarge = fakeAdapter();
  await assertGatewayCode(
    executeAiGatewayRequest(
      baseRequest(tooLarge.adapter, {
        userContent: "x".repeat(
          AI_CAPABILITY_POLICY.responsiveness_review.limits.maxInputBytes,
        ),
      }),
    ),
    "AI_INPUT_LIMIT_EXCEEDED",
  );
  const invalid = fakeAdapter();
  await assertGatewayCode(
    executeAiGatewayRequest(
      baseRequest(invalid.adapter, { userContent: { invalid: 1n } }),
    ),
    "AI_INVALID_REQUEST",
  );
  const cancelled = fakeAdapter();
  const controller = new AbortController();
  controller.abort();
  await assertGatewayCode(
    executeAiGatewayRequest(
      baseRequest(cancelled.adapter, { signal: controller.signal }),
    ),
    "AI_CANCELLED",
  );
  assert.equal(tooLarge.requests.length, 0);
  assert.equal(invalid.requests.length, 0);
  assert.equal(cancelled.requests.length, 0);
});

test("invalid runtime environment cannot bypass production controls", async () => {
  const fake = fakeAdapter();
  await assertGatewayCode(
    executeAiGatewayRequest(
      baseRequest(fake.adapter, {
        environment: "preview" as AiGatewayRequest["environment"],
      }),
    ),
    "AI_INVALID_REQUEST",
  );
  assert.equal(fake.requests.length, 0);
});

test("reported usage cannot exceed output or approved post-call cost limits", async () => {
  const excessiveOutput = fakeAdapter({
    responses: [
      {
        content: JSON.stringify({ review: "Draft" }),
        promptTokens: 1,
        completionTokens:
          AI_CAPABILITY_POLICY.responsiveness_review.limits.maxOutputTokens + 1,
      },
    ],
  });
  await assertGatewayCode(
    executeAiGatewayRequest(baseRequest(excessiveOutput.adapter)),
    "AI_USAGE_UNAVAILABLE",
  );

  const expensiveUsage = fakeAdapter({
    responses: [
      {
        content: JSON.stringify({ review: "Draft" }),
        promptTokens: 100_000,
        completionTokens: 1,
        providerRequestId: "over-budget-request",
      },
    ],
  });
  const request = baseRequest(expensiveUsage.adapter);
  const error = await assertGatewayCode(
    executeAiGatewayRequest({
      ...request,
      budget: { ...request.budget!, remainingMinor: 1000 },
    }),
    "AI_BUDGET_EXCEEDED",
  );
  assert.equal(error.telemetry?.providerRequestId, "over-budget-request");
  assert.equal(error.telemetry?.costMinor, 2001);
});

test("OCR gateway calls require an explicitly multimodal provider and registered OCR schema", async () => {
  const notMultimodal = fakeAdapter({ capabilities: ["structured_json"] });
  await assertGatewayCode(
    executeAiGatewayRequest(
      baseRequest(notMultimodal.adapter, {
        capability: "extract_pdf_multimodal",
      }),
    ),
    "AI_PROVIDER_UNAVAILABLE",
  );
  const multimodal = fakeAdapter({
    responses: [
      {
        content: JSON.stringify({ text: "verbatim tender text" }),
        promptTokens: 2,
        completionTokens: 3,
      },
    ],
  });
  await executeAiGatewayRequest(
    baseRequest(multimodal.adapter, {
      capability: "extract_pdf_multimodal",
    }),
  );
  assert.deepEqual(
    multimodal.requests[0].outputSchema?.schema,
    AI_PROMPT_REGISTRY.extract_pdf_multimodal.outputSchema,
  );
});
