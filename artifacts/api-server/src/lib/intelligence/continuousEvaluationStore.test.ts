import "../../test-env";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import {
  PRODUCTION_CONTINUOUS_EVAL_PROFILE_VERSION,
  REQUIRED_CONTINUOUS_EVAL_COHORTS,
} from "../aiContinuousEval";
import {
  CONTINUOUS_EVALUATION_STORE_STATUS,
  ContinuousEvaluationStoreError,
  continuousEvaluationCaseLabelHash,
  createContinuousEvaluationStore,
  type ContinuousEvaluationCase,
  type ContinuousEvaluationCaseContract,
  type ContinuousEvaluationCreateCaseInput,
  type ContinuousEvaluationRepository,
  type ContinuousEvaluationResult,
  type ContinuousEvaluationReview,
  type ContinuousEvaluationRun,
} from "./continuousEvaluationStore";

const ORG = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const OTHER_PROJECT = "99999999-9999-4999-8999-999999999999";
const MODEL_CONFIG = "33333333-3333-4333-8333-333333333333";
const PROMPT_CONFIG = "44444444-4444-4444-8444-444444444444";
const REVIEWER = "55555555-5555-4555-8555-555555555555";
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const FIXTURE_DIGEST = hash("fixture-1");
const LABEL_DIGEST = hash("label-1");
const OUTPUT_HASH = hash("output-1");

type RepoInput<K extends keyof ContinuousEvaluationRepository> = Parameters<
  ContinuousEvaluationRepository[K]
>[0];

class MemoryEvaluationRepository implements ContinuousEvaluationRepository {
  readonly cases = new Map<string, ContinuousEvaluationCase>();
  readonly runs = new Map<string, ContinuousEvaluationRun>();
  readonly results = new Map<string, ContinuousEvaluationResult>();
  readonly reviews = new Map<string, ContinuousEvaluationReview>();
  forceCompletionCasConflict = false;

  async createCase(
    input: RepoInput<"createCase">,
  ): Promise<ContinuousEvaluationCase> {
    const existing = [...this.cases.values()].find(
      (evalCase) =>
        evalCase.corpusVersion === input.corpusVersion &&
        evalCase.fixtureReference === input.fixtureReference,
    );
    if (existing) {
      if (existing.labelHash !== input.labelHash) {
        throw new ContinuousEvaluationStoreError("result_conflict");
      }
      return existing;
    }
    const evalCase: ContinuousEvaluationCase = {
      id: randomUUID(),
      organisationId: input.organisationId,
      corpusVersion: input.corpusVersion,
      split: input.split,
      task: input.task,
      fixtureReference: input.fixtureReference,
      labelHash: input.labelHash,
      fatalLabelCount: input.contract.fatalLabelCount,
      likelyFatalLabelCount: input.contract.likelyFatalLabelCount,
      createdAt: input.now,
    };
    this.cases.set(evalCase.id, evalCase);
    return evalCase;
  }

  async findCase(
    scope: RepoInput<"findCase">,
    caseId: string,
  ): Promise<ContinuousEvaluationCase | null> {
    const evalCase = this.cases.get(caseId);
    return evalCase?.organisationId === scope.organisationId ? evalCase : null;
  }

  async createRun(
    input: RepoInput<"createRun">,
  ): Promise<ContinuousEvaluationRun> {
    const run: ContinuousEvaluationRun = {
      id: randomUUID(),
      organisationId: input.organisationId,
      task: input.task,
      corpusVersion: input.corpusVersion,
      modelConfigurationId: input.modelConfigurationId,
      promptConfigurationId: input.promptConfigurationId,
      status: "draft",
      sampleSize: 0,
      metrics: input.metricsJson,
      limitations: null,
      releaseDecision: "pending",
      startedAt: input.now,
      completedAt: null,
    };
    this.runs.set(run.id, run);
    return run;
  }

  async findRun(
    scope: RepoInput<"findRun">,
    runId: string,
  ): Promise<ContinuousEvaluationRun | null> {
    const run = this.runs.get(runId);
    return run?.organisationId === scope.organisationId ? run : null;
  }

  async startRun(
    scope: RepoInput<"startRun">,
    runId: string,
    now: Date,
  ): Promise<ContinuousEvaluationRun | null> {
    const current = this.runs.get(runId);
    if (
      current?.organisationId !== scope.organisationId ||
      current.status !== "draft" ||
      current.releaseDecision !== "pending"
    ) {
      return null;
    }
    const run = { ...current, status: "running", startedAt: now };
    this.runs.set(run.id, run);
    return run;
  }

  async appendResult(
    input: RepoInput<"appendResult">,
  ): Promise<
    Awaited<ReturnType<ContinuousEvaluationRepository["appendResult"]>>
  > {
    const run = this.runs.get(input.runId);
    if (
      run?.organisationId !== input.organisationId ||
      run.status !== "running" ||
      run.releaseDecision !== "pending"
    ) {
      return null;
    }
    const resultKey = `${input.runId}:${input.caseId}`;
    const existing = this.results.get(resultKey);
    if (existing) return { result: existing, inserted: false };
    if (
      run.sampleSize !== input.expectedSampleSize ||
      run.sampleSize >= 100_000
    ) {
      return null;
    }
    const result: ContinuousEvaluationResult = {
      id: randomUUID(),
      evaluationRunId: input.runId,
      evaluationCaseId: input.caseId,
      passed: input.passed,
      resultMetrics: input.resultMetricsJson,
      outputHash: input.outputHash ?? null,
      errorCode: input.errorCode ?? null,
      createdAt: input.now,
    };
    const review: ContinuousEvaluationReview = {
      id: randomUUID(),
      organisationId: input.organisationId,
      projectId: input.projectId,
      reviewType: "ai_evaluation_observation",
      objectType: "evaluation_result",
      objectId: result.id,
      reviewerUserId: input.reviewer.reviewerUserId,
      status: "completed",
      findings: JSON.stringify({
        outcome: input.reviewer.outcome,
        humanCorrect: input.reviewer.humanCorrect,
        reasonCodes: input.reviewer.reasonCodes,
      }),
      sourceVersion: 1,
      completedAt: input.now,
      version: 1,
      createdAt: input.now,
      updatedAt: input.now,
    };
    this.results.set(resultKey, result);
    this.reviews.set(review.id, review);
    this.runs.set(run.id, { ...run, sampleSize: run.sampleSize + 1 });
    return { result, review, inserted: true };
  }

  async listResults(
    scope: RepoInput<"listResults">,
    runId: string,
    limit: number,
  ): Promise<ContinuousEvaluationResult[]> {
    const run = this.runs.get(runId);
    if (run?.organisationId !== scope.organisationId) return [];
    return [...this.results.values()]
      .filter((result) => result.evaluationRunId === runId)
      .sort((left, right) => left.id.localeCompare(right.id))
      .slice(0, limit);
  }

  async completeRun(
    input: RepoInput<"completeRun">,
  ): Promise<ContinuousEvaluationRun | null> {
    const current = this.runs.get(input.runId);
    if (this.forceCompletionCasConflict && current) {
      this.forceCompletionCasConflict = false;
      this.runs.set(current.id, {
        ...current,
        sampleSize: current.sampleSize + 1,
      });
    }
    const currentAfterRace = this.runs.get(input.runId);
    if (
      currentAfterRace?.organisationId !== input.organisationId ||
      currentAfterRace.status !== "running" ||
      currentAfterRace.releaseDecision !== "pending" ||
      currentAfterRace.sampleSize !== input.expectedSampleSize
    ) {
      return null;
    }
    const run: ContinuousEvaluationRun = {
      ...currentAfterRace,
      status: "completed",
      metrics: input.metricsJson,
      limitations: input.limitationsJson,
      releaseDecision: "pending",
      completedAt: input.now,
    };
    this.runs.set(run.id, run);
    return run;
  }

  async abortRun(
    input: RepoInput<"abortRun">,
  ): Promise<ContinuousEvaluationRun | null> {
    const current = this.runs.get(input.runId);
    if (
      current?.organisationId !== input.organisationId ||
      !new Set(["draft", "running"]).has(current.status) ||
      current.releaseDecision !== "pending"
    ) {
      return null;
    }
    const run: ContinuousEvaluationRun = {
      ...current,
      status: "failed",
      limitations: input.limitationsJson,
      releaseDecision: "pending",
      completedAt: input.now,
    };
    this.runs.set(run.id, run);
    return run;
  }
}

const contract: ContinuousEvaluationCaseContract = {
  cohorts: ["representative"],
  risk: "high",
  dataScope: "synthetic",
  productionEligible: false,
  expectedDisposition: "completed",
  labelDigest: LABEL_DIGEST,
  fatalLabelCount: 1,
  likelyFatalLabelCount: 0,
  annotationStatus: "single_review",
  annotatorCount: 1,
  independentlyAdjudicated: false,
};

const productionContract: ContinuousEvaluationCaseContract = {
  ...contract,
  cohorts: [...REQUIRED_CONTINUOUS_EVAL_COHORTS],
  productionEligible: true,
  annotationStatus: "adjudicated",
  annotatorCount: 2,
  independentlyAdjudicated: true,
};

const versions = {
  model: "gpt-version-1",
  modelConfiguration: "model-config-1",
  prompt: "prompt-1",
  schema: "schema-1",
  retrieval: "retrieval-1",
  index: "index-1",
  policy: "policy-1",
  corpus: "corpus-1",
};

function setup() {
  const repository = new MemoryEvaluationRepository();
  let clock = new Date("2026-08-10T12:00:00.000Z");
  const store = createContinuousEvaluationStore({
    repository,
    now: () => clock,
  });
  const caseInput: ContinuousEvaluationCreateCaseInput = {
    organisationId: ORG,
    projectId: PROJECT,
    corpusVersion: "corpus-1",
    split: "holdout",
    task: "map_evidence",
    fixtureDigest: FIXTURE_DIGEST,
    contract,
  };
  const createRun = () =>
    store.createRun({
      organisationId: ORG,
      projectId: PROJECT,
      task: "map_evidence",
      corpusVersion: "corpus-1",
      modelConfigurationId: MODEL_CONFIG,
      promptConfigurationId: PROMPT_CONFIG,
      expectedVersions: versions,
      profileVersion: "production-profile-1",
      cohorts: ["representative"],
    });
  return {
    repository,
    store,
    caseInput,
    createRun,
    setClock(value: string) {
      clock = new Date(value);
    },
  };
}

function storeErrorCode(error: unknown): string | undefined {
  return error instanceof ContinuousEvaluationStoreError
    ? error.code
    : undefined;
}

async function createStartedRun() {
  const context = setup();
  const evalCase = await context.store.createCase(context.caseInput);
  const draft = await context.createRun();
  const run = await context.store.startRun({
    organisationId: ORG,
    projectId: PROJECT,
    runId: draft.id,
  });
  return { ...context, evalCase, run };
}

function appendInput(input: {
  runId: string;
  caseId: string;
  passed?: boolean;
  outputHash?: string;
  fixtureDigest?: string;
  caseContract?: ContinuousEvaluationCaseContract;
  metrics?: Partial<{
    disposition: "completed" | "abstained" | "safe_failure";
    retrievalNdcgAtK: number | null;
    unsupportedMaterialClaimCount: number;
    injectionContained: boolean;
    tenantLeakDetected: boolean;
    calibratedConfidence: number | null;
  }>;
  reviewerUserId?: string;
}) {
  return {
    organisationId: ORG,
    projectId: PROJECT,
    runId: input.runId,
    caseId: input.caseId,
    fixtureDigest: input.fixtureDigest ?? FIXTURE_DIGEST,
    caseContract: input.caseContract ?? contract,
    passed: input.passed ?? true,
    metrics: {
      disposition: "completed" as const,
      relevantChunkCount: 2,
      retrievedRelevantChunkCount: 2,
      retrievalNdcgAtK: 1,
      materialClaimCount: 2,
      citedMaterialClaimCount: 2,
      citationEvaluatedCount: 2,
      citationCorrectCount: 2,
      unsupportedMaterialClaimCount: 0,
      injectionContained: true,
      tenantLeakDetected: false,
      calibratedConfidence: 0.9,
      latencyMs: 200,
      costMinor: 50,
      ...input.metrics,
    },
    outputHash: input.outputHash ?? OUTPUT_HASH,
    reviewer: {
      reviewerUserId: input.reviewerUserId ?? REVIEWER,
      outcome: "confirmed" as const,
      humanCorrect: true,
      reasonCodes: ["grounding_correct" as const],
    },
  };
}

async function createProductionRun(input?: { tenantLeakIndex?: number }) {
  const context = setup();
  const draft = await context.store.createRun({
    organisationId: ORG,
    projectId: PROJECT,
    task: "map_evidence",
    corpusVersion: "corpus-1",
    modelConfigurationId: MODEL_CONFIG,
    promptConfigurationId: PROMPT_CONFIG,
    expectedVersions: versions,
    profileVersion: PRODUCTION_CONTINUOUS_EVAL_PROFILE_VERSION,
    cohorts: [...REQUIRED_CONTINUOUS_EVAL_COHORTS],
  });
  const run = await context.store.startRun({
    organisationId: ORG,
    projectId: PROJECT,
    runId: draft.id,
  });
  for (let index = 0; index < 25; index += 1) {
    const fixtureDigest = hash(`production-fixture-${index}`);
    const evalCase = await context.store.createCase({
      organisationId: ORG,
      projectId: PROJECT,
      corpusVersion: "corpus-1",
      split: "holdout",
      task: "map_evidence",
      fixtureDigest,
      contract: productionContract,
    });
    const tenantLeakDetected = index === input?.tenantLeakIndex;
    await context.store.appendResult(
      appendInput({
        runId: run.id,
        caseId: evalCase.id,
        fixtureDigest,
        caseContract: productionContract,
        passed: !tenantLeakDetected,
        metrics: { calibratedConfidence: 1, tenantLeakDetected },
      }),
    );
  }
  return { ...context, run };
}

test("case identity is deterministic, version-bound, and idempotent", async () => {
  const { store, caseInput } = setup();
  const reordered: ContinuousEvaluationCreateCaseInput = {
    ...caseInput,
    contract: {
      ...caseInput.contract,
      cohorts: ["tenant_isolation", "representative"],
    },
  };
  const reverse = {
    ...reordered,
    contract: {
      ...reordered.contract,
      cohorts: [...reordered.contract.cohorts].reverse(),
    },
  };
  assert.equal(
    continuousEvaluationCaseLabelHash(reordered),
    continuousEvaluationCaseLabelHash(reverse),
  );
  const first = await store.createCase(caseInput);
  const duplicate = await store.createCase(caseInput);
  assert.equal(duplicate.id, first.id);
  await assert.rejects(
    store.createCase({
      ...caseInput,
      contract: { ...caseInput.contract, fatalLabelCount: 2 },
    }),
    (error) => storeErrorCode(error) === "result_conflict",
  );
});

test("production-eligible cases require adjudication and version placeholders fail", async () => {
  const { store, caseInput } = setup();
  await assert.rejects(
    store.createCase({
      ...caseInput,
      contract: { ...contract, productionEligible: true },
    }),
    (error) => storeErrorCode(error) === "invalid_evaluation_input",
  );
  await assert.rejects(
    store.createRun({
      organisationId: ORG,
      projectId: PROJECT,
      task: "map_evidence",
      corpusVersion: "corpus-1",
      modelConfigurationId: MODEL_CONFIG,
      promptConfigurationId: PROMPT_CONFIG,
      expectedVersions: { ...versions, retrieval: "unknown" },
      profileVersion: "production-profile-1",
      cohorts: ["representative"],
    }),
    (error) => storeErrorCode(error) === "invalid_evaluation_input",
  );
  const createInput = {
    organisationId: ORG,
    projectId: PROJECT,
    task: "map_evidence" as const,
    corpusVersion: "corpus-1",
    modelConfigurationId: MODEL_CONFIG,
    promptConfigurationId: PROMPT_CONFIG,
    profileVersion: "production-profile-1",
    cohorts: ["representative" as const],
  };
  const { policy: _missing, ...missingVersion } = versions;
  void _missing;
  await assert.rejects(
    store.createRun({
      ...createInput,
      expectedVersions: missingVersion,
    } as unknown as Parameters<typeof store.createRun>[0]),
    (error) => storeErrorCode(error) === "invalid_evaluation_input",
  );
  await assert.rejects(
    store.createRun({
      ...createInput,
      expectedVersions: { ...versions, attackerControlled: "v1" },
    } as Parameters<typeof store.createRun>[0]),
    (error) => storeErrorCode(error) === "invalid_evaluation_input",
  );
});

test("run creation cannot accept caller-controlled release approval", async () => {
  const { store, repository } = setup();
  const run = await store.createRun({
    organisationId: ORG,
    projectId: PROJECT,
    task: "map_evidence",
    corpusVersion: "corpus-1",
    modelConfigurationId: MODEL_CONFIG,
    promptConfigurationId: PROMPT_CONFIG,
    expectedVersions: versions,
    profileVersion: "production-profile-1",
    cohorts: ["representative"],
    releaseDecision: "approved",
  } as Parameters<typeof store.createRun>[0] & { releaseDecision: string });
  assert.equal(run.status, "draft");
  assert.equal(run.releaseDecision, "pending");
  assert.equal(repository.runs.get(run.id)?.releaseDecision, "pending");
  assert.equal(
    CONTINUOUS_EVALUATION_STORE_STATUS.productionActivationGranted,
    false,
  );
});

test("append requires a started run and captures a structured reviewer observation", async () => {
  const context = setup();
  const evalCase = await context.store.createCase(context.caseInput);
  const draft = await context.createRun();
  await assert.rejects(
    context.store.appendResult(
      appendInput({ runId: draft.id, caseId: evalCase.id }),
    ),
    (error) => storeErrorCode(error) === "invalid_transition",
  );
  const run = await context.store.startRun({
    organisationId: ORG,
    projectId: PROJECT,
    runId: draft.id,
  });
  const appended = await context.store.appendResult(
    appendInput({ runId: run.id, caseId: evalCase.id }),
  );
  assert.equal(appended.inserted, true);
  assert.equal(appended.review?.reviewType, "ai_evaluation_observation");
  assert.equal(appended.review?.status, "completed");
  assert.match(
    appended.result.resultMetrics,
    /"expectedDisposition":"completed"/,
  );
  assert.match(appended.result.resultMetrics, /"retrievalNdcgAtK":1/);
  assert.match(appended.result.resultMetrics, new RegExp(REVIEWER));
  assert.doesNotMatch(appended.result.resultMetrics, /@|customer|tender/i);
});

test("an identical result is idempotent while a conflicting duplicate fails", async () => {
  const { store, repository, evalCase, run } = await createStartedRun();
  const first = await store.appendResult(
    appendInput({ runId: run.id, caseId: evalCase.id }),
  );
  const duplicate = await store.appendResult(
    appendInput({ runId: run.id, caseId: evalCase.id }),
  );
  assert.equal(duplicate.result.id, first.result.id);
  assert.equal(duplicate.inserted, false);
  assert.equal(repository.runs.get(run.id)?.sampleSize, 1);
  await assert.rejects(
    store.appendResult(
      appendInput({ runId: run.id, caseId: evalCase.id, passed: false }),
    ),
    (error) => storeErrorCode(error) === "invalid_evaluation_input",
  );
  await assert.rejects(
    store.appendResult(
      appendInput({
        runId: run.id,
        caseId: evalCase.id,
        reviewerUserId: "66666666-6666-4666-8666-666666666666",
      }),
    ),
    (error) => storeErrorCode(error) === "result_conflict",
  );
});

test("case contract drift and cross-project access fail closed", async () => {
  const { store, evalCase, run } = await createStartedRun();
  await assert.rejects(
    store.appendResult({
      ...appendInput({ runId: run.id, caseId: evalCase.id }),
      caseContract: { ...contract, likelyFatalLabelCount: 1 },
    }),
    (error) => storeErrorCode(error) === "version_mismatch",
  );
  await assert.rejects(
    store.appendResult({
      ...appendInput({ runId: run.id, caseId: evalCase.id }),
      projectId: OTHER_PROJECT,
    }),
    (error) => storeErrorCode(error) === "not_found_or_not_authorized",
  );
});

test("concurrent result appends use sample-size CAS and the run is capped", async () => {
  const { store, repository, caseInput, evalCase, run } =
    await createStartedRun();
  const secondDigest = hash("fixture-2");
  const secondCase = await store.createCase({
    ...caseInput,
    fixtureDigest: secondDigest,
  });
  const outcomes = await Promise.allSettled([
    store.appendResult(appendInput({ runId: run.id, caseId: evalCase.id })),
    store.appendResult(
      appendInput({
        runId: run.id,
        caseId: secondCase.id,
        fixtureDigest: secondDigest,
      }),
    ),
  ]);
  assert.equal(
    outcomes.filter((outcome) => outcome.status === "fulfilled").length,
    1,
  );
  const rejected = outcomes.find(
    (outcome): outcome is PromiseRejectedResult =>
      outcome.status === "rejected",
  );
  assert.equal(storeErrorCode(rejected?.reason), "persistence_conflict");
  assert.equal(repository.runs.get(run.id)?.sampleSize, 1);

  const active = repository.runs.get(run.id)!;
  repository.runs.set(run.id, { ...active, sampleSize: 100_000 });
  await assert.rejects(
    store.appendResult(
      appendInput({
        runId: run.id,
        caseId: secondCase.id,
        fixtureDigest: secondDigest,
      }),
    ),
    (error) => storeErrorCode(error) === "invalid_transition",
  );
});

test("completion derives metrics and a partial diagnostic run cannot pass", async () => {
  const { store, repository, evalCase, run } = await createStartedRun();
  await store.appendResult(appendInput({ runId: run.id, caseId: evalCase.id }));
  const completed = await store.completeRun({
    organisationId: ORG,
    projectId: PROJECT,
    runId: run.id,
    limitations: ["synthetic_only"],
  });
  assert.equal(completed.run.status, "completed");
  assert.equal(completed.run.releaseDecision, "pending");
  assert.equal(completed.releaseDecision, "pending");
  assert.equal(completed.productionActivationGranted, false);
  assert.equal(completed.evaluationPassed, false);
  assert.match(completed.run.metrics ?? "", /"representative"/);
  assert.match(completed.run.metrics ?? "", /"caseCount":1/);
  assert.equal(repository.runs.get(run.id)?.releaseDecision, "pending");
  await assert.rejects(
    store.completeRun({
      organisationId: ORG,
      projectId: PROJECT,
      runId: run.id,
      limitations: [],
    }),
    (error) => storeErrorCode(error) === "completed_run_immutable",
  );
  await assert.rejects(
    store.appendResult(appendInput({ runId: run.id, caseId: evalCase.id })),
    (error) => storeErrorCode(error) === "completed_run_immutable",
  );
});

test("a stored tenant leak cannot be laundered by a caller summary", async () => {
  const { store, run } = await createProductionRun({ tenantLeakIndex: 0 });
  const completed = await store.completeRun({
    organisationId: ORG,
    projectId: PROJECT,
    runId: run.id,
    limitations: [],
    summary: { tenantLeaks: 0, passRate: 1 },
  } as Parameters<typeof store.completeRun>[0] & {
    summary: { tenantLeaks: number; passRate: number };
  });
  assert.equal(completed.evaluationPassed, false);
  assert.match(completed.run.metrics ?? "", /"tenantLeaks":1/);
  assert.equal(completed.productionActivationGranted, false);
  assert.equal(completed.releaseDecision, "pending");
});

test("completion fails closed on persisted sample drift and a CAS race", async () => {
  const { store, repository, evalCase, run } = await createStartedRun();
  await store.appendResult(appendInput({ runId: run.id, caseId: evalCase.id }));
  repository.results.clear();
  await assert.rejects(
    store.completeRun({
      organisationId: ORG,
      projectId: PROJECT,
      runId: run.id,
      limitations: [],
    }),
    (error) => storeErrorCode(error) === "persistence_conflict",
  );

  const second = await createStartedRun();
  await second.store.appendResult(
    appendInput({ runId: second.run.id, caseId: second.evalCase.id }),
  );
  second.repository.forceCompletionCasConflict = true;
  await assert.rejects(
    second.store.completeRun({
      organisationId: ORG,
      projectId: PROJECT,
      runId: second.run.id,
      limitations: [],
    }),
    (error) => storeErrorCode(error) === "persistence_conflict",
  );
});

test("only a complete immutable production profile can pass", async () => {
  const { store, run } = await createProductionRun();
  const completed = await store.completeRun({
    organisationId: ORG,
    projectId: PROJECT,
    runId: run.id,
    limitations: [],
  });
  assert.equal(completed.evaluationPassed, true);
  assert.equal(completed.releaseDecision, "pending");
  assert.equal(completed.productionActivationGranted, false);
});

test("abort is terminal evidence with a safe error and pending release", async () => {
  const { store, createRun } = setup();
  const draft = await createRun();
  const failed = await store.abortRun({
    organisationId: ORG,
    projectId: PROJECT,
    runId: draft.id,
    errorCode: "AI_PROVIDER_UNAVAILABLE",
  });
  assert.equal(failed.status, "failed");
  assert.equal(failed.releaseDecision, "pending");
  assert.match(failed.limitations ?? "", /AI_PROVIDER_UNAVAILABLE/);
  await assert.rejects(
    store.startRun({
      organisationId: ORG,
      projectId: PROJECT,
      runId: draft.id,
    }),
    (error) => storeErrorCode(error) === "invalid_transition",
  );
});
