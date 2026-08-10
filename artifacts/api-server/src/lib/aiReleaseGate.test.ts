import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateReport,
  computeTenderRecall,
  type EvalReport,
  type EvalTender,
} from "./evalHarness";
import {
  evaluateAiRelease,
  type AiReleaseBlockerCode,
  type AiReleaseGateInput,
  type AiReleaseVersions,
} from "./aiReleaseGate";

const versions: AiReleaseVersions = {
  model: "model-v1",
  modelConfiguration: "model-config-v1",
  prompt: "prompt-v1",
  promptRegistry: "prompt-registry-v1",
  schema: "schema-v1",
  retrieval: "retrieval-v1",
  index: "index-v1",
};

function passingReport(): EvalReport {
  const extraction: EvalTender = {
    id: "fatal-extraction",
    title: "Fatal requirement fixture",
    documentText: "A bid security is mandatory.",
    groundTruth: [
      {
        id: "bid-security",
        label: "Bid security",
        mandatory: true,
        severity: "fatal",
        match: [["bid security"]],
      },
    ],
  };
  const abstention: EvalTender = {
    id: "abstention",
    title: "No accessible evidence",
    documentText: "Unreadable fixture marker.",
    groundTruth: [],
    expectedBehaviour: "abstain",
  };
  const safeFailure: EvalTender = {
    id: "safe-failure",
    title: "Provider failure",
    documentText: "Provider failure fixture marker.",
    groundTruth: [],
    expectedBehaviour: "safe_failure",
  };
  const perTender = [
    computeTenderRecall(extraction, {
      disposition: "completed",
      requirements: [
        {
          text: "Bid security is mandatory",
          citationVerdict: "correct",
          unsupportedClaim: false,
        },
      ],
    }),
    computeTenderRecall(abstention, {
      disposition: "abstained",
      requirements: [],
    }),
    computeTenderRecall(safeFailure, {
      disposition: "safe_failure",
      requirements: [],
    }),
  ];
  for (let index = 0; index < 22; index += 1) {
    const label = `Requirement ${index}`;
    perTender.push(
      computeTenderRecall(
        {
          id: `representative-${index}`,
          title: `Representative holdout ${index}`,
          documentText: `${label} is mandatory.`,
          groundTruth: [
            {
              id: `requirement-${index}`,
              label,
              mandatory: true,
              severity: "material",
              match: [[label]],
            },
          ],
        },
        {
          disposition: "completed",
          requirements: [
            {
              text: `${label} is mandatory.`,
              citationVerdict: "correct",
              unsupportedClaim: false,
            },
          ],
        },
      ),
    );
  }
  return aggregateReport(perTender);
}

function passingInput(): AiReleaseGateInput {
  const report = passingReport();
  return {
    expectedVersions: { ...versions },
    evaluation: {
      runId: "eval-run-1",
      live: true,
      status: "passed",
      profile: "production",
      completedAt: "2026-08-09T12:00:00Z",
      versions: { ...versions },
      report,
      corpus: {
        passed: true,
        productionEligible: true,
        caseCount: 25,
        caseIds: report.perTender.map((tender) => tender.tenderId),
        problems: [],
      },
    },
    provider: {
      approved: true,
      provider: "approved-provider",
      region: "approved-region",
      modelAllowlist: ["model-v1"],
      trainingUseDisabled: true,
      retentionDays: 0,
      approvalReference: "provider-approval-1",
    },
    privacy: {
      approved: true,
      residencyDecision: "approved-region only",
      dpaReference: "dpa-1",
      dpiaReference: "dpia-1",
      retentionPolicyReference: "retention-1",
      redactionPolicyReference: "redaction-1",
      approvalReference: "privacy-approval-1",
    },
    budget: {
      approved: true,
      currency: "NGN",
      maxCostPerRunMinor: 100_000,
      maxMonthlyCostMinor: 1_000_000,
      maxInputTokens: 20_000,
      maxOutputTokens: 4_000,
      maxLatencyMs: 60_000,
      rateCardVersion: "rate-card-v1",
      inputCostMinorPerThousandTokens: 10,
      outputCostMinorPerThousandTokens: 20,
      approvalReference: "budget-approval-1",
    },
    rollout: {
      globalKillSwitchReady: true,
      capabilityKillSwitchesReady: true,
      stagedRolloutConfigured: true,
      rollbackTested: true,
      owner: "ai-operations-owner",
      approvalReference: "rollout-approval-1",
    },
  };
}

test("allows only a complete, current production evidence bundle", () => {
  assert.deepEqual(evaluateAiRelease(passingInput()), {
    allowed: true,
    blockers: [],
  });
});

test("fails closed when live evaluation and operational decisions are absent", () => {
  const result = evaluateAiRelease({ expectedVersions: versions });
  assert.equal(result.allowed, false);
  const codes = new Set(result.blockers.map((blocker) => blocker.code));
  for (const required of [
    "live_evaluation_missing",
    "provider_decision_missing",
    "privacy_decision_missing",
    "budget_decision_missing",
    "rollout_control_missing",
  ] satisfies AiReleaseBlockerCode[]) {
    assert.equal(codes.has(required), true, required);
  }
});

test("blocks stale model configuration, prompt registry and other release evidence", () => {
  const input = passingInput();
  input.evaluation!.versions = {
    model: "old-model",
    modelConfiguration: "old-model-config",
    prompt: "old-prompt",
    promptRegistry: "old-prompt-registry",
    schema: "old-schema",
    retrieval: "old-retrieval",
    index: "old-index",
  };
  const result = evaluateAiRelease(input);
  assert.equal(
    result.blockers.filter((blocker) => blocker.code === "version_mismatch")
      .length,
    7,
  );
});

test("rejects placeholder versions and an unapproved release model", () => {
  const input = passingInput();
  input.expectedVersions.retrieval = "not_implemented";
  input.evaluation!.versions.retrieval = "not_implemented";
  input.provider!.modelAllowlist = ["different-model-v1"];
  const result = evaluateAiRelease(input);
  assert.equal(result.allowed, false);
  assert.ok(
    result.blockers.some((blocker) => blocker.code === "version_missing"),
  );
  assert.ok(
    result.blockers.some(
      (blocker) => blocker.code === "provider_decision_incomplete",
    ),
  );
});

test("recomputes metric gates instead of trusting a stored passed status", () => {
  const input = passingInput();
  input.evaluation!.report.citationCorrectness = 0.97;
  input.evaluation!.report.fatalMisses = 1;
  input.evaluation!.report.fatalMatched = 0;
  const result = evaluateAiRelease(input);
  assert.equal(result.allowed, false);
  assert.ok(
    result.blockers.some(
      (blocker) =>
        blocker.code === "metric_gate_failed" &&
        blocker.message.includes("citation_correctness"),
    ),
  );
  assert.ok(
    result.blockers.some(
      (blocker) =>
        blocker.code === "metric_gate_failed" &&
        blocker.message.includes("fatal_misses"),
    ),
  );
});

test("blocks partial or duplicate per-case evaluation coverage", () => {
  const input = passingInput();
  input.evaluation!.report.perTender.pop();
  input.evaluation!.report.perTender[1]!.tenderId =
    input.evaluation!.report.perTender[0]!.tenderId;
  const result = evaluateAiRelease(input);
  assert.equal(result.allowed, false);
  assert.ok(
    result.blockers.some(
      (blocker) =>
        blocker.code === "live_evaluation_incomplete" &&
        blocker.message.includes("one unique result"),
    ),
  );
});

test("blocks report case identities outside the validated manifest", () => {
  const input = passingInput();
  input.evaluation!.report.perTender[0]!.tenderId = "unrelated-case";
  const result = evaluateAiRelease(input);
  assert.equal(result.allowed, false);
  assert.ok(
    result.blockers.some(
      (blocker) =>
        blocker.code === "live_evaluation_incomplete" &&
        blocker.message.includes("one unique result"),
    ),
  );
});

test("Gate-0, synthetic corpus and incomplete decisions cannot promote", () => {
  const input = passingInput();
  input.evaluation!.profile = "gate0_non_production";
  input.evaluation!.corpus = {
    passed: true,
    productionEligible: false,
    caseCount: 14,
    caseIds: Array.from({ length: 14 }, (_, index) => `synthetic-${index}`),
    problems: ["synthetic self-check only"],
  };
  input.provider!.trainingUseDisabled = false;
  input.privacy!.dpiaReference = "";
  input.budget!.maxMonthlyCostMinor = 0;
  input.rollout!.rollbackTested = false;
  const codes = new Set(
    evaluateAiRelease(input).blockers.map((blocker) => blocker.code),
  );
  for (const expected of [
    "non_production_profile",
    "corpus_ineligible",
    "provider_decision_incomplete",
    "privacy_decision_incomplete",
    "budget_decision_incomplete",
    "rollout_control_incomplete",
  ] satisfies AiReleaseBlockerCode[]) {
    assert.equal(codes.has(expected), true, expected);
  }
});
