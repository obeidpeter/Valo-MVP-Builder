export type Severity = "fatal" | "likely_fatal" | "scoring_risk" | "cosmetic";
export type RiskBand = "low" | "medium" | "high" | "critical";

export type BoqCheckType =
  | "extension_mismatch"
  | "section_total"
  | "grand_total"
  | "words_vs_figures"
  | "blank_line"
  | "suspicious_zero";

export interface BoqRow {
  lineRef?: string | null;
  description?: string | null;
  quantity?: number | null;
  unitRate?: number | null;
  extension?: number | null;
  amountInWords?: string | null;
  section?: string | null;
}

export interface BoqFinding {
  lineRef: string | null;
  description: string | null;
  quantity: number | null;
  unitRate: number | null;
  extension: number | null;
  computedExtension: number | null;
  checkType: BoqCheckType;
  finding: string;
  severity: Severity;
  status: "flagged";
}

export interface BoqRunResult {
  findings: BoqFinding[];
  computedGrandTotal: number;
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

const WORD_UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19,
};
const WORD_TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
  eighty: 80, ninety: 90,
};
const WORD_SCALES: Record<string, number> = {
  thousand: 1000, million: 1_000_000, billion: 1_000_000_000,
};

/**
 * Parse an English amount-in-words into its whole-number value, ignoring
 * currency and filler words ("dollars", "rand", "only", "and"). Fractional
 * parts ("... and fifty cents", ".../100") are intentionally dropped — BOQ
 * lines are compared on whole currency units. Returns null when nothing
 * parseable is found so callers can skip rather than flag falsely.
 */
export function wordsToNumber(input: string | null | undefined): number | null {
  if (!input) return null;
  const tokens = input
    .toLowerCase()
    .replace(/[.,]/g, " ")
    .split(/[\s-]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && t !== "and");

  let current = 0;
  let total = 0;
  let matched = false;
  for (const tok of tokens) {
    if (tok in WORD_UNITS) {
      current += WORD_UNITS[tok];
      matched = true;
    } else if (tok in WORD_TENS) {
      current += WORD_TENS[tok];
      matched = true;
    } else if (tok === "hundred") {
      current = (current || 1) * 100;
      matched = true;
    } else if (tok in WORD_SCALES) {
      total += (current || 1) * WORD_SCALES[tok];
      current = 0;
      matched = true;
    } else if (tok === "cent" || tok === "cents") {
      break; // stop at the fractional part
    }
    // any other token (currency name, "only", etc.) is ignored
  }
  if (!matched) return null;
  return total + current;
}

/**
 * Deterministic Bill of Quantities arithmetic verification.
 * All findings are exact, reproducible, and require no LLM. Rows that pass
 * every check produce no finding. `tolerance` is the absolute currency amount
 * a computed value may differ from the submitted value before it is flagged.
 */
export function runBoqChecks(
  rows: BoqRow[],
  grandTotal?: number | null,
  tolerance = 0.5,
): BoqRunResult {
  const findings: BoqFinding[] = [];
  const tol = Math.max(0, tolerance);
  let computedGrandTotal = 0;

  // Sum of computed line extensions per section, plus any declared section
  // subtotal rows, used for the section_total check after the row loop.
  const sectionSums = new Map<string, number>();
  const subtotalRows: {
    lineRef: string | null;
    description: string | null;
    section: string;
    declared: number;
  }[] = [];
  const addToSection = (section: string | null | undefined, amount: number) => {
    if (section == null || section === "") return;
    sectionSums.set(section, round2((sectionSums.get(section) ?? 0) + amount));
  };

  for (const row of rows) {
    const lineRef = row.lineRef ?? null;
    const description = row.description ?? null;
    const quantity = row.quantity ?? null;
    const unitRate = row.unitRate ?? null;
    const extension = row.extension ?? null;

    const hasQty = typeof quantity === "number" && Number.isFinite(quantity);
    const hasRate = typeof unitRate === "number" && Number.isFinite(unitRate);
    const hasExt = typeof extension === "number" && Number.isFinite(extension);

    // A declared section subtotal row (an amount with no qty/rate whose
    // description reads as a subtotal). Recorded for the section_total check
    // and excluded from the grand-total sum so it is not double-counted.
    const isSubtotalMarker =
      hasExt &&
      !(hasQty && hasRate) &&
      !!description &&
      /\b(sub[\s-]?total|section\s+total)\b/i.test(description) &&
      !!row.section;
    if (isSubtotalMarker) {
      subtotalRows.push({
        lineRef,
        description,
        section: row.section as string,
        declared: extension as number,
      });
      continue;
    }

    // Blank / incomplete priced line.
    if (!hasQty && !hasRate && !hasExt) {
      findings.push({
        lineRef,
        description,
        quantity,
        unitRate,
        extension,
        computedExtension: null,
        checkType: "blank_line",
        finding: "Priced line has no quantity, rate, or extension.",
        severity: "likely_fatal",
        status: "flagged",
      });
      continue;
    }

    let computedExtension: number | null = null;
    if (hasQty && hasRate) {
      computedExtension = round2(quantity * unitRate);
      computedGrandTotal += computedExtension;
      addToSection(row.section, computedExtension);

      if (hasExt) {
        const delta = Math.abs(round2(extension - computedExtension));
        if (delta > tol) {
          findings.push({
            lineRef,
            description,
            quantity,
            unitRate,
            extension,
            computedExtension,
            checkType: "extension_mismatch",
            finding: `Extension ${extension} does not equal quantity × rate (${computedExtension}); difference ${round2(
              extension - computedExtension,
            )}.`,
            severity: "likely_fatal",
            status: "flagged",
          });
        }
      }
    } else if (hasExt) {
      computedGrandTotal += extension;
      addToSection(row.section, extension);
    }

    // Suspicious zero: priced line with a description but zero/blank rate.
    if (description && description.trim().length > 0 && hasRate && unitRate === 0) {
      findings.push({
        lineRef,
        description,
        quantity,
        unitRate,
        extension,
        computedExtension,
        checkType: "suspicious_zero",
        finding: "Line item has a description but a zero unit rate.",
        severity: "scoring_risk",
        status: "flagged",
      });
    }

    // Words-vs-figures: the amount-in-words must equal the line figure.
    if (row.amountInWords && row.amountInWords.trim().length > 0) {
      const figure = hasExt ? extension : computedExtension;
      const parsedWords = wordsToNumber(row.amountInWords);
      if (
        figure != null &&
        parsedWords != null &&
        Math.abs(round2(figure - parsedWords)) > tol
      ) {
        findings.push({
          lineRef,
          description,
          quantity,
          unitRate,
          extension,
          computedExtension,
          checkType: "words_vs_figures",
          finding: `Amount in words ("${row.amountInWords.trim()}" = ${parsedWords}) does not match the figure ${figure}; difference ${round2(
            figure - parsedWords,
          )}.`,
          severity: "likely_fatal",
          status: "flagged",
        });
      }
    }
  }

  computedGrandTotal = round2(computedGrandTotal);

  // Section totals: each declared section subtotal must equal the sum of its
  // priced line extensions.
  for (const sub of subtotalRows) {
    const summed = round2(sectionSums.get(sub.section) ?? 0);
    const delta = Math.abs(round2(sub.declared - summed));
    if (delta > tol) {
      findings.push({
        lineRef: sub.lineRef,
        description: sub.description,
        quantity: null,
        unitRate: null,
        extension: sub.declared,
        computedExtension: summed,
        checkType: "section_total",
        finding: `Declared section total ${sub.declared} for "${sub.section}" does not equal the sum of its line extensions (${summed}); difference ${round2(
          sub.declared - summed,
        )}.`,
        severity: "likely_fatal",
        status: "flagged",
      });
    }
  }

  if (typeof grandTotal === "number" && Number.isFinite(grandTotal)) {
    const delta = Math.abs(round2(grandTotal - computedGrandTotal));
    if (delta > tol) {
      findings.push({
        lineRef: null,
        description: "Grand total",
        quantity: null,
        unitRate: null,
        extension: grandTotal,
        computedExtension: computedGrandTotal,
        checkType: "grand_total",
        finding: `Submitted grand total ${grandTotal} does not equal the sum of line extensions (${computedGrandTotal}); difference ${round2(
          grandTotal - computedGrandTotal,
        )}.`,
        severity: "fatal",
        status: "flagged",
      });
    }
  }

  return { findings, computedGrandTotal };
}

export interface RiskInput {
  defects: { severity: Severity; status: string }[];
  requirements: { id: string; isMandatory: boolean; reviewStatus: string }[];
  evidence: { requirementId: string; evidenceStatus: string; suggested: boolean }[];
}

/**
 * Requirement review states that must NOT drive the risk score: "suggested" is
 * a raw, unconfirmed AI suggestion, and "rejected" was explicitly dismissed by
 * a reviewer. Per the doctrine ("everything is suggested until a named human
 * confirms"), a mandatory requirement in either state never contributes the
 * missing-evidence penalty on its own. Reviewer-owned states (confirmed,
 * edited, pending) count as normal.
 */
const UNCOUNTED_REVIEW_STATUSES = new Set(["suggested", "rejected"]);

export interface RiskResult {
  score: number;
  band: RiskBand;
  explanation: string;
  distribution: Record<Severity, number>;
}

const SEVERITY_WEIGHTS: Record<Severity, number> = {
  fatal: 40,
  likely_fatal: 25,
  scoring_risk: 10,
  cosmetic: 3,
};

const MISSING_EVIDENCE_WEIGHT = 5;

/**
 * Deterministic disqualification-risk score. Per the doctrine, only items a
 * named human reviewer has confirmed contribute — unconfirmed AI suggestions
 * never move the score on their own:
 *  - Defects: only confirmed-live defects (status "open") count; "suggested"
 *    (unconfirmed), "remediated" and "waived" defects are excluded.
 *  - Missing/expired-evidence penalty applies only to confirmed evidence rows
 *    (suggested === false) on mandatory requirements that are not raw AI
 *    suggestions or rejected (see UNCOUNTED_REVIEW_STATUSES).
 * Bands: critical if any confirmed fatal defect or score >= 70, high >= 40,
 * medium >= 15, otherwise low.
 */
export function computeRisk(input: RiskInput): RiskResult {
  const distribution: Record<Severity, number> = {
    fatal: 0,
    likely_fatal: 0,
    scoring_risk: 0,
    cosmetic: 0,
  };

  const liveDefects = input.defects.filter((d) => d.status === "open");

  let score = 0;
  let hasFatal = false;
  for (const d of liveDefects) {
    const weight = SEVERITY_WEIGHTS[d.severity] ?? 0;
    score += weight;
    if (d.severity in distribution) distribution[d.severity] += 1;
    if (d.severity === "fatal") hasFatal = true;
  }

  const mandatoryReqIds = new Set(
    input.requirements
      .filter((r) => r.isMandatory && !UNCOUNTED_REVIEW_STATUSES.has(r.reviewStatus))
      .map((r) => r.id),
  );
  const penalisedReqIds = new Set<string>();
  for (const e of input.evidence) {
    if (
      !e.suggested &&
      (e.evidenceStatus === "missing" || e.evidenceStatus === "expired") &&
      mandatoryReqIds.has(e.requirementId)
    ) {
      penalisedReqIds.add(e.requirementId);
    }
  }
  const missingEvidencePenalty = penalisedReqIds.size;
  score += missingEvidencePenalty * MISSING_EVIDENCE_WEIGHT;

  score = Math.min(100, Math.round(score));

  let band: RiskBand;
  if (hasFatal || score >= 70) band = "critical";
  else if (score >= 40) band = "high";
  else if (score >= 15) band = "medium";
  else band = "low";

  const parts: string[] = [];
  parts.push(
    `${liveDefects.length} live defect(s): ${distribution.fatal} fatal, ${distribution.likely_fatal} likely-fatal, ${distribution.scoring_risk} scoring-risk, ${distribution.cosmetic} cosmetic.`,
  );
  if (missingEvidencePenalty > 0) {
    parts.push(
      `${missingEvidencePenalty} missing/expired evidence item(s) at +${MISSING_EVIDENCE_WEIGHT} each.`,
    );
  }
  parts.push(`Computed score ${score}/100 → ${band.toUpperCase()} band.`);
  if (hasFatal) parts.push("At least one fatal defect forces the CRITICAL band.");

  return { score, band, explanation: parts.join(" "), distribution };
}
