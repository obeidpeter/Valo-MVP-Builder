import type { Severity } from "./riskScoring";
import { parseNumberDecimal, rescale, type Decimal } from "./decimalMoney";

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
  quantityRaw: string | null;
  unitRateKobo: number | null;
  extensionKobo: number | null;
  computedExtensionKobo: number | null;
  checkType: BoqCheckType;
  finding: string;
  severity: Severity;
  status: "flagged";
}

export interface BoqRunResult {
  findings: BoqFinding[];
  computedGrandTotal: number;
}

// ---------------------------------------------------------------------------
// Exact money arithmetic (FR-BOQ-01): no binary floating point in money paths.
// Values arrive as JSON numbers; we treat their decimal string form as the
// authoritative figure, parse it into a scaled BigInt, and do all comparison
// and summation in integer kobo. Zero tolerance by default: one kobo off is a
// finding.
// ---------------------------------------------------------------------------

type ScaledDecimal = Decimal;

/** A currency amount as integer kobo (half-away-from-zero at 2dp). */
export function toKobo(value: number): bigint | null {
  const scaled: ScaledDecimal | null = parseNumberDecimal(value);
  return scaled === null ? null : rescale(scaled, 2);
}

/** Exact product of two decimal figures, rounded half away from zero to kobo. */
export function mulToKobo(a: number, b: number): bigint | null {
  const sa = parseNumberDecimal(a);
  const sb = parseNumberDecimal(b);
  if (sa === null || sb === null) return null;
  return rescale(
    { digits: sa.digits * sb.digits, scale: sa.scale + sb.scale },
    2,
  );
}

/** Kobo back to a display number (exact for any realistic BOQ magnitude). */
export const koboToNumber = (kobo: bigint): number => Number(kobo) / 100;
export const koboToSafeNumber = (kobo: bigint | null): number | null => {
  if (kobo === null) return null;
  const n = Number(kobo);
  if (!Number.isSafeInteger(n)) {
    throw new Error(
      "Currency amount exceeds safe integer range for kobo persistence",
    );
  }
  return n;
};

const koboAbs = (k: bigint): bigint => (k < 0n ? -k : k);
const koboDisplay = (kobo: bigint): string => koboToNumber(kobo).toFixed(2);

const WORD_UNITS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};
const WORD_TENS: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};
const WORD_SCALES: Record<string, number> = {
  thousand: 1000,
  million: 1_000_000,
  billion: 1_000_000_000,
};

const FRACTION_MARKERS = new Set([
  "kobo",
  "cent",
  "cents",
  "centime",
  "centimes",
]);

function tokenizeAmountWords(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[.,]/g, " ")
    .split(/[\s-]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && t !== "and");
}

/** Accumulate a group of number words into a value; null if none matched. */
function parseWordGroup(tokens: string[]): number | null {
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
    }
    // any other token (currency name, "only", etc.) is ignored
  }
  return matched ? total + current : null;
}

/**
 * Parse an English amount-in-words into integer kobo (FR-BOQ-02), handling
 * the fractional part properly: "one hundred naira and fifty kobo" → 10050n.
 * The fractional group is the run of unit/tens words immediately before the
 * kobo/cents marker; everything before that is whole currency units. Returns
 * null when nothing parseable is found so callers can skip rather than flag
 * falsely.
 */
export function wordsToKobo(input: string | null | undefined): bigint | null {
  if (!input) return null;
  const tokens = tokenizeAmountWords(input);

  // Locate the first fraction marker and carve out the fractional word group
  // (tens/units only, < 100) that immediately precedes it.
  const markerIdx = tokens.findIndex((t) => FRACTION_MARKERS.has(t));
  let wholeTokens = tokens;
  let fraction = 0;
  if (markerIdx >= 0) {
    let start = markerIdx;
    let value = 0;
    while (start > 0) {
      const tok = tokens[start - 1];
      const tokValue =
        tok in WORD_UNITS
          ? WORD_UNITS[tok]
          : tok in WORD_TENS
            ? WORD_TENS[tok]
            : null;
      if (tokValue === null || value + tokValue >= 100) break;
      value += tokValue;
      start--;
    }
    fraction = value;
    wholeTokens = tokens.slice(0, start);
    // Tokens after the marker are ignored ("only", currency names, …).
  }

  const whole = parseWordGroup(wholeTokens);
  if (whole === null && (markerIdx < 0 || fraction === 0)) return null;
  return BigInt(whole ?? 0) * 100n + BigInt(fraction);
}

/**
 * Parse an English amount-in-words into its whole-number value, ignoring
 * currency and filler words ("dollars", "rand", "only", "and"). Fractional
 * parts ("... and fifty kobo/cents") are dropped — this is the whole-unit
 * view of `wordsToKobo`. Returns null when nothing parseable is found.
 */
export function wordsToNumber(input: string | null | undefined): number | null {
  const kobo = wordsToKobo(input);
  if (kobo === null) return null;
  // Truncate toward zero to whole currency units.
  return Number(kobo / 100n);
}

/**
 * Deterministic Bill of Quantities arithmetic verification.
 * All findings are exact, reproducible, and require no LLM. Rows that pass
 * every check produce no finding. All money comparison and summation runs in
 * integer kobo (FR-BOQ-01) — no binary floating point in money paths — and
 * `tolerance` (an absolute currency amount) defaults to ZERO: one kobo of
 * drift is a finding unless the caller explicitly allows slack.
 */
export function runBoqChecks(
  rows: BoqRow[],
  grandTotal?: number | null,
  tolerance = 0,
): BoqRunResult {
  const findings: BoqFinding[] = [];
  const tolKobo = toKobo(Math.max(0, tolerance)) ?? 0n;
  let grandTotalKobo = 0n;

  // Sum of computed line extensions per section (in kobo), plus any declared
  // section subtotal rows, used for the section_total check after the loop.
  const sectionSums = new Map<string, bigint>();
  const subtotalRows: {
    lineRef: string | null;
    description: string | null;
    section: string;
    declared: number;
    declaredKobo: bigint;
  }[] = [];
  const addToSection = (
    section: string | null | undefined,
    amountKobo: bigint,
  ) => {
    if (section == null || section === "") return;
    sectionSums.set(section, (sectionSums.get(section) ?? 0n) + amountKobo);
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
        declaredKobo: toKobo(extension as number) ?? 0n,
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
        quantityRaw: quantity == null ? null : String(quantity),
        unitRateKobo:
          unitRate == null ? null : koboToSafeNumber(toKobo(unitRate)),
        extensionKobo:
          extension == null ? null : koboToSafeNumber(toKobo(extension)),
        computedExtensionKobo: null,
        checkType: "blank_line",
        finding: "Priced line has no quantity, rate, or extension.",
        severity: "likely_fatal",
        status: "flagged",
      });
      continue;
    }

    let computedExtension: number | null = null;
    if (hasQty && hasRate) {
      // Exact product of the submitted decimals, rounded half-away to kobo.
      const computedKobo = mulToKobo(quantity, unitRate) ?? 0n;
      computedExtension = koboToNumber(computedKobo);
      grandTotalKobo += computedKobo;
      addToSection(row.section, computedKobo);

      if (hasExt) {
        const extKobo = toKobo(extension) ?? 0n;
        const deltaKobo = extKobo - computedKobo;
        if (koboAbs(deltaKobo) > tolKobo) {
          findings.push({
            lineRef,
            description,
            quantity,
            unitRate,
            extension,
            computedExtension,
            quantityRaw: quantity == null ? null : String(quantity),
            unitRateKobo:
              unitRate == null ? null : koboToSafeNumber(toKobo(unitRate)),
            extensionKobo:
              extension == null ? null : koboToSafeNumber(toKobo(extension)),
            computedExtensionKobo: koboToSafeNumber(computedKobo),
            checkType: "extension_mismatch",
            finding: `Extension ${extension} does not equal quantity × rate (${koboDisplay(
              computedKobo,
            )}); difference ${koboDisplay(deltaKobo)}.`,
            severity: "likely_fatal",
            status: "flagged",
          });
        }
      }
    } else if (hasExt) {
      const extKobo = toKobo(extension) ?? 0n;
      grandTotalKobo += extKobo;
      addToSection(row.section, extKobo);
    }

    // Suspicious zero: priced line with a description but zero/blank rate.
    if (
      description &&
      description.trim().length > 0 &&
      hasRate &&
      unitRate === 0
    ) {
      findings.push({
        lineRef,
        description,
        quantity,
        unitRate,
        extension,
        computedExtension,
        quantityRaw: quantity == null ? null : String(quantity),
        unitRateKobo:
          unitRate == null ? null : koboToSafeNumber(toKobo(unitRate)),
        extensionKobo:
          extension == null ? null : koboToSafeNumber(toKobo(extension)),
        computedExtensionKobo:
          computedExtension == null
            ? null
            : koboToSafeNumber(toKobo(computedExtension)),
        checkType: "suspicious_zero",
        finding: "Line item has a description but a zero unit rate.",
        severity: "scoring_risk",
        status: "flagged",
      });
    }

    // Words-vs-figures: the amount-in-words must equal the line figure,
    // compared in integer kobo so spelled-out kobo are honoured exactly.
    if (row.amountInWords && row.amountInWords.trim().length > 0) {
      const figure = hasExt ? extension : computedExtension;
      const figureKobo = figure != null ? toKobo(figure) : null;
      const wordsKobo = wordsToKobo(row.amountInWords);
      if (
        figureKobo != null &&
        wordsKobo != null &&
        koboAbs(figureKobo - wordsKobo) > tolKobo
      ) {
        findings.push({
          lineRef,
          description,
          quantity,
          unitRate,
          extension,
          computedExtension,
          quantityRaw: quantity == null ? null : String(quantity),
          unitRateKobo:
            unitRate == null ? null : koboToSafeNumber(toKobo(unitRate)),
          extensionKobo:
            extension == null ? null : koboToSafeNumber(toKobo(extension)),
          computedExtensionKobo:
            computedExtension == null
              ? null
              : koboToSafeNumber(toKobo(computedExtension)),
          checkType: "words_vs_figures",
          finding: `Amount in words ("${row.amountInWords.trim()}" = ${koboDisplay(
            wordsKobo,
          )}) does not match the figure ${figure}; difference ${koboDisplay(
            figureKobo - wordsKobo,
          )}.`,
          severity: "likely_fatal",
          status: "flagged",
        });
      }
    }
  }

  const computedGrandTotal = koboToNumber(grandTotalKobo);

  // Section totals: each declared section subtotal must equal the sum of its
  // priced line extensions.
  for (const sub of subtotalRows) {
    const summedKobo = sectionSums.get(sub.section) ?? 0n;
    const deltaKobo = sub.declaredKobo - summedKobo;
    if (koboAbs(deltaKobo) > tolKobo) {
      findings.push({
        lineRef: sub.lineRef,
        description: sub.description,
        quantity: null,
        unitRate: null,
        extension: sub.declared,
        computedExtension: koboToNumber(summedKobo),
        quantityRaw: null,
        unitRateKobo: null,
        extensionKobo: koboToSafeNumber(sub.declaredKobo),
        computedExtensionKobo: koboToSafeNumber(summedKobo),
        checkType: "section_total",
        finding: `Declared section total ${sub.declared} for "${sub.section}" does not equal the sum of its line extensions (${koboDisplay(
          summedKobo,
        )}); difference ${koboDisplay(deltaKobo)}.`,
        severity: "likely_fatal",
        status: "flagged",
      });
    }
  }

  if (typeof grandTotal === "number" && Number.isFinite(grandTotal)) {
    const declaredKobo = toKobo(grandTotal) ?? 0n;
    const deltaKobo = declaredKobo - grandTotalKobo;
    if (koboAbs(deltaKobo) > tolKobo) {
      findings.push({
        lineRef: null,
        description: "Grand total",
        quantity: null,
        unitRate: null,
        extension: grandTotal,
        computedExtension: computedGrandTotal,
        quantityRaw: null,
        unitRateKobo: null,
        extensionKobo: koboToSafeNumber(declaredKobo),
        computedExtensionKobo: koboToSafeNumber(grandTotalKobo),
        checkType: "grand_total",
        finding: `Submitted grand total ${grandTotal} does not equal the sum of line extensions (${koboDisplay(
          grandTotalKobo,
        )}); difference ${koboDisplay(deltaKobo)}.`,
        severity: "fatal",
        status: "flagged",
      });
    }
  }

  return { findings, computedGrandTotal };
}
