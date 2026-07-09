/**
 * Fixed recall/precision definitions for the eval harness (TRD §14):
 *
 *   mandatory recall = labelled MANDATORY items the engine surfaced
 *                      ÷ all labelled mandatory items
 *   overall recall   = labelled items the engine surfaced ÷ all labelled items
 *   precision proxy  = engine items that matched some labelled item
 *                      ÷ all engine items (unmatched engine items are the
 *                      false-positive log FR-EXT-04 requires)
 *
 * "Surfaced" is decided by deterministic token containment: a labelled item
 * counts as surfaced when some engine item's text contains at least
 * MATCH_THRESHOLD of the label's content tokens. One engine item may surface
 * several labels (merged extractions still surface each obligation).
 * These definitions live HERE and only here — a run's recorded figures must
 * be reproducible by re-running this module over its stored engine outputs.
 */
import type { EvalCase } from "./cases";

export const MATCH_THRESHOLD = 0.6;
/** Engine items below this best-containment against every label are false positives. */
export const FALSE_POSITIVE_THRESHOLD = 0.4;

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in", "is",
  "it", "must", "not", "of", "on", "or", "per", "shall", "should", "than",
  "that", "the", "their", "to", "with", "bidders", "bidder", "evidence",
  "valid", "current",
]);

export function contentTokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1 && !STOPWORDS.has(t)),
  );
}

/** Fraction of the label's content tokens present in the engine item. */
export function containment(labelText: string, engineText: string): number {
  const label = contentTokens(labelText);
  if (label.size === 0) return 0;
  const engine = contentTokens(engineText);
  let hit = 0;
  for (const token of label) if (engine.has(token)) hit++;
  return hit / label.size;
}

export interface EngineItem {
  text: string;
  isMandatory: boolean;
}

export interface DocScore {
  caseId: string;
  labelledTotal: number;
  labelledMandatory: number;
  surfacedTotal: number;
  surfacedMandatory: number;
  missedMandatory: string[];
  falsePositives: number;
  engineItems: number;
  mandatoryRecall: number | null;
  overallRecall: number | null;
}

export function scoreCase(evalCase: EvalCase, engineItems: EngineItem[]): DocScore {
  const missedMandatory: string[] = [];
  let surfacedTotal = 0;
  let surfacedMandatory = 0;

  for (const label of evalCase.labelled) {
    const best = engineItems.reduce(
      (max, item) => Math.max(max, containment(label.text, item.text)),
      0,
    );
    const surfaced = best >= MATCH_THRESHOLD;
    if (surfaced) {
      surfacedTotal++;
      if (label.isMandatory) surfacedMandatory++;
    } else if (label.isMandatory) {
      missedMandatory.push(label.text);
    }
  }

  // A false positive is an engine item whose OWN content is not grounded in
  // any label (engine->label containment). This is a proxy log — the
  // authoritative false-positive record is the production scorecard, where a
  // named reviewer rejects the item (FR-EXT-04).
  const falsePositives = engineItems.filter((item) => {
    const best = evalCase.labelled.reduce(
      (max, label) => Math.max(max, containment(item.text, label.text)),
      0,
    );
    return best < FALSE_POSITIVE_THRESHOLD;
  }).length;

  const labelledMandatory = evalCase.labelled.filter((l) => l.isMandatory).length;
  return {
    caseId: evalCase.id,
    labelledTotal: evalCase.labelled.length,
    labelledMandatory,
    surfacedTotal,
    surfacedMandatory,
    missedMandatory,
    falsePositives,
    engineItems: engineItems.length,
    mandatoryRecall: labelledMandatory > 0 ? surfacedMandatory / labelledMandatory : null,
    overallRecall: evalCase.labelled.length > 0 ? surfacedTotal / evalCase.labelled.length : null,
  };
}

export interface CumulativeScore {
  docs: number;
  labelledMandatory: number;
  surfacedMandatory: number;
  mandatoryRecall: number;
  labelledTotal: number;
  surfacedTotal: number;
  overallRecall: number;
  falsePositives: number;
  engineItems: number;
}

export function cumulative(scores: DocScore[]): CumulativeScore {
  const sum = (f: (s: DocScore) => number) => scores.reduce((acc, s) => acc + f(s), 0);
  const labelledMandatory = sum((s) => s.labelledMandatory);
  const surfacedMandatory = sum((s) => s.surfacedMandatory);
  const labelledTotal = sum((s) => s.labelledTotal);
  const surfacedTotal = sum((s) => s.surfacedTotal);
  return {
    docs: scores.length,
    labelledMandatory,
    surfacedMandatory,
    mandatoryRecall: labelledMandatory > 0 ? surfacedMandatory / labelledMandatory : 0,
    labelledTotal,
    surfacedTotal,
    overallRecall: labelledTotal > 0 ? surfacedTotal / labelledTotal : 0,
    falsePositives: sum((s) => s.falsePositives),
    engineItems: sum((s) => s.engineItems),
  };
}
