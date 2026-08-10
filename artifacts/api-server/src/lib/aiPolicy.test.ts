import assert from "node:assert/strict";
import test from "node:test";
import {
  AI_CAPABILITY_IDS,
  AI_CAPABILITY_POLICY,
  AI_SAFE_ERROR_CODES,
  evaluateAiCapabilityGate,
  isGlobalAiKillSwitchEngaged,
  productionCapabilityEnvironmentKey,
} from "./aiPolicy";

test("the five current capabilities have bounded Level 2 approval contracts", () => {
  assert.deepEqual(Object.keys(AI_CAPABILITY_POLICY), AI_CAPABILITY_IDS);
  for (const capability of AI_CAPABILITY_IDS) {
    const policy = AI_CAPABILITY_POLICY[capability];
    assert.equal(Object.isFrozen(policy), true);
    assert.equal(Object.isFrozen(policy.limits), true);
    assert.equal(Object.isFrozen(policy.approval), true);
    assert.equal(Object.isFrozen(policy.failure), true);
    assert.equal(policy.id, capability);
    assert.equal(policy.autonomyLevel, 2);
    assert.equal(policy.actionClass, "reversible_draft");
    assert.equal(policy.authoritativeMutationAllowed, false);
    assert.equal(policy.approval.outputState, "non_authoritative_draft");
    assert.equal(policy.approval.authoritativeUseRequiresHumanApproval, true);
    assert.equal(policy.approval.namedHumanRequired, true);
    assert.equal(policy.approval.aiSelfApprovalForbidden, true);
    assert.ok(policy.approval.approvalAuthority.length > 0);
    assert.equal(policy.failure.behavior, "fail_closed");
    assert.equal(policy.failure.partialOutputMayPersist, false);
    assert.equal(policy.failure.manualRecoveryRequired, true);
    assert.equal(
      policy.failure.providerFallback,
      "equivalent_or_stronger_only",
    );
    assert.ok(policy.limits.maxInputBytes > 0);
    assert.ok(policy.limits.maxOutputTokens > 0);
    assert.ok(policy.limits.timeoutMs > 0);
    assert.ok(policy.limits.maxRetriesPerProvider >= 0);
    assert.ok(policy.limits.maxFallbackProviders >= 0);
    assert.ok(policy.limits.maxCostMinor > 0);
    assert.equal(policy.limits.costCurrency, "NGN");
  }
  assert.equal(Object.isFrozen(AI_CAPABILITY_POLICY), true);
});

test("safe error codes are stable, unique and non-provider-specific", () => {
  assert.equal(new Set(AI_SAFE_ERROR_CODES).size, AI_SAFE_ERROR_CODES.length);
  assert.ok(AI_SAFE_ERROR_CODES.every((code) => /^AI_[A-Z_]+$/.test(code)));
  assert.ok(AI_SAFE_ERROR_CODES.includes("AI_PROVIDER_PRIVACY_UNVERIFIED"));
  assert.ok(AI_SAFE_ERROR_CODES.includes("AI_CAPABILITY_GATE_UNAVAILABLE"));
});

test("the global production switch defaults off and the emergency kill switch wins", () => {
  assert.equal(isGlobalAiKillSwitchEngaged("development", {}), false);
  assert.equal(isGlobalAiKillSwitchEngaged("production", {}), true);
  assert.equal(
    isGlobalAiKillSwitchEngaged("production", {
      VALO_AI_GLOBAL_ENABLED: "true",
    }),
    false,
  );
  assert.equal(
    isGlobalAiKillSwitchEngaged("production", {
      VALO_AI_GLOBAL_ENABLED: "true",
      VALO_AI_KILL_SWITCH: "true",
    }),
    true,
  );
});

test("production capability gates fail closed when unavailable, false, or throwing", async () => {
  const base = {
    capability: "map_evidence" as const,
    environment: "production" as const,
    globalKillSwitchEngaged: false,
  };
  assert.deepEqual(await evaluateAiCapabilityGate(base), {
    allowed: false,
    code: "AI_CAPABILITY_GATE_UNAVAILABLE",
  });
  assert.deepEqual(
    await evaluateAiCapabilityGate({
      ...base,
      resolveCapabilityEnabled: () => false,
    }),
    { allowed: false, code: "AI_CAPABILITY_DISABLED" },
  );
  assert.deepEqual(
    await evaluateAiCapabilityGate({
      ...base,
      resolveCapabilityEnabled: () => {
        throw new Error("configuration store unavailable");
      },
    }),
    { allowed: false, code: "AI_CAPABILITY_GATE_UNAVAILABLE" },
  );
  assert.deepEqual(
    await evaluateAiCapabilityGate({
      ...base,
      resolveCapabilityEnabled: async () => true,
    }),
    { allowed: true },
  );
});

test("global disable takes priority and non-production remains independently gateable", async () => {
  assert.deepEqual(
    await evaluateAiCapabilityGate({
      capability: "suggest_defects",
      environment: "production",
      globalKillSwitchEngaged: true,
      resolveCapabilityEnabled: () => true,
    }),
    { allowed: false, code: "AI_GLOBAL_DISABLED" },
  );
  assert.deepEqual(
    await evaluateAiCapabilityGate({
      capability: "suggest_defects",
      environment: "test",
      globalKillSwitchEngaged: false,
    }),
    { allowed: true },
  );
  assert.deepEqual(
    await evaluateAiCapabilityGate({
      capability: "suggest_defects",
      environment: "test",
      globalKillSwitchEngaged: false,
      resolveCapabilityEnabled: () => false,
    }),
    { allowed: false, code: "AI_CAPABILITY_DISABLED" },
  );
});

test("production capability environment keys are deterministic", () => {
  assert.equal(
    productionCapabilityEnvironmentKey("extract_pdf_multimodal"),
    "VALO_AI_EXTRACT_PDF_MULTIMODAL_ENABLED",
  );
});
