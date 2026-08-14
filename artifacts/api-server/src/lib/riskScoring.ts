export type Severity = "fatal" | "likely_fatal" | "scoring_risk" | "cosmetic";
export type RiskBand = "low" | "medium" | "high" | "critical";

export interface RiskInput {
  defects: { severity: Severity; status: string }[];
  requirements: { id: string; isMandatory: boolean; reviewStatus: string }[];
  evidence: {
    requirementId: string;
    evidenceStatus: string;
    suggested: boolean;
  }[];
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
      .filter(
        (r) => r.isMandatory && !UNCOUNTED_REVIEW_STATUSES.has(r.reviewStatus),
      )
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
  if (hasFatal)
    parts.push("At least one fatal defect forces the CRITICAL band.");

  return { score, band, explanation: parts.join(" "), distribution };
}

/**
 * Severities that block reviewer sign-off while unresolved. A "likely_fatal"
 * defect is treated as disqualifying for sign-off purposes exactly like a
 * "fatal" one — the doctrine does not let a named reviewer attest to a package
 * that still carries an open showstopper.
 */
export const SIGN_OFF_BLOCKING_SEVERITIES: ReadonlySet<string> = new Set([
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
  T extends { severity: string; status: string },
>(defects: T[]): T[] {
  return defects.filter(
    (d) => d.status === "open" && SIGN_OFF_BLOCKING_SEVERITIES.has(d.severity),
  );
}
