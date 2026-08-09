import assert from "node:assert/strict";
import test from "node:test";
import { buildProductionReadinessSnapshot } from "./productionReadiness";

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
