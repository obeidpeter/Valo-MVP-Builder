import assert from "node:assert/strict";
import test from "node:test";
import {
  PRODUCTION_ACCEPTANCE_CATEGORIES,
  type ProductionAcceptanceCategory,
  type ProductionAcceptanceEvidenceDraft,
  type ProductionAcceptanceEvidenceRecord,
  type ProductionAcceptanceScope,
} from "./contracts";
import {
  ProductionAcceptanceValidationError,
  buildProductionAcceptanceSnapshot,
  createProductionAcceptanceEvidence,
  verifyProductionAcceptanceEvidenceDigest,
} from "./service";

const RELEASE_SHA = "a".repeat(64);
const ARTIFACT_SHA = "b".repeat(64);
const NOW = new Date("2026-08-11T10:00:00.000Z");
const OWNER_USER_ID = "33333333-3333-4333-8333-333333333333";
const SCOPE: ProductionAcceptanceScope = {
  organisationId: "11111111-1111-4111-8111-111111111111",
  actorUserId: "22222222-2222-4222-8222-222222222222",
};

function draft(
  category: ProductionAcceptanceCategory,
  overrides: Partial<ProductionAcceptanceEvidenceDraft> = {},
): ProductionAcceptanceEvidenceDraft {
  return {
    category,
    outcome: "passed",
    environment: "recovery_rehearsal",
    releaseSha256: RELEASE_SHA,
    ownerUserId: OWNER_USER_ID,
    observedAt: "2026-08-11T09:00:00.000Z",
    expiresAt:
      category === "backup"
        ? "2026-08-18T09:00:00.000Z"
        : "2026-08-25T09:00:00.000Z",
    evidenceReference: `retained/${category}/run-17`,
    artifactSha256: ARTIFACT_SHA,
    summary: `${category} completed against synthetic data`,
    idempotencyKey: `acceptance-${category}-0001`,
    ...overrides,
  };
}

function record(
  category: ProductionAcceptanceCategory,
  overrides: Partial<ProductionAcceptanceEvidenceDraft> = {},
  now = NOW,
): ProductionAcceptanceEvidenceRecord {
  return createProductionAcceptanceEvidence({
    draft: draft(category, overrides),
    scope: SCOPE,
    now,
  });
}

test("evidence digests are deterministic and bind every immutable field", () => {
  const first = record("migration");
  const second = record("migration");
  assert.equal(first.evidenceDigest, second.evidenceDigest);
  assert.equal(first.id, first.evidenceDigest);
  assert.equal(verifyProductionAcceptanceEvidenceDigest(first), true);

  const tampered = { ...first, summary: "quietly changed" };
  assert.equal(verifyProductionAcceptanceEvidenceDigest(tampered), false);
});

test("complete current evidence recommends go but never authorises deployment", () => {
  const evidence = PRODUCTION_ACCEPTANCE_CATEGORIES.map((category) =>
    record(category),
  );
  const snapshot = buildProductionAcceptanceSnapshot({
    organisationId: SCOPE.organisationId,
    evidence,
    expectedReleaseSha256: RELEASE_SHA,
    now: NOW,
  });
  assert.equal(snapshot.recommendedDecision, "go");
  assert.equal(snapshot.deploymentAuthorized, false);
  assert.equal(snapshot.requiresNamedHumanApproval, true);
  assert.deepEqual(snapshot.blockers, []);
  assert.equal(
    snapshot.categories.every(({ state }) => state === "passed"),
    true,
  );
});

test("missing, failed, expired and release-mismatched evidence fail closed", () => {
  const priorClock = new Date("2026-08-01T10:00:00.000Z");
  const evidence = [
    record("migration", { releaseSha256: "c".repeat(64) }),
    record("rls", { outcome: "failed" }),
    record(
      "tenant_isolation",
      {
        observedAt: "2026-08-01T09:00:00.000Z",
        expiresAt: "2026-08-05T09:00:00.000Z",
      },
      priorClock,
    ),
  ];
  const snapshot = buildProductionAcceptanceSnapshot({
    organisationId: SCOPE.organisationId,
    evidence,
    expectedReleaseSha256: RELEASE_SHA,
    now: NOW,
  });
  assert.equal(snapshot.recommendedDecision, "no_go");
  assert.equal(
    snapshot.categories.find(({ category }) => category === "migration")?.state,
    "release_mismatch",
  );
  assert.equal(
    snapshot.categories.find(({ category }) => category === "rls")?.state,
    "failed",
  );
  assert.equal(
    snapshot.categories.find(({ category }) => category === "tenant_isolation")
      ?.state,
    "expired",
  );
  assert.equal(
    snapshot.categories.find(
      ({ category }) => category === "browser_accessibility",
    )?.state,
    "missing",
  );
});

test("tampered or cross-tenant repository rows produce integrity blockers", () => {
  const valid = record("migration");
  const snapshot = buildProductionAcceptanceSnapshot({
    organisationId: SCOPE.organisationId,
    evidence: [
      { ...valid, artifactSha256: "d".repeat(64) },
      {
        ...record("rls"),
        organisationId: "44444444-4444-4444-8444-444444444444",
      },
      { unknown: true },
    ],
    expectedReleaseSha256: RELEASE_SHA,
    now: NOW,
  });
  assert.equal(snapshot.recommendedDecision, "no_go");
  assert.equal(
    snapshot.blockers.some(({ code }) => code === "MIGRATION_INTEGRITY_FAILED"),
    true,
  );
  assert.equal(
    snapshot.blockers.some(({ code }) => code === "RLS_INTEGRITY_FAILED"),
    true,
  );
  assert.equal(
    snapshot.blockers.some(({ code }) => code === "EVIDENCE_INTEGRITY_FAILED"),
    true,
  );
});

test("recording enforces independent verification and bounded freshness", () => {
  assert.throws(
    () =>
      record("backup", {
        ownerUserId: SCOPE.actorUserId,
      }),
    (error: unknown) =>
      error instanceof ProductionAcceptanceValidationError &&
      error.code === "OWNER_VERIFIER_CONFLICT",
  );
  assert.throws(
    () =>
      record("backup", {
        expiresAt: "2026-09-30T09:00:00.000Z",
      }),
    (error: unknown) =>
      error instanceof ProductionAcceptanceValidationError &&
      error.code === "EVIDENCE_WINDOW_TOO_LONG",
  );
});
