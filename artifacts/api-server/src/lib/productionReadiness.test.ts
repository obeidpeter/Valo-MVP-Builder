import assert from "node:assert/strict";
import test from "node:test";
import {
  buildProductionReadinessSnapshot,
  declaredRequiredProductionAdapterKinds,
} from "./productionReadiness";

test("production authentication is mandatory without an env declaration", () => {
  assert.deepEqual(declaredRequiredProductionAdapterKinds(undefined), [
    "authentication",
  ]);
  assert.deepEqual(
    declaredRequiredProductionAdapterKinds("audit_anchor,authentication"),
    ["authentication", "audit_anchor"],
  );
  assert.throws(
    () => declaredRequiredProductionAdapterKinds("not-a-real-adapter"),
    /unknown kinds: not-a-real-adapter/u,
  );
});

test("startup readiness separates fatal declarations from feature gates", () => {
  const snapshot = buildProductionReadinessSnapshot(
    ["authentication"],
    [
      {
        kind: "authentication",
        provider: "clerk",
        mode: "production",
        productionApproved: true,
        capabilities: [],
      },
      {
        kind: "object_storage",
        provider: "storage",
        mode: "production",
        productionApproved: true,
        capabilities: [],
      },
      {
        kind: "model",
        provider: "candidate",
        mode: "production",
        productionApproved: false,
        capabilities: [],
      },
    ],
  );
  assert.deepEqual(snapshot.strictIssues, []);
  assert.deepEqual(
    snapshot.featureIssues.document_intake.map((issue) => [
      issue.kind,
      issue.code,
    ]),
    [["malware_scan", "missing"]],
  );
  assert.deepEqual(
    snapshot.featureIssues.model_workflows.map((issue) => issue.code),
    ["not_approved"],
  );
});

test("a missing globally declared adapter is a startup issue", () => {
  const snapshot = buildProductionReadinessSnapshot(["audit_anchor"], []);
  assert.equal(snapshot.strictIssues[0]?.kind, "audit_anchor");
  assert.equal(snapshot.strictIssues[0]?.code, "missing");
});

test("model workflows stay gated until privacy governance is verified", () => {
  const base = {
    kind: "model" as const,
    provider: "model-provider",
    mode: "production" as const,
    productionApproved: true,
    capabilities: ["structured_json"],
  };
  const unverified = buildProductionReadinessSnapshot([], [base]);
  assert.deepEqual(
    unverified.featureIssues.model_workflows.map((issue) => issue.code),
    ["privacy_unverified"],
  );

  const verified = buildProductionReadinessSnapshot(
    [],
    [
      {
        ...base,
        dataGovernance: {
          externallyHosted: true,
          noTrainingVerified: true,
          retentionMode: "zero",
          maxRetentionDays: null,
          regions: ["ng"],
          dpaApproved: true,
          restrictedModeEligible: false,
          evidenceVersion: "privacy-review-v1",
        },
      },
    ],
  );
  assert.deepEqual(verified.featureIssues.model_workflows, []);
});
