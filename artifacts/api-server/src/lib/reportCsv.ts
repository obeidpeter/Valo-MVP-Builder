export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    let s = v == null ? "" : String(v);
    // CSV formula-injection defense: requirement text / evidence excerpts are
    // verbatim untrusted tender content. A leading =, +, -, @, tab or CR makes
    // a spreadsheet treat the cell as a formula on open (e.g. =IMPORTXML(...)),
    // which for confidential exports is a data-exfiltration vector. Prefix a
    // single quote so the cell is always treated as literal text.
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => escape(r[h])).join(",")),
  ].join("\n");
}

export type ReviewState = "confirmed" | "suggested";

/**
 * Derive the export `review_state` for a register row, so recipients can tell
 * reviewer-confirmed findings from raw AI suggestions. This is the single
 * source of truth for the CSV column and must stay consistent with how the
 * signed DOCX report (`lib/docx.ts`) segregates confirmed vs suggested items:
 *   - a requirement is confirmed unless its `reviewStatus` is still "suggested"
 *   - evidence and defects carry an explicit `suggested` boolean
 */
export function requirementReviewState(row: {
  reviewStatus: string;
}): ReviewState {
  return row.reviewStatus === "suggested" ? "suggested" : "confirmed";
}

export function suggestedFlagReviewState(row: {
  suggested: boolean;
}): ReviewState {
  return row.suggested ? "suggested" : "confirmed";
}

/** Prepend a `review_state` column to each row for CSV export. */
export function withReviewState<T extends Record<string, unknown>>(
  rows: T[],
  reviewState: (row: T) => ReviewState,
): (T & { review_state: ReviewState })[] {
  return rows.map((row) => ({ review_state: reviewState(row), ...row }));
}
