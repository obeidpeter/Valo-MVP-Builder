export type BoqExceptionCode =
  | "invalid_decimal"
  | "extension_mismatch"
  | "formula_display_mismatch"
  | "hidden_priced_row"
  | "merged_pricing_cell"
  | "currency_mismatch"
  | "unit_conversion_missing"
  | "unit_conversion_mismatch"
  | "lot_net_mismatch"
  | "discount_mismatch"
  | "taxable_base_mismatch"
  | "vat_mismatch"
  | "wht_rule_disabled"
  | "wht_mismatch"
  | "gross_total_mismatch"
  | "net_payable_mismatch"
  | "bid_security_mismatch";

export interface BoqException {
  code: BoqExceptionCode;
  severity: "fatal" | "likely_fatal" | "scoring_risk";
  lotId: string;
  lineId?: string;
  message: string;
  expectedMinor?: string;
  actualMinor?: string;
}

export interface BoqCommercialLine {
  id: string;
  lotId: string;
  currency: string;
  quantity: string;
  unitRate: string;
  displayedExtension: string;
  formulaExtension?: string | null;
  hidden?: boolean;
  mergedPricingCell?: boolean;
  sourceUnit?: string | null;
  pricingUnit?: string | null;
  conversionNumerator?: string | null;
  conversionDenominator?: string | null;
  convertedQuantity?: string | null;
}

export interface BoqLotSummary {
  lotId: string;
  currency: string;
  declaredNet: string;
  discountRateBasisPoints: number;
  declaredDiscount: string;
  declaredTaxableBase: string;
  vatRateBasisPoints: number;
  declaredVat: string;
  declaredGross: string;
  whtRateBasisPoints?: number;
  declaredWht?: string | null;
  declaredNetPayable: string;
  bidSecurity?: {
    rateBasisPoints: number;
    basis: "net" | "gross";
    declaredAmount: string;
  } | null;
}

export interface BoqRulePolicy {
  rulePackId: string;
  currencyMinorDigits: Record<string, number>;
  permittedRoundingMinor: string;
  vatRateBasisPointsByCurrency: Record<string, number>;
  whtEnabled: boolean;
  whtRateBasisPoints?: number | null;
}

export interface BoqVerificationInput {
  lines: BoqCommercialLine[];
  lots: BoqLotSummary[];
  policy: BoqRulePolicy;
}

export interface BoqVerificationResult {
  passed: boolean;
  exceptions: BoqException[];
  computedLotTotalsMinor: Record<string, string>;
  policyVersion: string;
}

interface Decimal {
  digits: bigint;
  scale: number;
}

const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/;

function parseDecimal(value: string): Decimal | null {
  const match = DECIMAL.exec(value.trim());
  if (!match) return null;
  const [, sign, whole, fraction = ""] = match;
  const digits = BigInt(`${whole}${fraction}`);
  return { digits: sign === "-" ? -digits : digits, scale: fraction.length };
}

function divideRound(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error("A positive denominator is required");
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder * 2n >= denominator) return quotient + 1n;
  if (remainder * 2n <= -denominator) return quotient - 1n;
  return quotient;
}

function rescale(value: Decimal, scale: number): bigint {
  if (value.scale === scale) return value.digits;
  if (value.scale < scale)
    return value.digits * 10n ** BigInt(scale - value.scale);
  return divideRound(value.digits, 10n ** BigInt(value.scale - scale));
}

function moneyMinor(value: string, scale: number): bigint | null {
  const parsed = parseDecimal(value);
  return parsed ? rescale(parsed, scale) : null;
}

function multiplyToMinor(
  quantity: Decimal,
  rate: Decimal,
  minorScale: number,
): bigint {
  return rescale(
    {
      digits: quantity.digits * rate.digits,
      scale: quantity.scale + rate.scale,
    },
    minorScale,
  );
}

function applyBasisPoints(amountMinor: bigint, basisPoints: number): bigint {
  return divideRound(amountMinor * BigInt(Math.trunc(basisPoints)), 10_000n);
}

const abs = (value: bigint): bigint => (value < 0n ? -value : value);

/**
 * Verifies client-supplied BOQ figures only. It never invents quantities,
 * rates, taxes, discounts, exchange rates, or bid-security terms. Every
 * changeable tax convention is supplied by a versioned rule policy.
 */
export function verifyCommercialBoq(
  input: BoqVerificationInput,
): BoqVerificationResult {
  const exceptions: BoqException[] = [];
  const lotTotals = new Map<string, bigint>();
  const add = (finding: BoqException) => exceptions.push(finding);

  for (const line of input.lines) {
    const scale = input.policy.currencyMinorDigits[line.currency];
    if (scale == null) {
      add({
        code: "currency_mismatch",
        severity: "likely_fatal",
        lotId: line.lotId,
        lineId: line.id,
        message: `Currency ${line.currency} is not configured by the selected rule policy.`,
      });
      continue;
    }
    const quantity = parseDecimal(line.quantity);
    const rate = parseDecimal(line.unitRate);
    const displayed = moneyMinor(line.displayedExtension, scale);
    if (!quantity || !rate || displayed == null) {
      add({
        code: "invalid_decimal",
        severity: "likely_fatal",
        lotId: line.lotId,
        lineId: line.id,
        message:
          "Quantity, rate, and extension must be finite base-10 decimals.",
      });
      continue;
    }

    let pricedQuantity = quantity;
    const unitsDiffer = Boolean(
      line.sourceUnit &&
      line.pricingUnit &&
      line.sourceUnit !== line.pricingUnit,
    );
    if (unitsDiffer) {
      const numerator = line.conversionNumerator
        ? parseDecimal(line.conversionNumerator)
        : null;
      const denominator = line.conversionDenominator
        ? parseDecimal(line.conversionDenominator)
        : null;
      const converted = line.convertedQuantity
        ? parseDecimal(line.convertedQuantity)
        : null;
      if (
        !numerator ||
        !denominator ||
        denominator.digits <= 0n ||
        !converted
      ) {
        add({
          code: "unit_conversion_missing",
          severity: "likely_fatal",
          lotId: line.lotId,
          lineId: line.id,
          message:
            "Different source and pricing units require an explicit rational conversion and converted quantity.",
        });
      } else {
        const comparisonScale = 6;
        const sourceScaled = rescale(quantity, comparisonScale);
        const numeratorScaled = rescale(numerator, comparisonScale);
        const denominatorScaled = rescale(denominator, comparisonScale);
        const expectedConverted = divideRound(
          sourceScaled * numeratorScaled,
          denominatorScaled,
        );
        const actualConverted = rescale(converted, comparisonScale);
        if (expectedConverted !== actualConverted) {
          add({
            code: "unit_conversion_mismatch",
            severity: "likely_fatal",
            lotId: line.lotId,
            lineId: line.id,
            message:
              "The declared converted quantity does not match the supplied conversion factor.",
          });
        }
        pricedQuantity = converted;
      }
    }

    const expected = multiplyToMinor(pricedQuantity, rate, scale);
    const tolerance =
      moneyMinor(input.policy.permittedRoundingMinor, scale) ?? 0n;
    if (abs(displayed - expected) > tolerance) {
      add({
        code: "extension_mismatch",
        severity: "likely_fatal",
        lotId: line.lotId,
        lineId: line.id,
        message:
          "Displayed extension does not equal quantity multiplied by the client-supplied rate.",
        expectedMinor: String(expected),
        actualMinor: String(displayed),
      });
    }
    if (line.formulaExtension != null) {
      const formula = moneyMinor(line.formulaExtension, scale);
      if (formula == null || abs(formula - displayed) > tolerance) {
        add({
          code: "formula_display_mismatch",
          severity: "likely_fatal",
          lotId: line.lotId,
          lineId: line.id,
          message:
            "The spreadsheet formula result differs from its displayed/submitted value.",
          expectedMinor: formula == null ? undefined : String(formula),
          actualMinor: String(displayed),
        });
      }
    }
    if (line.hidden && (rate.digits !== 0n || displayed !== 0n)) {
      add({
        code: "hidden_priced_row",
        severity: "likely_fatal",
        lotId: line.lotId,
        lineId: line.id,
        message:
          "A hidden row contains commercial figures and requires explicit review.",
      });
    }
    if (line.mergedPricingCell) {
      add({
        code: "merged_pricing_cell",
        severity: "scoring_risk",
        lotId: line.lotId,
        lineId: line.id,
        message:
          "A merged pricing cell prevents unambiguous row-level verification.",
      });
    }
    lotTotals.set(line.lotId, (lotTotals.get(line.lotId) ?? 0n) + expected);
  }

  for (const lot of input.lots) {
    const scale = input.policy.currencyMinorDigits[lot.currency];
    if (scale == null) {
      add({
        code: "currency_mismatch",
        severity: "likely_fatal",
        lotId: lot.lotId,
        message: `Lot currency ${lot.currency} is not configured.`,
      });
      continue;
    }
    if (
      input.lines.some(
        (line) => line.lotId === lot.lotId && line.currency !== lot.currency,
      )
    ) {
      add({
        code: "currency_mismatch",
        severity: "likely_fatal",
        lotId: lot.lotId,
        message:
          "A lot contains mixed currencies without a client-supplied conversion convention.",
      });
    }
    const tolerance =
      moneyMinor(input.policy.permittedRoundingMinor, scale) ?? 0n;
    const computedNet = lotTotals.get(lot.lotId) ?? 0n;
    const declaredNet = moneyMinor(lot.declaredNet, scale);
    const declaredDiscount = moneyMinor(lot.declaredDiscount, scale);
    const declaredTaxable = moneyMinor(lot.declaredTaxableBase, scale);
    const declaredVat = moneyMinor(lot.declaredVat, scale);
    const declaredGross = moneyMinor(lot.declaredGross, scale);
    const declaredNetPayable = moneyMinor(lot.declaredNetPayable, scale);
    if (
      [
        declaredNet,
        declaredDiscount,
        declaredTaxable,
        declaredVat,
        declaredGross,
        declaredNetPayable,
      ].some((value) => value == null)
    ) {
      add({
        code: "invalid_decimal",
        severity: "likely_fatal",
        lotId: lot.lotId,
        message: "Lot summary contains an invalid decimal.",
      });
      continue;
    }
    const net = declaredNet as bigint;
    const discount = declaredDiscount as bigint;
    const taxable = declaredTaxable as bigint;
    const vat = declaredVat as bigint;
    const gross = declaredGross as bigint;
    const netPayable = declaredNetPayable as bigint;
    if (abs(net - computedNet) > tolerance)
      add({
        code: "lot_net_mismatch",
        severity: "likely_fatal",
        lotId: lot.lotId,
        message: "Declared lot net does not equal verified line extensions.",
        expectedMinor: String(computedNet),
        actualMinor: String(net),
      });
    const expectedDiscount = applyBasisPoints(net, lot.discountRateBasisPoints);
    if (abs(discount - expectedDiscount) > tolerance)
      add({
        code: "discount_mismatch",
        severity: "likely_fatal",
        lotId: lot.lotId,
        message:
          "Declared discount does not match the client-supplied discount percentage.",
        expectedMinor: String(expectedDiscount),
        actualMinor: String(discount),
      });
    const expectedTaxable = net - discount;
    if (abs(taxable - expectedTaxable) > tolerance)
      add({
        code: "taxable_base_mismatch",
        severity: "likely_fatal",
        lotId: lot.lotId,
        message: "Taxable base must keep net and discount separate.",
        expectedMinor: String(expectedTaxable),
        actualMinor: String(taxable),
      });
    const configuredVat =
      input.policy.vatRateBasisPointsByCurrency[lot.currency];
    if (configuredVat !== lot.vatRateBasisPoints)
      add({
        code: "vat_mismatch",
        severity: "likely_fatal",
        lotId: lot.lotId,
        message:
          "The submitted VAT rate differs from the selected effective-dated rule policy.",
      });
    const expectedVat = applyBasisPoints(taxable, lot.vatRateBasisPoints);
    if (abs(vat - expectedVat) > tolerance)
      add({
        code: "vat_mismatch",
        severity: "likely_fatal",
        lotId: lot.lotId,
        message: "Declared VAT does not match the separate taxable base.",
        expectedMinor: String(expectedVat),
        actualMinor: String(vat),
      });
    const expectedGross = taxable + vat;
    if (abs(gross - expectedGross) > tolerance)
      add({
        code: "gross_total_mismatch",
        severity: "likely_fatal",
        lotId: lot.lotId,
        message: "Gross total must equal taxable base plus VAT.",
        expectedMinor: String(expectedGross),
        actualMinor: String(gross),
      });

    let wht = 0n;
    const hasWht = lot.whtRateBasisPoints != null || lot.declaredWht != null;
    if (hasWht && !input.policy.whtEnabled) {
      add({
        code: "wht_rule_disabled",
        severity: "likely_fatal",
        lotId: lot.lotId,
        message:
          "WHT computation is disabled pending legal sign-off for the selected rule pack.",
      });
    } else if (hasWht) {
      const declaredWht = moneyMinor(lot.declaredWht ?? "0", scale);
      const configuredWht = input.policy.whtRateBasisPoints;
      if (
        declaredWht == null ||
        configuredWht == null ||
        lot.whtRateBasisPoints !== configuredWht
      ) {
        add({
          code: "wht_mismatch",
          severity: "likely_fatal",
          lotId: lot.lotId,
          message: "WHT rate or amount does not match the approved policy.",
        });
      } else {
        wht = declaredWht;
        const expectedWht = applyBasisPoints(taxable, configuredWht);
        if (abs(wht - expectedWht) > tolerance)
          add({
            code: "wht_mismatch",
            severity: "likely_fatal",
            lotId: lot.lotId,
            message:
              "WHT deduction does not match the configured taxable basis.",
            expectedMinor: String(expectedWht),
            actualMinor: String(wht),
          });
      }
    }
    if (abs(netPayable - (gross - wht)) > tolerance)
      add({
        code: "net_payable_mismatch",
        severity: "likely_fatal",
        lotId: lot.lotId,
        message:
          "Net payable must treat WHT as a deduction, never an addition to unit price.",
        expectedMinor: String(gross - wht),
        actualMinor: String(netPayable),
      });

    if (lot.bidSecurity) {
      const declaredSecurity = moneyMinor(
        lot.bidSecurity.declaredAmount,
        scale,
      );
      const basis = lot.bidSecurity.basis === "gross" ? gross : net;
      const expectedSecurity = applyBasisPoints(
        basis,
        lot.bidSecurity.rateBasisPoints,
      );
      if (
        declaredSecurity == null ||
        abs(declaredSecurity - expectedSecurity) > tolerance
      )
        add({
          code: "bid_security_mismatch",
          severity: "likely_fatal",
          lotId: lot.lotId,
          message:
            "Bid security does not match the tender-supplied basis and percentage.",
          expectedMinor: String(expectedSecurity),
          actualMinor:
            declaredSecurity == null ? undefined : String(declaredSecurity),
        });
    }
  }

  return {
    passed: exceptions.length === 0,
    exceptions,
    computedLotTotalsMinor: Object.fromEntries(
      [...lotTotals].map(([lot, total]) => [lot, String(total)]),
    ),
    policyVersion: input.policy.rulePackId,
  };
}
