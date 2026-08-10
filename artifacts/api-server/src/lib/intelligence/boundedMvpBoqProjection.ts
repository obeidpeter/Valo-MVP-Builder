import {
  assertBoundedItems,
  boundedProposalSafety,
  isBoundedCitationValid,
  normalizeBoundedText,
  type BoundedScope,
  type BoundedSourceCitation,
  type ProposalSafetyEnvelope,
} from "./boundedMvpContracts";

export interface SourceBackedBoqLine {
  id: string;
  lotId: string;
  currency: string;
  quantity: string;
  unitRate: string;
  declaredExtension?: string;
  citation: BoundedSourceCitation;
}

export interface BoqProjectionPolicy {
  policyVersion: string;
  currencyMinorDigits: Readonly<Record<string, number>>;
  permittedRoundingMinorByCurrency?: Readonly<Record<string, string>>;
}

export interface SourceBackedBoqProjectionInput extends BoundedScope {
  lines: readonly SourceBackedBoqLine[];
  policy: BoqProjectionPolicy;
}

export type BoqProjectionIssueCode =
  | "duplicate_line_id"
  | "citation_invalid"
  | "line_values_not_in_source_quote"
  | "currency_not_configured"
  | "invalid_decimal"
  | "negative_quantity"
  | "negative_unit_rate"
  | "declared_extension_mismatch"
  | "mixed_currency_lot";

export interface BoqProjectionIssue {
  code: BoqProjectionIssueCode;
  severity: "blocker" | "review";
  lineId?: string;
  lotId?: string;
  message: string;
  expectedMinor?: string;
  actualMinor?: string;
}

export interface ProjectedBoqLine {
  lineId: string;
  lotId: string;
  currency: string;
  suppliedQuantity: string;
  suppliedUnitRate: string;
  projectedExtensionMinor: string;
  citation: BoundedSourceCitation;
}

export interface SourceBackedBoqProjectionResult {
  status: "projection_only";
  policyVersion: string;
  projectedLines: ProjectedBoqLine[];
  projectedTotalsMinor: Record<string, string>;
  issues: BoqProjectionIssue[];
  pricingDecisionAuthorized: false;
  priceRecommendations: [];
  safety: ProposalSafetyEnvelope;
}

interface Decimal {
  digits: bigint;
  scale: number;
}

const MAX_LINES = 1_000;
const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/u;

function quoteContainsDecimal(quote: string, value: string): boolean {
  const sought = value.trim();
  let offset = quote.indexOf(sought);
  while (offset >= 0) {
    const before = offset === 0 ? "" : (quote[offset - 1] ?? "");
    const after = quote[offset + sought.length] ?? "";
    if (!/[\d.,+-]/u.test(before) && !/[\d.,+-]/u.test(after)) return true;
    offset = quote.indexOf(sought, offset + 1);
  }
  return false;
}

function parseDecimal(value: string): Decimal | null {
  if (value.length > 100) return null;
  const match = DECIMAL.exec(value.trim());
  if (!match) return null;
  const [, sign, whole, fraction = ""] = match;
  const digits = BigInt(`${whole}${fraction}`);
  return { digits: sign === "-" ? -digits : digits, scale: fraction.length };
}

function divideRound(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder * 2n >= denominator) return quotient + 1n;
  if (remainder * 2n <= -denominator) return quotient - 1n;
  return quotient;
}

function rescale(value: Decimal, scale: number): bigint {
  if (value.scale === scale) return value.digits;
  if (value.scale < scale) {
    return value.digits * 10n ** BigInt(scale - value.scale);
  }
  return divideRound(value.digits, 10n ** BigInt(value.scale - scale));
}

const absolute = (value: bigint): bigint => (value < 0n ? -value : value);

/**
 * Projects arithmetic from source-backed quantities and client-supplied unit
 * rates. It never proposes a rate, performs FX conversion, applies unstated
 * tax rules, or authorises a commercial decision.
 */
export function projectSourceBackedBoqSanity(
  input: SourceBackedBoqProjectionInput,
): SourceBackedBoqProjectionResult {
  assertBoundedItems("BOQ projection lines", input.lines, MAX_LINES);
  const issues: BoqProjectionIssue[] = [];
  const projectedLines: ProjectedBoqLine[] = [];
  const totals = new Map<string, bigint>();
  const currenciesByLot = new Map<string, Set<string>>();
  const seenLineIds = new Set<string>();

  for (const line of input.lines) {
    if (seenLineIds.has(line.id)) {
      issues.push({
        code: "duplicate_line_id",
        severity: "blocker",
        lineId: line.id,
        lotId: line.lotId,
        message: "BOQ line identifiers must be unique.",
      });
      continue;
    }
    seenLineIds.add(line.id);

    if (!isBoundedCitationValid(line.citation, input)) {
      issues.push({
        code: "citation_invalid",
        severity: "blocker",
        lineId: line.id,
        lotId: line.lotId,
        message:
          "The BOQ line citation is inactive, ungrounded, or outside scope.",
      });
      continue;
    }
    const quote = normalizeBoundedText(line.citation.quote);
    if (
      !quoteContainsDecimal(quote, normalizeBoundedText(line.quantity)) ||
      !quoteContainsDecimal(quote, normalizeBoundedText(line.unitRate))
    ) {
      issues.push({
        code: "line_values_not_in_source_quote",
        severity: "blocker",
        lineId: line.id,
        lotId: line.lotId,
        message:
          "The supplied quantity and unit rate are not both present in the cited line.",
      });
      continue;
    }

    const minorDigits = input.policy.currencyMinorDigits[line.currency];
    if (
      minorDigits === undefined ||
      !Number.isInteger(minorDigits) ||
      minorDigits < 0 ||
      minorDigits > 6
    ) {
      issues.push({
        code: "currency_not_configured",
        severity: "blocker",
        lineId: line.id,
        lotId: line.lotId,
        message: `Currency ${line.currency} lacks a valid minor-unit policy.`,
      });
      continue;
    }

    const quantity = parseDecimal(line.quantity);
    const rate = parseDecimal(line.unitRate);
    const declared = line.declaredExtension
      ? parseDecimal(line.declaredExtension)
      : null;
    if (
      !quantity ||
      !rate ||
      (line.declaredExtension !== undefined && !declared)
    ) {
      issues.push({
        code: "invalid_decimal",
        severity: "blocker",
        lineId: line.id,
        lotId: line.lotId,
        message:
          "Quantity, unit rate, and declared extension must be base-10 decimals.",
      });
      continue;
    }
    if (quantity.digits < 0n) {
      issues.push({
        code: "negative_quantity",
        severity: "blocker",
        lineId: line.id,
        lotId: line.lotId,
        message:
          "A negative quantity requires explicit commercial review and is not projected.",
      });
      continue;
    }
    if (rate.digits < 0n) {
      issues.push({
        code: "negative_unit_rate",
        severity: "blocker",
        lineId: line.id,
        lotId: line.lotId,
        message:
          "A negative supplied unit rate requires explicit commercial review and is not projected.",
      });
      continue;
    }

    const projectedMinor = rescale(
      {
        digits: quantity.digits * rate.digits,
        scale: quantity.scale + rate.scale,
      },
      minorDigits,
    );
    projectedLines.push({
      lineId: line.id,
      lotId: line.lotId,
      currency: line.currency,
      suppliedQuantity: line.quantity,
      suppliedUnitRate: line.unitRate,
      projectedExtensionMinor: String(projectedMinor),
      citation: line.citation,
    });
    const totalKey = `${line.lotId}:${line.currency}`;
    totals.set(totalKey, (totals.get(totalKey) ?? 0n) + projectedMinor);
    currenciesByLot.set(
      line.lotId,
      new Set([...(currenciesByLot.get(line.lotId) ?? []), line.currency]),
    );

    if (declared) {
      const declaredMinor = rescale(declared, minorDigits);
      const toleranceRaw =
        input.policy.permittedRoundingMinorByCurrency?.[line.currency] ?? "0";
      const toleranceDecimal = parseDecimal(toleranceRaw);
      const tolerance = toleranceDecimal
        ? absolute(rescale(toleranceDecimal, minorDigits))
        : 0n;
      if (absolute(declaredMinor - projectedMinor) > tolerance) {
        issues.push({
          code: "declared_extension_mismatch",
          severity: "review",
          lineId: line.id,
          lotId: line.lotId,
          message:
            "The declared extension differs from quantity multiplied by the supplied unit rate.",
          expectedMinor: String(projectedMinor),
          actualMinor: String(declaredMinor),
        });
      }
    }
  }

  for (const [lotId, currencies] of currenciesByLot) {
    if (currencies.size > 1) {
      issues.push({
        code: "mixed_currency_lot",
        severity: "review",
        lotId,
        message:
          "The lot has multiple currencies; totals remain separated and no FX conversion was inferred.",
      });
    }
  }

  return {
    status: "projection_only",
    policyVersion: input.policy.policyVersion,
    projectedLines,
    projectedTotalsMinor: Object.fromEntries(
      [...totals]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => [key, String(value)]),
    ),
    issues,
    pricingDecisionAuthorized: false,
    priceRecommendations: [],
    safety: boundedProposalSafety(),
  };
}
