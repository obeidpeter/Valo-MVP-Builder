/**
 * Eval harness v0 core (FR-EXT-05, BP §9): the engine-vs-ground-truth recall
 * regression logic.
 *
 * The production scorecard (scorecard.ts) measures the engine against what a
 * named human ruled on in real reviews. This harness measures the engine
 * against a fixed, hand-labelled corpus of tenders with verified requirement
 * lists — a regression suite that catches silent extraction drops when a
 * prompt or model changes.
 *
 * This module is PURE (no DB, no OpenAI, no clock): it defines the corpus
 * shape, the deterministic matcher, and the recall computation, all unit-
 * tested in evalHarness.test.ts. The live model call and corpus live in
 * scripts/ (run-eval-harness.ts + eval-corpus/corpus.ts).
 *
 * Matching, fixed here so recall is reproducible:
 *  - A ground-truth requirement is RECALLED when some single extracted
 *    requirement's normalised text satisfies its match spec.
 *  - A match spec is an AND-of-ORs: `match: string[][]`. Every group must be
 *    satisfied, and a group is satisfied when at least one of its alternative
 *    phrases appears as a substring of the extracted text. Matching all groups
 *    within ONE extracted requirement (not spread across several) keeps a
 *    match meaning "the engine surfaced THIS obligation", not "these words
 *    appear somewhere".
 */

/** v0 target (Gate 0 bar). The v1.0 target is 0.95 over >= 25 documents. */
export const EVAL_RECALL_TARGET_V0 = 0.85;

/** Minimum corpus size for v0 (BP §9: >= 10 hand-labelled tenders). */
export const EVAL_MIN_CORPUS = 10;

export interface GroundTruthRequirement {
  /** Stable id, unique within its tender. */
  id: string;
  /** Human-readable description of the obligation being checked. */
  label: string;
  /** Whether the tender states this as a mandatory (disqualifying) obligation. */
  mandatory: boolean;
  /**
   * AND-of-ORs match spec. Recalled when some extracted requirement's
   * normalised text contains >= 1 alternative from EVERY group.
   */
  match: string[][];
}

export interface EvalTender {
  /** Stable id, unique across the corpus. */
  id: string;
  title: string;
  /** The tender text fed to the engine (as an uploaded tender would arrive). */
  documentText: string;
  /** The hand-labelled, verified requirement list for this tender. */
  groundTruth: GroundTruthRequirement[];
}

export interface TenderRecall {
  tenderId: string;
  title: string;
  total: number;
  matched: number;
  /** matched / total, or 1 when a tender has no ground-truth rows. */
  recall: number;
  /** Mandatory-only figures — the TRD's FR-EXT-05 threshold is on these. */
  mandatoryTotal: number;
  mandatoryMatched: number;
  /** mandatoryMatched / mandatoryTotal, or 1 when no mandatory rows. */
  mandatoryRecall: number;
  /** Ground-truth requirements the engine did NOT surface. */
  missed: GroundTruthRequirement[];
}

export interface EvalReport {
  perTender: TenderRecall[];
  totalGroundTruth: number;
  totalMatched: number;
  /** totalMatched / totalGroundTruth, or 1 when the corpus is empty. */
  overallRecall: number;
  /** Cumulative mandatory-only recall (the FR-EXT-05 gate figure). */
  mandatoryGroundTruth: number;
  mandatoryMatched: number;
  mandatoryRecall: number;
  target: number;
  /** Overall recall meets the target. */
  passed: boolean;
  /** Mandatory recall meets the target — the TRD release gate. */
  mandatoryPassed: boolean;
}

/** Lowercase, strip punctuation to spaces, collapse whitespace. */
export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** True if `normalized` satisfies every group in the AND-of-ORs match spec. */
function specSatisfiedBy(normalized: string, spec: string[][]): boolean {
  return spec.every((group) => group.some((alt) => normalized.includes(normalizeText(alt))));
}

/**
 * True if some single extracted requirement's text recalls this ground-truth
 * obligation. `extractedTexts` is the engine's raw requirement text list.
 */
export function requirementMatched(
  gt: GroundTruthRequirement,
  normalizedExtracted: string[],
): boolean {
  if (gt.match.length === 0) return false;
  return normalizedExtracted.some((t) => specSatisfiedBy(t, gt.match));
}

/** Per-tender recall: how many ground-truth requirements the engine surfaced. */
export function computeTenderRecall(
  tender: EvalTender,
  extractedTexts: string[],
): TenderRecall {
  const normalizedExtracted = extractedTexts.map((t) => normalizeText(t));
  const missed = tender.groundTruth.filter((gt) => !requirementMatched(gt, normalizedExtracted));
  const total = tender.groundTruth.length;
  const matched = total - missed.length;
  const mandatoryTotal = tender.groundTruth.filter((g) => g.mandatory).length;
  const mandatoryMissed = missed.filter((g) => g.mandatory).length;
  const mandatoryMatched = mandatoryTotal - mandatoryMissed;
  return {
    tenderId: tender.id,
    title: tender.title,
    total,
    matched,
    recall: total === 0 ? 1 : matched / total,
    mandatoryTotal,
    mandatoryMatched,
    mandatoryRecall: mandatoryTotal === 0 ? 1 : mandatoryMatched / mandatoryTotal,
    missed,
  };
}

/** Aggregate per-tender results into an overall recall report. */
export function aggregateReport(
  perTender: TenderRecall[],
  target: number = EVAL_RECALL_TARGET_V0,
): EvalReport {
  const totalGroundTruth = perTender.reduce((n, t) => n + t.total, 0);
  const totalMatched = perTender.reduce((n, t) => n + t.matched, 0);
  const overallRecall = totalGroundTruth === 0 ? 1 : totalMatched / totalGroundTruth;
  const mandatoryGroundTruth = perTender.reduce((n, t) => n + t.mandatoryTotal, 0);
  const mandatoryMatched = perTender.reduce((n, t) => n + t.mandatoryMatched, 0);
  const mandatoryRecall = mandatoryGroundTruth === 0 ? 1 : mandatoryMatched / mandatoryGroundTruth;
  return {
    perTender,
    totalGroundTruth,
    totalMatched,
    overallRecall,
    mandatoryGroundTruth,
    mandatoryMatched,
    mandatoryRecall,
    target,
    // Guard against a floating-point hair below an exact target boundary.
    passed: overallRecall + 1e-9 >= target,
    mandatoryPassed: mandatoryRecall + 1e-9 >= target,
  };
}

/**
 * Structural validation of the corpus (used by the offline self-check so CI
 * guards that the harness stays wired and the corpus stays well-formed even
 * though the real recall measurement needs the model key).
 * Returns a list of problems; empty means valid.
 */
export function validateCorpus(tenders: EvalTender[]): string[] {
  const problems: string[] = [];
  if (tenders.length < EVAL_MIN_CORPUS) {
    problems.push(`corpus has ${tenders.length} tenders, need >= ${EVAL_MIN_CORPUS}`);
  }
  const seenTenderIds = new Set<string>();
  for (const t of tenders) {
    if (seenTenderIds.has(t.id)) problems.push(`duplicate tender id: ${t.id}`);
    seenTenderIds.add(t.id);
    if (!t.documentText.trim()) problems.push(`${t.id}: empty documentText`);
    if (t.groundTruth.length === 0) problems.push(`${t.id}: no ground-truth requirements`);
    if (!t.groundTruth.some((g) => g.mandatory)) {
      problems.push(`${t.id}: no mandatory ground-truth requirement`);
    }
    const seenReqIds = new Set<string>();
    for (const g of t.groundTruth) {
      if (seenReqIds.has(g.id)) problems.push(`${t.id}: duplicate requirement id ${g.id}`);
      seenReqIds.add(g.id);
      if (!g.label.trim()) problems.push(`${t.id}/${g.id}: empty label`);
      if (g.match.length === 0) problems.push(`${t.id}/${g.id}: empty match spec`);
      if (g.match.some((group) => group.length === 0 || group.some((a) => !a.trim()))) {
        problems.push(`${t.id}/${g.id}: match spec has an empty group or alternative`);
      }
    }
  }
  return problems;
}
