import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateProductionAdapters,
  executeJsonWithFallback,
  ProviderChainError,
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
