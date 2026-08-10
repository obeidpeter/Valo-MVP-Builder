/**
 * Manifest-backed evaluation runner.
 *
 * Default profile: gate0_non_production. Production must be requested
 * explicitly and fails before any provider call unless the authorised corpus
 * contract is complete. This historical runner is now offline-only and never
 * presents matcher self-checks as live model-quality evidence. Production
 * evidence belongs to the controlled shadow/evaluation runner still to be
 * implemented.
 */
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  copyFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  aggregateReport,
  computeTenderRecall,
  normalizeText,
  requirementMatched,
  validateCorpusManifest,
  evaluateReportAgainstProfile,
  GATE0_NON_PRODUCTION_PROFILE,
  PRODUCTION_EVAL_PROFILE,
  type EvalGateProfile,
  type EvalModelOutput,
  type EvalReport,
  type EvalTender,
  type TenderRecall,
} from "../src/lib/evalHarness";
import { CORPUS } from "./eval-corpus/corpus";
import { CURRENT_CORPUS_MANIFEST } from "./eval-corpus/manifest";

const RUNS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "eval-corpus",
  "runs",
);
const LATEST_PATH = join(RUNS_DIR, "latest.json");
const BASELINE_PATH = join(RUNS_DIR, "baseline.json");
const MAX_BASELINE_DROP = 0.02;

interface RecordedRun {
  recordedAt: string;
  live: boolean;
  profileName: EvalGateProfile["name"];
  corpusManifestVersion: string;
  model: string;
  promptVersion: string;
  schemaVersion: string;
  retrievalVersion: string;
  indexVersion: string;
  target: number;
  outputs?: Record<string, EvalModelOutput>;
  /** Backward-compatible read only; new runs use structured outputs. */
  extractedTexts?: Record<string, string[]>;
  report: EvalReport;
}

let passes = 0;
let failures = 0;

function check(label: string, ok: boolean, detail?: string): boolean {
  if (ok) {
    passes += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
  return ok;
}

const pct = (value: number | null): string =>
  value === null ? "not measured" : `${(value * 100).toFixed(1)}%`;

function resolveProfile(): EvalGateProfile {
  const profileArgument = process.argv.find((argument) =>
    argument.startsWith("--profile="),
  );
  const requested =
    profileArgument?.slice("--profile=".length) ?? process.env.EVAL_PROFILE;
  if (
    !requested ||
    requested === "gate0" ||
    requested === "gate0_non_production"
  ) {
    const rawTarget = process.env.EVAL_RECALL_TARGET;
    if (!rawTarget) return GATE0_NON_PRODUCTION_PROFILE;
    const parsed = Number(rawTarget);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) {
      throw new Error(`Invalid Gate-0 EVAL_RECALL_TARGET=${rawTarget}`);
    }
    return {
      ...GATE0_NON_PRODUCTION_PROFILE,
      minimumOverallRecall: parsed,
      minimumMandatoryRecall: parsed,
    };
  }
  if (requested === "production") {
    if (process.env.EVAL_RECALL_TARGET) {
      throw new Error(
        "Production thresholds are pinned and cannot be overridden by EVAL_RECALL_TARGET",
      );
    }
    return PRODUCTION_EVAL_PROFILE;
  }
  throw new Error(`Unknown evaluation profile: ${requested}`);
}

function syntheticExtraction(tender: EvalTender): string[] {
  return tender.groundTruth.map(
    (requirement) =>
      `${requirement.label} ${requirement.match
        .map((group) => group[0])
        .join(" ")}`,
  );
}

function selfCheck(profile: EvalGateProfile): void {
  console.log(
    `=== OFFLINE corpus/matcher check: ${CORPUS.length} repository fixtures ===`,
  );
  const nonProductionManifest = validateCorpusManifest(
    CORPUS,
    CURRENT_CORPUS_MANIFEST,
    GATE0_NON_PRODUCTION_PROFILE,
  );
  check(
    "synthetic manifest is internally consistent for non-production self-check",
    nonProductionManifest.passed,
    nonProductionManifest.problems.join("; "),
  );

  for (const tender of CORPUS) {
    const perfect = computeTenderRecall(tender, syntheticExtraction(tender));
    check(
      `${tender.id}: matcher recalls a label-derived synthetic extraction`,
      perfect.recall === 1,
      `missed ${perfect.missed.map((missed) => missed.id).join(", ")}`,
    );
  }
  const noise = ["The quick brown fox jumps over the lazy dog."];
  const spurious = CORPUS[0]?.groundTruth.filter((requirement) =>
    requirementMatched(requirement, noise.map(normalizeText)),
  );
  check("unrelated text recalls no requirement", (spurious?.length ?? 0) === 0);

  if (profile.production) {
    const productionManifest = validateCorpusManifest(
      CORPUS,
      CURRENT_CORPUS_MANIFEST,
      profile,
    );
    check(
      "production corpus manifest is authorised, representative and holdout-only",
      productionManifest.passed,
      productionManifest.problems.join("; "),
    );
  } else {
    console.log(
      "  (Gate-0 profile is non-production; these checks do not measure model quality.)",
    );
  }
}

function logTender(result: TenderRecall): void {
  console.log(
    `  ${result.tenderId}: recall ${pct(result.recall)}, mandatory ${pct(
      result.mandatoryRecall,
    )}, precision ${pct(result.precision)}, citations ${result.citationCorrect}/${
      result.citationEvaluated
    }`,
  );
  for (const missed of result.missed) {
    console.log(
      `      MISSED [${missed.severity ?? (missed.mandatory ? "mandatory" : "desirable")}] ${missed.label}`,
    );
  }
}

function outputFor(run: RecordedRun, tenderId: string): EvalModelOutput | null {
  const structured = run.outputs?.[tenderId];
  if (structured) return structured;
  const legacy = run.extractedTexts?.[tenderId];
  return legacy
    ? {
        disposition: "completed",
        requirements: legacy.map((text) => ({ text })),
      }
    : null;
}

function recomputeFromStored(run: RecordedRun): EvalReport {
  const perTender = CORPUS.flatMap((tender) => {
    const output = outputFor(run, tender.id);
    return output ? [computeTenderRecall(tender, output)] : [];
  });
  return aggregateReport(perTender, run.target);
}

function enforceGates(
  run: RecordedRun,
  recomputed: EvalReport,
  profile: EvalGateProfile,
): void {
  console.log("\n=== Evaluation gates ===");
  check(
    "recorded report is reproducible from stored structured outputs",
    Math.abs(recomputed.overallRecall - run.report.overallRecall) < 1e-9 &&
      recomputed.totalMatched === run.report.totalMatched &&
      recomputed.fatalMisses === run.report.fatalMisses,
  );
  check(
    `recorded run profile matches ${profile.name}`,
    run.profileName === profile.name,
    `recorded ${run.profileName}`,
  );
  check(
    "recorded run uses the current corpus manifest",
    run.corpusManifestVersion === CURRENT_CORPUS_MANIFEST.corpusVersion,
    `recorded ${run.corpusManifestVersion}`,
  );
  if (profile.production) {
    check("production evidence is a live model run", run.live === true);
  }

  const gate = evaluateReportAgainstProfile(recomputed, profile);
  for (const failure of gate.failures) {
    console.log(
      `      ${failure.metric}: ${failure.actual ?? "not measured"}; required ${failure.expected}`,
    );
  }
  check(
    `${profile.name} metric thresholds pass`,
    gate.passed,
    `${gate.failures.length} failed metric(s)`,
  );

  if (existsSync(BASELINE_PATH)) {
    const baseline = JSON.parse(
      readFileSync(BASELINE_PATH, "utf-8"),
    ) as RecordedRun;
    const drop = baseline.report.mandatoryRecall - recomputed.mandatoryRecall;
    check(
      `mandatory-recall drop versus baseline <= ${pct(MAX_BASELINE_DROP)}`,
      drop <= MAX_BASELINE_DROP,
      `${pct(baseline.report.mandatoryRecall)} -> ${pct(recomputed.mandatoryRecall)}`,
    );
  }
}

async function livePass(profile: EvalGateProfile): Promise<void> {
  const manifest = validateCorpusManifest(
    CORPUS,
    CURRENT_CORPUS_MANIFEST,
    profile,
  );
  if (!manifest.passed) {
    throw new Error(
      `Corpus is ineligible for ${profile.name}: ${manifest.problems.join("; ")}`,
    );
  }

  console.log(`\n=== LIVE model pass (${profile.name}) ===`);
  const { extractRequirements } = await import("../src/lib/llm");
  const projectId = "00000000-0000-0000-0000-000000000000";
  const outputs: Record<string, EvalModelOutput> = {};
  const perTender: TenderRecall[] = [];

  for (const tender of CORPUS) {
    const { requirements } = await extractRequirements(projectId, [
      {
        id: `${tender.id}-doc`,
        filename: `${tender.id}.txt`,
        type: "tender",
        contentText: tender.documentText,
      },
    ]);
    const output: EvalModelOutput = {
      disposition: "completed",
      requirements: requirements.map((requirement) => ({
        text: requirement.text,
        // A model-supplied locator is not independent citation verification.
        citationVerdict: "unverified",
      })),
    };
    outputs[tender.id] = output;
    const result = computeTenderRecall(tender, output);
    perTender.push(result);
    logTender(result);
  }

  const report = aggregateReport(perTender, profile.minimumOverallRecall);
  const { PROMPT_PACK_VERSION, MODEL_ID } =
    await import("../src/lib/provenance");
  const run: RecordedRun = {
    recordedAt: new Date().toISOString(),
    live: true,
    profileName: profile.name,
    corpusManifestVersion: CURRENT_CORPUS_MANIFEST.corpusVersion,
    model: MODEL_ID,
    promptVersion: PROMPT_PACK_VERSION,
    schemaVersion: "legacy-sanitizer-v1",
    retrievalVersion: "not_implemented",
    indexVersion: "not_implemented",
    target: profile.minimumOverallRecall,
    outputs,
    report,
  };
  mkdirSync(RUNS_DIR, { recursive: true });
  writeFileSync(LATEST_PATH, `${JSON.stringify(run, null, 2)}\n`);
  console.log(`\nRecorded run -> ${LATEST_PATH}`);
  enforceGates(run, recomputeFromStored(run), profile);
}

async function main(): Promise<void> {
  const offline = process.argv.includes("--offline");
  const promote = process.argv.includes("--promote-baseline");
  const profile = resolveProfile();

  if (!offline || promote) {
    throw new Error(
      "The legacy live/baseline path is retired. Use --offline for compatibility checks; production evidence requires the controlled shadow/evaluation runner described in docs/ai-overhaul.",
    );
  }

  console.log(
    `${offline ? "OFFLINE" : "LIVE"} evaluation mode; profile=${profile.name}.\n`,
  );
  selfCheck(profile);

  if (promote) {
    if (!existsSync(LATEST_PATH)) {
      check("a recorded live run exists for baseline promotion", false);
    } else {
      const run = JSON.parse(readFileSync(LATEST_PATH, "utf-8")) as RecordedRun;
      const report = recomputeFromStored(run);
      enforceGates(run, report, profile);
      if (failures === 0) {
        copyFileSync(LATEST_PATH, BASELINE_PATH);
        console.log(`Promoted ${LATEST_PATH} -> ${BASELINE_PATH}`);
      }
    }
  } else if (offline) {
    if (existsSync(LATEST_PATH)) {
      const run = JSON.parse(readFileSync(LATEST_PATH, "utf-8")) as RecordedRun;
      enforceGates(run, recomputeFromStored(run), profile);
    } else if (profile.production) {
      check("a live production-profile evaluation run exists", false);
    } else {
      console.log(
        "\n(no live run recorded; Gate-0 self-check passes are not production evidence)",
      );
    }
  } else {
    await livePass(profile);
  }

  console.log("\n---------------------------------------------");
  console.log(`RESULT: ${passes} passed, ${failures} failed`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error("\nEVAL HARNESS ERROR:", error);
  process.exitCode = 1;
});
