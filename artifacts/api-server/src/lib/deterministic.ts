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

  for (const row of rows) {
    const lineRef = row.lineRef ?? null;
    const description = row.description ?? null;
    const quantity = row.quantity ?? null;
    const unitRate = row.unitRate ?? null;
    const extension = row.extension ?? null;

    const hasQty = typeof quantity === "number" && Number.isFinite(quantity);
    const hasRate = typeof unitRate === "number" && Number.isFinite(unitRate);
    const hasExt = typeof extension === "number" && Number.isFinite(extension);

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
  }

  computedGrandTotal = round2(computedGrandTotal);

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
  evidence: { requirementId: string; evidenceStatus: string }[];
}

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
 * Deterministic disqualification-risk score. Only defects that are still
 * live (open or suggested) contribute; remediated/waived defects are excluded.
 * A mandatory requirement whose evidence is missing or expired adds a fixed
 * penalty. Bands: critical if any live fatal defect or score >= 70,
 * high >= 40, medium >= 15, otherwise low.
 */
export function computeRisk(input: RiskInput): RiskResult {
  const distribution: Record<Severity, number> = {
    fatal: 0,
    likely_fatal: 0,
    scoring_risk: 0,
    cosmetic: 0,
  };

  const liveDefects = input.defects.filter(
    (d) => d.status === "open" || d.status === "suggested",
  );

  let score = 0;
  let hasFatal = false;
  for (const d of liveDefects) {
    const weight = SEVERITY_WEIGHTS[d.severity] ?? 0;
    score += weight;
    if (d.severity in distribution) distribution[d.severity] += 1;
    if (d.severity === "fatal") hasFatal = true;
  }

  const mandatoryReqIds = new Set(
    input.requirements.filter((r) => r.isMandatory).map((r) => r.id),
  );
  const penalisedReqIds = new Set<string>();
  for (const e of input.evidence) {
    if (
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
