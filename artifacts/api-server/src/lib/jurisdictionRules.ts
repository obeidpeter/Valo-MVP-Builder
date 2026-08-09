export interface JurisdictionRule {
  ruleId: string;
  domain: string;
  jurisdiction: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  entityScope: string[];
  categoryScope: string[];
  legalReviewStatus: string;
  severity: string;
  enabled: boolean;
  sourceUrls: string[];
  monetaryBands?: {
    currency: string;
    approval?: MonetaryBand[];
    methods?: MonetaryBand[];
    [key: string]: unknown;
  };
}

export interface MonetaryBand {
  owner?: string;
  method?: string;
  category: string;
  minimumNaira: string;
  maximumNairaExclusive: string | null;
}

export interface RuleContext {
  at: string;
  jurisdiction: string;
  entityScopes: string[];
  categoryScopes: string[];
  currency?: string;
  amountMinor?: string;
  minorUnitDigits?: number;
}

export interface RuleAdvisory {
  ruleId: string;
  applicable: boolean;
  enabled: boolean;
  manualReviewRequired: boolean;
  message: string;
  sourceUrls: string[];
}

const jurisdictionsMatch = (rule: string, context: string): boolean =>
  rule === context || (rule === "NG" && context.startsWith("NG-"));

const overlaps = (required: string[], actual: string[]): boolean =>
  required.length === 0 || required.some((value) => actual.includes(value));

/** Returns advisory flags only; it never makes an award, legal, or tax decision. */
export function evaluateJurisdictionRules(
  rules: JurisdictionRule[],
  context: RuleContext,
): RuleAdvisory[] {
  const at = Date.parse(context.at);
  return rules.map((rule) => {
    const from = Date.parse(`${rule.effectiveFrom}T00:00:00Z`);
    const to = rule.effectiveTo
      ? Date.parse(`${rule.effectiveTo}T23:59:59.999Z`)
      : null;
    const applicable =
      Number.isFinite(at) &&
      at >= from &&
      (to === null || at <= to) &&
      jurisdictionsMatch(rule.jurisdiction, context.jurisdiction) &&
      overlaps(rule.entityScope, context.entityScopes) &&
      overlaps(rule.categoryScope, context.categoryScopes);
    const manualReviewRequired =
      applicable &&
      (!rule.enabled ||
        rule.legalReviewStatus.includes("required") ||
        rule.legalReviewStatus.includes("pending") ||
        rule.severity.includes("human") ||
        rule.severity.includes("review"));
    return {
      ruleId: rule.ruleId,
      applicable,
      enabled: rule.enabled,
      manualReviewRequired,
      message: !applicable
        ? "Rule is outside the selected effective date or scope."
        : !rule.enabled
          ? "Rule is disabled pending recorded legal approval."
          : manualReviewRequired
            ? "Rule is advisory and requires a named human review."
            : "Rule applies as a versioned advisory control.",
      sourceUrls: rule.sourceUrls,
    };
  });
}

export function selectMonetaryBand(input: {
  bands: MonetaryBand[];
  category: string;
  amountMinor: string;
  minorUnitDigits: number;
}): MonetaryBand | null {
  if (!/^\d+$/.test(input.amountMinor) || input.minorUnitDigits < 0)
    return null;
  const amountNaira =
    BigInt(input.amountMinor) / 10n ** BigInt(input.minorUnitDigits);
  return (
    input.bands.find((band) => {
      if (band.category !== input.category) return false;
      const minimum = BigInt(band.minimumNaira);
      const maximum =
        band.maximumNairaExclusive == null
          ? null
          : BigInt(band.maximumNairaExclusive);
      return (
        amountNaira >= minimum && (maximum === null || amountNaira < maximum)
      );
    }) ?? null
  );
}
