/**
 * Eval harness v0 runner (FR-EXT-05 / NFR-QLT-02).
 *
 * Modes:
 *   (default, LIVE)   Runs every labelled case through the real
 *                     extractRequirements pipeline (needs OPENAI_API_KEY +
 *                     DATABASE_URL — run in the deploy environment), scores
 *                     recall against the hand-labelled ground truth, and
 *                     records the run (engine outputs + figures) to
 *                     eval-harness/runs/latest.json. Fails when cumulative
 *                     mandatory recall < 85% (Gate 0 threshold) or when it
 *                     drops > 2 points below the recorded baseline.
 *   --offline         (CI mode) No model, no DB. Validates the corpus,
 *                     self-tests the scorer against synthetic outputs with
 *                     known recall, then — if a recorded live run exists —
 *                     independently RECOMPUTES its figures from the stored
 *                     engine outputs (FR-EXT-04 reproducibility) and enforces
 *                     the threshold + baseline-drift gates on them.
 *   --promote-baseline  Copies the latest recorded run to baseline.json
 *                     (do this deliberately, in a reviewed commit).
 *
 * The corpus rule: labels are never edited to make a run pass.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { EVAL_CASES } from "./eval-harness/cases";
import {
  scoreCase,
  cumulative,
  type DocScore,
  type EngineItem,
  type CumulativeScore,
} from "./eval-harness/scoring";

const HARNESS_DIR = join(dirname(fileURLToPath(import.meta.url)), "eval-harness");
const RUNS_DIR = join(HARNESS_DIR, "runs");
const LATEST_PATH = join(RUNS_DIR, "latest.json");
const BASELINE_PATH = join(RUNS_DIR, "baseline.json");

const GATE0_THRESHOLD = 0.85;
const MAX_BASELINE_DROP = 0.02;

interface RecordedRun {
  recordedAt: string;
  model: string;
  promptVersion: string;
  engineOutputs: Record<string, EngineItem[]>;
  perDoc: DocScore[];
  cumulative: CumulativeScore;
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

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

function validateCorpus(): void {
  console.log(`=== Corpus validation: ${EVAL_CASES.length} labelled tenders ===`);
  check(`corpus has >= 10 labelled documents (FR-EXT-05)`, EVAL_CASES.length >= 10, `${EVAL_CASES.length}`);
  const ids = new Set(EVAL_CASES.map((c) => c.id));
  check("case ids unique", ids.size === EVAL_CASES.length);
  for (const c of EVAL_CASES) {
    const mandatory = c.labelled.filter((l) => l.isMandatory).length;
    check(`${c.id}: >= 5 labels incl. >= 4 mandatory`, c.labelled.length >= 5 && mandatory >= 4);
    check(`${c.id}: document text is substantial`, c.documentText.length > 400);
  }
}

function scorerSelfTest(): void {
  console.log("\n=== Scorer self-test (known-recall synthetic outputs) ===");
  const testCase = EVAL_CASES[0];
  const mandatoryLabels = testCase.labelled.filter((l) => l.isMandatory);

  // Perfect engine: verbatim copies of every label -> recall 1.0.
  const perfect = testCase.labelled.map((l) => ({ text: l.text, isMandatory: l.isMandatory }));
  const perfectScore = scoreCase(testCase, perfect);
  check("verbatim engine output scores 100% mandatory recall", perfectScore.mandatoryRecall === 1);
  check("verbatim engine output has zero false positives", perfectScore.falsePositives === 0);

  // Drop one mandatory label -> recall (n-1)/n exactly.
  const missing = perfect.filter((item) => item.text !== mandatoryLabels[0].text);
  const missingScore = scoreCase(testCase, missing);
  const expected = (mandatoryLabels.length - 1) / mandatoryLabels.length;
  check(
    `dropping one mandatory item scores exactly ${pct(expected)}`,
    Math.abs((missingScore.mandatoryRecall ?? 0) - expected) < 1e-9,
    `got ${pct(missingScore.mandatoryRecall ?? 0)}`,
  );
  check("the dropped item is named in missedMandatory", missingScore.missedMandatory.length === 1);

  // Paraphrase robustness: reworded-but-substantive item still matches.
  const paraphrased = [{
    text: "The bidder is required to provide a bid security equal to 2% of the bid price, issued by a reputable bank.",
    isMandatory: true,
  }];
  const paraScore = scoreCase(testCase, paraphrased);
  check("paraphrased extraction still surfaces its label", paraScore.surfacedTotal >= 1);

  // Fabricated item (ungrounded in any label) -> false positive.
  const fabricated = [{ text: "The company must provide a helicopter landing pad at its headquarters", isMandatory: false }];
  const fabScore = scoreCase(testCase, fabricated);
  check("fabricated item is logged as a false positive", fabScore.falsePositives === 1);
}

function enforceGates(run: RecordedRun, recomputed: CumulativeScore): void {
  console.log("\n=== Gates ===");
  check(
    "recorded figures reproducible from stored engine outputs (FR-EXT-04)",
    Math.abs(recomputed.mandatoryRecall - run.cumulative.mandatoryRecall) < 1e-9 &&
      recomputed.surfacedMandatory === run.cumulative.surfacedMandatory,
    `recorded ${pct(run.cumulative.mandatoryRecall)} vs recomputed ${pct(recomputed.mandatoryRecall)}`,
  );
  check(
    `cumulative mandatory recall >= ${pct(GATE0_THRESHOLD)} (Gate 0)`,
    recomputed.mandatoryRecall >= GATE0_THRESHOLD,
    pct(recomputed.mandatoryRecall),
  );
  if (existsSync(BASELINE_PATH)) {
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf-8")) as RecordedRun;
    const drop = baseline.cumulative.mandatoryRecall - recomputed.mandatoryRecall;
    check(
      `recall drop vs baseline <= ${pct(MAX_BASELINE_DROP)} (NFR-QLT-02)`,
      drop <= MAX_BASELINE_DROP,
      `baseline ${pct(baseline.cumulative.mandatoryRecall)} -> ${pct(recomputed.mandatoryRecall)}`,
    );
  } else {
    console.log("  (no baseline.json yet — record one with --promote-baseline after a good live run)");
  }
}

function recomputeFromStored(run: RecordedRun): { perDoc: DocScore[]; cumulative: CumulativeScore } {
  const perDoc = EVAL_CASES.filter((c) => run.engineOutputs[c.id]).map((c) =>
    scoreCase(c, run.engineOutputs[c.id]),
  );
  return { perDoc, cumulative: cumulative(perDoc) };
}

async function liveRun(): Promise<void> {
  console.log("\n=== LIVE run: real extraction over the labelled corpus ===");
  const { extractRequirements } = await import("../src/lib/llm");
  const engineOutputs: Record<string, EngineItem[]> = {};
  const perDoc: DocScore[] = [];

  for (const evalCase of EVAL_CASES) {
    const { requirements } = await extractRequirements("00000000-0000-0000-0000-000000000000", [
      {
        id: `eval-${evalCase.id}`,
        filename: `${evalCase.id}.txt`,
        type: "tender",
        contentText: evalCase.documentText,
      },
    ]);
    const items: EngineItem[] = requirements.map((r) => ({
      text: r.text,
      isMandatory: r.isMandatory,
    }));
    engineOutputs[evalCase.id] = items;
    const score = scoreCase(evalCase, items);
    perDoc.push(score);
    console.log(
      `  ${evalCase.id}: mandatory recall ${pct(score.mandatoryRecall ?? 0)} ` +
        `(${score.surfacedMandatory}/${score.labelledMandatory}), ${score.falsePositives} false positive(s)` +
        (score.missedMandatory.length ? `\n    missed: ${score.missedMandatory.join(" | ")}` : ""),
    );
  }

  const { PROMPT_PACK_VERSION, MODEL_ID } = await import("../src/lib/provenance");
  const run: RecordedRun = {
    recordedAt: new Date().toISOString(),
    model: MODEL_ID,
    promptVersion: PROMPT_PACK_VERSION,
    engineOutputs,
    perDoc,
    cumulative: cumulative(perDoc),
  };
  mkdirSync(RUNS_DIR, { recursive: true });
  writeFileSync(LATEST_PATH, JSON.stringify(run, null, 2) + "\n");
  console.log(`\nRecorded run -> ${LATEST_PATH}`);
  console.log(`Cumulative mandatory recall: ${pct(run.cumulative.mandatoryRecall)}`);

  enforceGates(run, recomputeFromStored(run).cumulative);
}

async function main(): Promise<void> {
  const offline = process.argv.includes("--offline");
  const promote = process.argv.includes("--promote-baseline");

  if (promote) {
    if (!existsSync(LATEST_PATH)) {
      console.error("No recorded run to promote — run the live harness first.");
      process.exit(1);
    }
    copyFileSync(LATEST_PATH, BASELINE_PATH);
    console.log(`Promoted ${LATEST_PATH} -> ${BASELINE_PATH}`);
    return;
  }

  console.log(offline ? "Eval harness: OFFLINE (corpus + scorer + recorded-run gates).\n" : "Eval harness: FULL (live model run).\n");
  validateCorpus();
  scorerSelfTest();

  if (offline) {
    if (existsSync(LATEST_PATH)) {
      const run = JSON.parse(readFileSync(LATEST_PATH, "utf-8")) as RecordedRun;
      console.log(`\nRecorded live run found (${run.recordedAt}, model ${run.model}, prompts ${run.promptVersion}).`);
      enforceGates(run, recomputeFromStored(run).cumulative);
    } else {
      console.log(
        "\n(no recorded live run yet — run `pnpm --filter @workspace/api-server eval:harness` in the deploy environment " +
          "and commit eval-harness/runs/latest.json to activate the recall gates)",
      );
    }
  } else {
    await liveRun();
  }

  console.log(`\n=== RESULT: ${passes} passed, ${failures} failed ===`);
  if (failures > 0) process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Eval harness crashed:", error);
    process.exit(1);
  });
