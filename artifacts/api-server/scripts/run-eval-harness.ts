/**
 * Eval harness v0 runner (FR-EXT-05, BP §9).
 *
 * Measures the extraction ENGINE against a fixed, hand-labelled corpus of
 * tenders (scripts/eval-corpus/corpus.ts) and reports recall per tender and
 * overall. Unlike the production scorecard — which measures the engine against
 * what humans ruled on in live reviews — this is a regression suite: it fails
 * loudly when a prompt or model change silently drops requirements.
 *
 * Run modes:
 *   --offline   (CI mode) Self-check only: validate the corpus is well-formed
 *               and that the deterministic matcher recalls a synthetic engine
 *               output derived from the ground truth. No DB, no OpenAI. This
 *               guards the harness plumbing; it does NOT measure the model.
 *   (default)   Self-check PLUS a live pass that runs the real
 *               extractRequirements over every tender (needs the model key;
 *               run in the deploy environment, not CI) and fails when overall
 *               recall drops below the target.
 *
 * The recall target defaults to the v0 bar and can be overridden with
 * EVAL_RECALL_TARGET (e.g. EVAL_RECALL_TARGET=0.9).
 */
import {
  aggregateReport,
  computeTenderRecall,
  normalizeText,
  requirementMatched,
  validateCorpus,
  EVAL_RECALL_TARGET_V0,
  type EvalTender,
} from "../src/lib/evalHarness";
import { CORPUS } from "./eval-corpus/corpus";

let passes = 0;
let failures = 0;
function check(label: string, ok: boolean, detail?: string): boolean {
  if (ok) {
    passes++;
    console.log(`  \u2713 ${label}`);
  } else {
    failures++;
    console.log(`  \u2717 ${label}${detail ? ` \u2014 ${detail}` : ""}`);
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

  // Matcher/corpus consistency: a synthetic faithful extraction must recall
  // every labelled requirement, and a matcher must not "recall" a requirement
  // from unrelated text.
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

async function livePass(target: number): Promise<void> {
  console.log(`\n=== LIVE recall pass (real engine over ${CORPUS.length} tenders) ===`);
  console.log(`Target overall recall: ${pct(target)}\n`);
  const { extractRequirements } = await import("../src/lib/llm");
  // A throwaway project id: extraction does not require a real project row.
  const projectId = "00000000-0000-0000-0000-000000000000";

  const perTender = [];
  for (const tender of CORPUS) {
    const { requirements } = await extractRequirements(projectId, [
      { id: `${tender.id}-doc`, filename: `${tender.id}.txt`, type: "tender", contentText: tender.documentText },
    ]);
    const result = computeTenderRecall(tender, requirements.map((r) => r.text));
    perTender.push(result);
    const line = `${tender.id}: recall ${pct(result.recall)} (${result.matched}/${result.total})`;
    if (result.missed.length > 0) {
      console.log(`  \u2717 ${line}`);
      for (const m of result.missed) {
        console.log(`      MISSED [${m.mandatory ? "mandatory" : "desirable"}] ${m.label}`);
      }
    } else {
      console.log(`  \u2713 ${line}`);
    }
  }

  const report = aggregateReport(perTender, target);
  console.log(
    `\nOverall recall: ${pct(report.overallRecall)} (${report.totalMatched}/${report.totalGroundTruth}) ` +
      `vs target ${pct(report.target)}`,
  );
  check(
    `overall engine recall meets the v0 target`,
    report.passed,
    report.passed ? undefined : `${pct(report.overallRecall)} < ${pct(report.target)}`,
  );

  // Surface the worst offenders explicitly so a regression is actionable.
  const failing = report.perTender.filter((t) => t.missed.length > 0);
  if (failing.length > 0) {
    console.log(`\nTenders with missed requirements: ${failing.map((t) => t.id).join(", ")}`);
  }
}

async function main(): Promise<void> {
  const offline = process.argv.includes("--offline");
  const target = resolveTarget();
  console.log(
    offline
      ? "Running OFFLINE eval-harness self-check only.\n"
      : "Running FULL eval harness (self-check + live engine recall).\n",
  );

  selfCheck();
  if (!offline) {
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
