/**
 * Eval harness v0 runner (FR-EXT-05 / FR-EXT-04 / NFR-QLT-02).
 *
 * Measures the extraction ENGINE against the fixed, hand-labelled corpus in
 * scripts/eval-corpus/corpus.ts using the pure matcher in
 * src/lib/evalHarness.ts (AND-of-ORs specs, unit-tested). Unlike the
 * production scorecard — which measures the engine against live reviews —
 * this is a regression suite: it fails loudly when a prompt or model change
 * silently drops requirements.
 *
 * Run modes:
 *   (default, LIVE)   Self-check PLUS a live pass over every tender (needs
 *                     the model key; run in the deploy environment, not CI).
 *                     Records the run — the engine's extracted texts and the
 *                     scored report — to eval-corpus/runs/latest.json, then
 *                     enforces the gates.
 *   --offline         (CI mode) Self-check: corpus well-formed, matcher
 *                     consistent (synthetic faithful extraction recalls
 *                     100%), no false matches. Then, if a recorded live run
 *                     exists, independently RECOMPUTES its figures from the
 *                     stored extracted texts (FR-EXT-04 reproducibility) and
 *                     enforces the recall + baseline-drift gates on them.
 *   --promote-baseline  Copies runs/latest.json to runs/baseline.json — do
 *                     this deliberately, in a reviewed commit.
 *
 * Gates:
 *   - cumulative MANDATORY recall >= target (default 0.85, the Gate 0 bar;
 *     override with EVAL_RECALL_TARGET, e.g. 0.95 for the v1.0 bar);
 *   - mandatory recall must not drop more than 2 points below the recorded
 *     baseline (NFR-QLT-02).
 *
 * Corpus rule: labels are never edited to make a run pass.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  aggregateReport,
  computeTenderRecall,
  normalizeText,
  requirementMatched,
  validateCorpus,
  EVAL_RECALL_TARGET_V0,
  type EvalReport,
  type EvalTender,
  type TenderRecall,
} from "../src/lib/evalHarness";
import { CORPUS } from "./eval-corpus/corpus";

const RUNS_DIR = join(dirname(fileURLToPath(import.meta.url)), "eval-corpus", "runs");
const LATEST_PATH = join(RUNS_DIR, "latest.json");
const BASELINE_PATH = join(RUNS_DIR, "baseline.json");
const MAX_BASELINE_DROP = 0.02;

interface RecordedRun {
  recordedAt: string;
  model: string;
  promptVersion: string;
  target: number;
  /** The engine's raw extracted requirement texts, per tender id. */
  extractedTexts: Record<string, string[]>;
  report: EvalReport;
}

let passes = 0;
let failures = 0;
function check(label: string, ok: boolean, detail?: string): boolean {
  if (ok) {
    passes++;
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
  return ok;
}

function resolveTarget(): number {
  const raw = process.env.EVAL_RECALL_TARGET;
  if (!raw) return EVAL_RECALL_TARGET_V0;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) {
    console.warn(`(ignoring invalid EVAL_RECALL_TARGET=${raw}; using ${EVAL_RECALL_TARGET_V0})`);
    return EVAL_RECALL_TARGET_V0;
  }
  return parsed;
}

const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;

/**
 * A faithful engine, at minimum, echoes the label plus the first alternative
 * of every match group. Feeding that through the matcher must recall 100% — if
 * it doesn't, the corpus and matcher disagree (a labelling bug), which the
 * offline self-check catches before any model call is wasted.
 */
function syntheticExtraction(tender: EvalTender): string[] {
  return tender.groundTruth.map(
    (g) => `${g.label} ${g.match.map((group) => group[0]).join(" ")}`,
  );
}

function selfCheck(): void {
  console.log(`=== OFFLINE self-check: ${CORPUS.length} hand-labelled tenders ===`);
  const problems = validateCorpus(CORPUS);
  check(
    `corpus is well-formed (>= 10 tenders, verified ground truth)`,
    problems.length === 0,
    problems.join("; "),
  );

  for (const tender of CORPUS) {
    const perfect = computeTenderRecall(tender, syntheticExtraction(tender));
    check(
      `${tender.id}: synthetic faithful extraction recalls 100% (matcher consistent)`,
      perfect.recall === 1,
      perfect.recall === 1 ? undefined : `missed ${perfect.missed.map((m) => m.id).join(", ")}`,
    );
  }
  // Negative control: unrelated text must recall nothing.
  const noise = ["The quick brown fox jumps over the lazy dog."];
  const spurious = CORPUS[0].groundTruth.filter((g) =>
    requirementMatched(g, noise.map(normalizeText)),
  );
  check("unrelated text recalls no requirement (no false matches)", spurious.length === 0);
}

function logTender(result: TenderRecall): void {
  const line =
    `${result.tenderId}: recall ${pct(result.recall)} (${result.matched}/${result.total}), ` +
    `mandatory ${pct(result.mandatoryRecall)} (${result.mandatoryMatched}/${result.mandatoryTotal})`;
  if (result.missed.length > 0) {
    console.log(`  ✗ ${line}`);
    for (const m of result.missed) {
      console.log(`      MISSED [${m.mandatory ? "mandatory" : "desirable"}] ${m.label}`);
    }
  } else {
    console.log(`  ✓ ${line}`);
  }
}

function recomputeFromStored(run: RecordedRun): EvalReport {
  const perTender = CORPUS.filter((t) => run.extractedTexts[t.id]).map((t) =>
    computeTenderRecall(t, run.extractedTexts[t.id]),
  );
  return aggregateReport(perTender, run.target);
}

function enforceGates(run: RecordedRun, recomputed: EvalReport): void {
  console.log("\n=== Gates ===");
  check(
    "recorded figures reproducible from stored extracted texts (FR-EXT-04)",
    Math.abs(recomputed.mandatoryRecall - run.report.mandatoryRecall) < 1e-9 &&
      recomputed.totalMatched === run.report.totalMatched,
    `recorded ${pct(run.report.mandatoryRecall)} vs recomputed ${pct(recomputed.mandatoryRecall)}`,
  );
  check(
    `cumulative MANDATORY recall >= ${pct(run.target)} (FR-EXT-05)`,
    recomputed.mandatoryPassed,
    pct(recomputed.mandatoryRecall),
  );
  console.log(
    `  (overall recall ${pct(recomputed.overallRecall)} — ` +
      `${recomputed.totalMatched}/${recomputed.totalGroundTruth} incl. desirable rows)`,
  );
  if (existsSync(BASELINE_PATH)) {
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf-8")) as RecordedRun;
    const drop = baseline.report.mandatoryRecall - recomputed.mandatoryRecall;
    check(
      `mandatory-recall drop vs baseline <= ${pct(MAX_BASELINE_DROP)} (NFR-QLT-02)`,
      drop <= MAX_BASELINE_DROP,
      `baseline ${pct(baseline.report.mandatoryRecall)} -> ${pct(recomputed.mandatoryRecall)}`,
    );
  } else {
    console.log("  (no baseline.json yet — record one with eval:promote-baseline after a good live run)");
  }
}

async function livePass(target: number): Promise<void> {
  console.log(`\n=== LIVE recall pass (real engine over ${CORPUS.length} tenders) ===`);
  console.log(`Target mandatory recall: ${pct(target)}\n`);
  const { extractRequirements } = await import("../src/lib/llm");
  const projectId = "00000000-0000-0000-0000-000000000000";

  const extractedTexts: Record<string, string[]> = {};
  const perTender: TenderRecall[] = [];
  for (const tender of CORPUS) {
    const { requirements } = await extractRequirements(projectId, [
      { id: `${tender.id}-doc`, filename: `${tender.id}.txt`, type: "tender", contentText: tender.documentText },
    ]);
    extractedTexts[tender.id] = requirements.map((r) => r.text);
    const result = computeTenderRecall(tender, extractedTexts[tender.id]);
    perTender.push(result);
    logTender(result);
  }

  const report = aggregateReport(perTender, target);
  const { PROMPT_PACK_VERSION, MODEL_ID } = await import("../src/lib/provenance");
  const run: RecordedRun = {
    recordedAt: new Date().toISOString(),
    model: MODEL_ID,
    promptVersion: PROMPT_PACK_VERSION,
    target,
    extractedTexts,
    report,
  };
  mkdirSync(RUNS_DIR, { recursive: true });
  writeFileSync(LATEST_PATH, JSON.stringify(run, null, 2) + "\n");
  console.log(`\nRecorded run -> ${LATEST_PATH}`);
  console.log(
    `Mandatory recall: ${pct(report.mandatoryRecall)} (${report.mandatoryMatched}/${report.mandatoryGroundTruth}); ` +
      `overall ${pct(report.overallRecall)}`,
  );
  enforceGates(run, recomputeFromStored(run));
}

async function main(): Promise<void> {
  const offline = process.argv.includes("--offline");
  const promote = process.argv.includes("--promote-baseline");
  const target = resolveTarget();

  if (promote) {
    if (!existsSync(LATEST_PATH)) {
      console.error("No recorded run to promote — run the live harness first.");
      process.exit(1);
    }
    copyFileSync(LATEST_PATH, BASELINE_PATH);
    console.log(`Promoted ${LATEST_PATH} -> ${BASELINE_PATH}`);
    return;
  }

  console.log(
    offline
      ? "Running OFFLINE eval-harness checks (self-check + recorded-run gates).\n"
      : "Running FULL eval harness (self-check + live engine recall).\n",
  );

  selfCheck();
  if (offline) {
    if (existsSync(LATEST_PATH)) {
      const run = JSON.parse(readFileSync(LATEST_PATH, "utf-8")) as RecordedRun;
      console.log(`\nRecorded live run found (${run.recordedAt}, model ${run.model}, prompts ${run.promptVersion}).`);
      enforceGates(run, recomputeFromStored(run));
    } else {
      console.log(
        "\n(no recorded live run yet — run `pnpm --filter @workspace/api-server eval:harness` in the deploy " +
          "environment and commit eval-corpus/runs/latest.json to activate the recall gates)",
      );
    }
  } else {
    await livePass(target);
  }

  console.log(`\n---------------------------------------------`);
  console.log(`RESULT: ${passes} passed, ${failures} failed`);
  if (failures > 0) process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\nEVAL HARNESS ERROR:", err);
    process.exit(1);
  });
