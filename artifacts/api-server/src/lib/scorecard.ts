/**
 * Gate 0 Technical Scorecard (FR-EXT-04/05, BP §10.4): the engine-vs-human
 * diff over the requirement matrix, computed live from stored records so the
 * figures are always reproducible by independent recomputation.
 *
 * Definitions, fixed here per TRD §14:
 *  - A row is HUMAN-VERIFIED when reviewStatus ∈ {confirmed, edited}.
 *  - Mandatory recall = verified mandatory rows the ENGINE surfaced
 *    ÷ ALL verified mandatory rows (engine-surfaced + manual additions).
 *    Manual additions are, by definition, engine misses.
 *  - False positives = engine rows a reviewer explicitly rejected.
 *  - suggested/pending rows are counted but excluded from recall: recall is
 *    only meaningful over rows a named human has ruled on.
 *  - Rows predating origin tracking (origin null) are excluded entirely and
 *    reported as legacyRows — never guessed into either side of the diff.
 *
 * Pure module: no DB, no clock; unit-tested in scorecard.test.ts.
 */

export interface ScorecardRow {
  sourceDocId: string | null;
  /** "engine" | "manual" | null (legacy, pre-tracking). */
  origin: string | null;
  isMandatory: boolean;
  reviewStatus: string;
}

export interface ScorecardCounts {
  /** Engine rows a human confirmed unchanged. */
  engineConfirmed: number;
  /** Engine rows a human confirmed with edits. */
  engineEdited: number;
  /** Engine rows a human rejected (false positives). */
  engineRejected: number;
  /** Engine rows not yet ruled on (suggested/pending). */
  engineUnreviewed: number;
  /** Human-added verified rows (engine misses). */
  manualVerified: number;
  /** Verified mandatory rows the engine surfaced. */
  mandatoryEngineVerified: number;
  /** All verified mandatory rows (engine + manual). */
  mandatoryVerifiedTotal: number;
  /**
   * Engine-alone mandatory recall (FR-EXT-05): mandatoryEngineVerified ÷
   * mandatoryVerifiedTotal. Null when no verified mandatory rows exist yet.
   */
  mandatoryRecall: number | null;
}

export interface DocumentScorecard extends ScorecardCounts {
  /** Source document, or null for rows not attributed to one. */
  documentId: string | null;
}

export interface Scorecard {
  totals: ScorecardCounts;
  perDocument: DocumentScorecard[];
  /** Rows predating origin tracking, excluded from every figure above. */
  legacyRows: number;
}

const VERIFIED = new Set(["confirmed", "edited"]);

function emptyCounts(): ScorecardCounts {
  return {
    engineConfirmed: 0,
    engineEdited: 0,
    engineRejected: 0,
    engineUnreviewed: 0,
    manualVerified: 0,
    mandatoryEngineVerified: 0,
    mandatoryVerifiedTotal: 0,
    mandatoryRecall: null,
  };
}

function tally(counts: ScorecardCounts, row: ScorecardRow): void {
  const verified = VERIFIED.has(row.reviewStatus);
  if (row.origin === "engine") {
    if (row.reviewStatus === "confirmed") counts.engineConfirmed++;
    else if (row.reviewStatus === "edited") counts.engineEdited++;
    else if (row.reviewStatus === "rejected") counts.engineRejected++;
    else counts.engineUnreviewed++;
    if (verified && row.isMandatory) counts.mandatoryEngineVerified++;
  } else if (row.origin === "manual" && verified) {
    counts.manualVerified++;
  }
  if (verified && row.isMandatory) counts.mandatoryVerifiedTotal++;
}

function finalize(counts: ScorecardCounts): void {
  counts.mandatoryRecall =
    counts.mandatoryVerifiedTotal === 0
      ? null
      : counts.mandatoryEngineVerified / counts.mandatoryVerifiedTotal;
}

export function computeScorecard(rows: ScorecardRow[]): Scorecard {
  const totals = emptyCounts();
  const perDoc = new Map<string | null, ScorecardCounts>();
  let legacyRows = 0;

  for (const row of rows) {
    if (row.origin !== "engine" && row.origin !== "manual") {
      legacyRows++;
      continue;
    }
    tally(totals, row);
    const key = row.sourceDocId ?? null;
    let doc = perDoc.get(key);
    if (!doc) {
      doc = emptyCounts();
      perDoc.set(key, doc);
    }
    tally(doc, row);
  }

  finalize(totals);
  const perDocument: DocumentScorecard[] = [...perDoc.entries()].map(([documentId, counts]) => {
    finalize(counts);
    return { documentId, ...counts };
  });
  // Stable order: attributed documents first (by id), unattributed last.
  perDocument.sort((a, b) => {
    if (a.documentId === null) return 1;
    if (b.documentId === null) return -1;
    return a.documentId < b.documentId ? -1 : a.documentId > b.documentId ? 1 : 0;
  });

  return { totals, perDocument, legacyRows };
}
