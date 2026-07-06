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

interface ScaledDecimal {
  /** All significant digits as an integer (sign included). */
  digits: bigint;
  /** Number of decimal places `digits` is scaled by. */
  scale: number;
}

const DECIMAL_RE = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/;

/** Parse a finite JS number's decimal string form exactly. */
function parseScaled(value: number): ScaledDecimal | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const m = DECIMAL_RE.exec(String(value));
  if (!m) return null;
  const [, sign, intPart, fracPart = "", expPart] = m;
  let digits = BigInt(intPart + fracPart);
  let scale = fracPart.length;
  const exp = expPart ? Number(expPart) : 0;
  if (exp > 0) {
    if (exp >= scale) {
      digits *= 10n ** BigInt(exp - scale);
      scale = 0;
    } else {
      scale -= exp;
    }
  } else if (exp < 0) {
    scale += -exp;
  }
  return { digits: sign === "-" ? -digits : digits, scale };
}

/** Rescale to `scale` decimal places, rounding half away from zero. */
function rescale(d: ScaledDecimal, scale: number): bigint {
  if (d.scale === scale) return d.digits;
  if (d.scale < scale) return d.digits * 10n ** BigInt(scale - d.scale);
  const divisor = 10n ** BigInt(d.scale - scale);
  const quotient = d.digits / divisor;
  const remainder = d.digits % divisor;
  const half = divisor / 2n;
  if (remainder >= half) return quotient + 1n;
  if (-remainder >= half) return quotient - 1n;
  return quotient;
}

/** A currency amount as integer kobo (half-away-from-zero at 2dp). */
export function toKobo(value: number): bigint | null {
  const scaled = parseScaled(value);
  return scaled === null ? null : rescale(scaled, 2);
}

/** Exact product of two decimal figures, rounded half away from zero to kobo. */
export function mulToKobo(a: number, b: number): bigint | null {
  const sa = parseScaled(a);
  const sb = parseScaled(b);
  if (sa === null || sb === null) return null;
  return rescale({ digits: sa.digits * sb.digits, scale: sa.scale + sb.scale }, 2);
}

/** Kobo back to a display number (exact for any realistic BOQ magnitude). */
export const koboToNumber = (kobo: bigint): number => Number(kobo) / 100;
export const koboToSafeNumber = (kobo: bigint | null): number | null => {
  if (kobo === null) return null;
  const n = Number(kobo);
  if (!Number.isSafeInteger(n)) {
    throw new Error("Currency amount exceeds safe integer range for kobo persistence");
  }
  return n;
};

const koboAbs = (k: bigint): bigint => (k < 0n ? -k : k);
const koboDisplay = (kobo: bigint): string => koboToNumber(kobo).toFixed(2);

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

const FRACTION_MARKERS = new Set(["kobo", "cent", "cents", "centime", "centimes"]);

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
        tok in WORD_UNITS ? WORD_UNITS[tok] : tok in WORD_TENS ? WORD_TENS[tok] : null;
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
  const addToSection = (section: string | null | undefined, amountKobo: bigint) => {
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
        unitRateKobo: unitRate == null ? null : koboToSafeNumber(toKobo(unitRate)),
        extensionKobo: extension == null ? null : koboToSafeNumber(toKobo(extension)),
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
            unitRateKobo: unitRate == null ? null : koboToSafeNumber(toKobo(unitRate)),
            extensionKobo: extension == null ? null : koboToSafeNumber(toKobo(extension)),
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
    if (description && description.trim().length > 0 && hasRate && unitRate === 0) {
      findings.push({
        lineRef,
        description,
        quantity,
        unitRate,
        extension,
        computedExtension,
        quantityRaw: quantity == null ? null : String(quantity),
        unitRateKobo: unitRate == null ? null : koboToSafeNumber(toKobo(unitRate)),
        extensionKobo: extension == null ? null : koboToSafeNumber(toKobo(extension)),
        computedExtensionKobo:
          computedExtension == null ? null : koboToSafeNumber(toKobo(computedExtension)),
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
          unitRateKobo: unitRate == null ? null : koboToSafeNumber(toKobo(unitRate)),
          extensionKobo: extension == null ? null : koboToSafeNumber(toKobo(extension)),
          computedExtensionKobo:
            computedExtension == null ? null : koboToSafeNumber(toKobo(computedExtension)),
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

/**
 * Tunable inputs for the risk engine. These were previously hard-coded
 * constants; they are now admin-configurable (see `lib/appConfig.ts`) and
 * threaded into `computeRisk`. `bandCutoffs` are the minimum scores for each
 * band — what the bands *mean* (and the fatal-forces-critical rule) is fixed.
 */
export interface RiskConfig {
  severityWeights: Record<Severity, number>;
  missingEvidenceWeight: number;
  bandCutoffs: { medium: number; high: number; critical: number };
}

export const DEFAULT_RISK_CONFIG: RiskConfig = {
  severityWeights: {
    fatal: 40,
    likely_fatal: 25,
    scoring_risk: 10,
    cosmetic: 3,
  },
  missingEvidenceWeight: 5,
  bandCutoffs: { medium: 15, high: 40, critical: 70 },
};

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
export function computeRisk(
  input: RiskInput,
  config: RiskConfig = DEFAULT_RISK_CONFIG,
): RiskResult {
  const { severityWeights, missingEvidenceWeight, bandCutoffs } = config;
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
    const weight = severityWeights[d.severity] ?? 0;
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
  score += missingEvidencePenalty * missingEvidenceWeight;

  score = Math.min(100, Math.round(score));

  let band: RiskBand;
  if (hasFatal || score >= bandCutoffs.critical) band = "critical";
  else if (score >= bandCutoffs.high) band = "high";
  else if (score >= bandCutoffs.medium) band = "medium";
  else band = "low";

  const parts: string[] = [];
  parts.push(
    `${liveDefects.length} live defect(s): ${distribution.fatal} fatal, ${distribution.likely_fatal} likely-fatal, ${distribution.scoring_risk} scoring-risk, ${distribution.cosmetic} cosmetic.`,
  );
  if (missingEvidencePenalty > 0) {
    parts.push(
      `${missingEvidencePenalty} missing/expired evidence item(s) at +${missingEvidenceWeight} each.`,
    );
  }
  parts.push(`Computed score ${score}/100 → ${band.toUpperCase()} band.`);
  if (hasFatal) parts.push("At least one fatal defect forces the CRITICAL band.");

  return { score, band, explanation: parts.join(" "), distribution };
}

// ---------------------------------------------------------------------------
// Certificate expiry telemetry (FR-VLT-02)
// ---------------------------------------------------------------------------

/**
 * Expiry bands for vault artefacts, from most to least urgent. Thresholds
 * follow the TRD's alert ladder (T-3 / T-14 / T-30):
 *  - expired:  the expiry date has passed
 *  - critical: expires today or within 3 days
 *  - warning:  expires within 14 days
 *  - upcoming: expires within 30 days, or within the artefact's own
 *              renewal-lead window when that is longer (some certificates
 *              take months to renew)
 *  - ok:       comfortably in date
 *  - unknown:  no parseable expiry date on record
 */
export type ExpiryBand = "expired" | "critical" | "warning" | "upcoming" | "ok" | "unknown";

export interface ExpiryTelemetry {
  band: ExpiryBand;
  /** Whole days until expiry (negative = days since expiry); null if unknown. */
  daysToExpiry: number | null;
}

const MS_PER_DAY = 86_400_000;

/** Truncate a timestamp to a whole UTC day index. */
const utcDay = (ms: number): number => Math.floor(ms / MS_PER_DAY);

/**
 * Deterministic expiry telemetry for a vault artefact. Pure: the reference
 * date is a parameter, so the same inputs always produce the same band.
 * Dates are compared on whole UTC days — an artefact expiring "today" is
 * critical, not expired.
 */
export function computeExpiry(
  expiryDate: string | null | undefined,
  today: Date | string,
  renewalLeadDays?: number | null,
): ExpiryTelemetry {
  const expiryMs = expiryDate ? Date.parse(expiryDate) : NaN;
  const todayMs = typeof today === "string" ? Date.parse(today) : today.getTime();
  if (Number.isNaN(expiryMs) || Number.isNaN(todayMs)) {
    return { band: "unknown", daysToExpiry: null };
  }

  const days = utcDay(expiryMs) - utcDay(todayMs);
  const upcomingWindow = Math.max(30, renewalLeadDays ?? 0);

  let band: ExpiryBand;
  if (days < 0) band = "expired";
  else if (days <= 3) band = "critical";
  else if (days <= 14) band = "warning";
  else if (days <= upcomingWindow) band = "upcoming";
  else band = "ok";

  return { band, daysToExpiry: days };
}

/**
 * Severities that block reviewer sign-off while unresolved. A "likely_fatal"
 * defect is treated as disqualifying for sign-off purposes exactly like a
 * "fatal" one — the doctrine does not let a named reviewer attest to a package
 * that still carries an open showstopper.
 */
export const SIGN_OFF_BLOCKING_SEVERITIES: ReadonlySet<Severity> = new Set([
  "fatal",
  "likely_fatal",
]);

/**
 * Fatal-block invariant (the "process warranty" in code): a report may not be
 * signed off while any confirmed-live fatal or likely-fatal defect remains
 * open. Only defects with status "open" count — "suggested" (unconfirmed AI),
 * "remediated" and "waived" defects never block — mirroring the live-defect
 * semantics `computeRisk` uses so the two deterministic checks can never
 * disagree about what "open" means. Returns the blocking defects (empty when
 * sign-off is permitted); the caller enforces the block with no override path.
 */
export function blockingSignOffDefects<
  T extends { severity: Severity; status: string },
>(defects: T[]): T[] {
  return defects.filter(
    (d) => d.status === "open" && SIGN_OFF_BLOCKING_SEVERITIES.has(d.severity),
  );
}

// ---------------------------------------------------------------------------
// Engagement workflow governance (FR-CSM-01/03, FR-BIL-01, FR-WFM-01)
// ---------------------------------------------------------------------------

export type ProjectStatus =
  | "intake"
  | "extraction"
  | "review"
  | "defects"
  | "reporting"
  | "signed_off"
  | "exported"
  | "archived";

export type SlaClass = "standard" | "live";
export type PaymentStatus = "not_required" | "pending" | "confirmed";
export type ConflictStatus = "clear" | "blocked" | "consented" | "declined";

const STATUS_ORDER: ProjectStatus[] = [
  "intake",
  "extraction",
  "review",
  "defects",
  "reporting",
  "signed_off",
  "exported",
  "archived",
];

const PRODUCTION_STATUSES = new Set<ProjectStatus>([
  "extraction",
  "review",
  "defects",
  "reporting",
  "signed_off",
  "exported",
]);

export interface WorkflowGateInput {
  fromStatus: ProjectStatus;
  toStatus: ProjectStatus;
  reviewerId?: string | null;
  paymentStatus?: PaymentStatus;
  paymentConfirmedByFounder?: boolean;
  paymentConfirmedByAdvisor?: boolean;
  paymentFounderConfirmedBy?: string | null;
  paymentAdvisorConfirmedBy?: string | null;
  conflictStatus?: ConflictStatus;
  physicalArchiveInstruction?: string | null;
}

export interface WorkflowGateResult {
  ok: boolean;
  reason?: string;
}

/**
 * Dual confirmation means two *people*, not two booleans: each leg must carry
 * a server-derived identity and the two identities must differ. A row where
 * both flags are true but an identity is missing (legacy data, or a write
 * path that bypassed the confirmation endpoint) does NOT satisfy the gate.
 */
export function paymentGateSatisfied(input: {
  paymentStatus?: PaymentStatus;
  paymentConfirmedByFounder?: boolean;
  paymentConfirmedByAdvisor?: boolean;
  paymentFounderConfirmedBy?: string | null;
  paymentAdvisorConfirmedBy?: string | null;
}): boolean {
  if (!input.paymentStatus || input.paymentStatus === "not_required") return true;
  return (
    input.paymentStatus === "confirmed" &&
    input.paymentConfirmedByFounder === true &&
    input.paymentConfirmedByAdvisor === true &&
    !!input.paymentFounderConfirmedBy &&
    !!input.paymentAdvisorConfirmedBy &&
    input.paymentFounderConfirmedBy !== input.paymentAdvisorConfirmedBy
  );
}

/**
 * Project state movement is intentionally conservative: normal forward motion
 * can advance one step at a time; remediation can move signed-off-adjacent
 * work back into review/defects/reporting; archive is terminal. Production
 * states also require the TRD control fields that make the process warranty
 * auditable.
 */
export function validateProjectTransition(input: WorkflowGateInput): WorkflowGateResult {
  const fromIndex = STATUS_ORDER.indexOf(input.fromStatus);
  const toIndex = STATUS_ORDER.indexOf(input.toStatus);
  if (fromIndex < 0 || toIndex < 0) return { ok: false, reason: "Unknown project status." };
  if (input.fromStatus === input.toStatus) return { ok: true };
  if (input.fromStatus === "archived") {
    return { ok: false, reason: "Archived engagements cannot be reopened by status edit." };
  }

  const forwardOne = toIndex === fromIndex + 1;
  const remediationBack =
    fromIndex > toIndex && ["review", "defects", "reporting"].includes(input.toStatus);
  const archive = input.toStatus === "archived";
  if (!forwardOne && !remediationBack && !archive) {
    return {
      ok: false,
      reason: `Illegal status transition: ${input.fromStatus} → ${input.toStatus}.`,
    };
  }

  if (PRODUCTION_STATUSES.has(input.toStatus)) {
    if (!input.reviewerId) {
      return { ok: false, reason: "A named reviewer is required before production work starts." };
    }
    if (input.conflictStatus === "blocked" || input.conflictStatus === "declined") {
      return { ok: false, reason: "Conflict check is not clear or consented." };
    }
    if (!paymentGateSatisfied(input)) {
      return { ok: false, reason: "Payment gate is not satisfied by dual confirmation." };
    }
  }

  if (
    (input.toStatus === "exported" || input.toStatus === "archived") &&
    (!input.physicalArchiveInstruction || input.physicalArchiveInstruction.trim().length === 0)
  ) {
    return {
      ok: false,
      reason: "Physical archive return/destroy instruction is required before close/export.",
    };
  }

  return { ok: true };
}

function addBusinessDays(date: Date, days: number): Date {
  const d = new Date(date.getTime());
  let remaining = days;
  while (remaining > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) remaining--;
  }
  return d;
}

export function computeSlaDueAt(start: Date, slaClass: SlaClass): Date {
  if (slaClass === "live") return new Date(start.getTime() + 48 * 60 * 60 * 1000);
  return addBusinessDays(start, 5);
}

export function computeRedTeamDueAt(deadline: string | null | undefined): Date | null {
  if (!deadline) return null;
  const parsed = Date.parse(deadline);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed - 72 * 60 * 60 * 1000);
}
