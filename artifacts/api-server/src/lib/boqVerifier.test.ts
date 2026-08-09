import assert from "node:assert/strict";
import test from "node:test";
import { verifyCommercialBoq, type BoqVerificationInput } from "./boqVerifier";

const valid: BoqVerificationInput = {
  policy: {
    rulePackId: "NG-TAX-NTA-2025@2026-01-01",
    currencyMinorDigits: { NGN: 2 },
    permittedRoundingMinor: "0.00",
    vatRateBasisPointsByCurrency: { NGN: 750 },
    whtEnabled: false,
  },
  lines: [
    {
      id: "1",
      lotId: "lot-1",
      currency: "NGN",
      quantity: "2.5",
      unitRate: "1000.00",
      displayedExtension: "2500.00",
      formulaExtension: "2500.00",
    },
    {
      id: "2",
      lotId: "lot-1",
      currency: "NGN",
      quantity: "1",
      unitRate: "1500.00",
      displayedExtension: "1500.00",
    },
  ],
  lots: [
    {
      lotId: "lot-1",
      currency: "NGN",
      declaredNet: "4000.00",
      discountRateBasisPoints: 500,
      declaredDiscount: "200.00",
      declaredTaxableBase: "3800.00",
      vatRateBasisPoints: 750,
      declaredVat: "285.00",
      declaredGross: "4085.00",
      declaredNetPayable: "4085.00",
      bidSecurity: {
        rateBasisPoints: 200,
        basis: "gross",
        declaredAmount: "81.70",
      },
    },
  ],
};

test("a consistent client-supplied BOQ passes exact arithmetic", () => {
  const result = verifyCommercialBoq(valid);
  assert.equal(result.passed, true);
  assert.deepEqual(result.computedLotTotalsMinor, { "lot-1": "400000" });
});

test("all seeded deterministic BOQ defects are detected", () => {
  const seeded: BoqVerificationInput = {
    ...valid,
    lines: [
      {
        ...valid.lines[0],
        displayedExtension: "2500.01",
        formulaExtension: "2500.00",
        hidden: true,
        mergedPricingCell: true,
      },
      { ...valid.lines[1], currency: "USD" },
      {
        id: "3",
        lotId: "lot-1",
        currency: "NGN",
        quantity: "10",
        unitRate: "100",
        displayedExtension: "500",
        sourceUnit: "m",
        pricingUnit: "km",
        conversionNumerator: "1",
        conversionDenominator: "1000",
        convertedQuantity: "5",
      },
    ],
    lots: [
      {
        ...valid.lots[0],
        declaredNet: "9999.00",
        declaredDiscount: "1.00",
        declaredTaxableBase: "9997.00",
        vatRateBasisPoints: 500,
        declaredVat: "1.00",
        declaredGross: "9999.00",
        whtRateBasisPoints: 500,
        declaredWht: "499.85",
        declaredNetPayable: "10497.85",
        bidSecurity: {
          rateBasisPoints: 200,
          basis: "gross",
          declaredAmount: "1.00",
        },
      },
    ],
  };
  const codes = new Set(
    verifyCommercialBoq(seeded).exceptions.map((finding) => finding.code),
  );
  for (const expected of [
    "extension_mismatch",
    "formula_display_mismatch",
    "hidden_priced_row",
    "merged_pricing_cell",
    "currency_mismatch",
    "unit_conversion_mismatch",
    "lot_net_mismatch",
    "discount_mismatch",
    "taxable_base_mismatch",
    "vat_mismatch",
    "wht_rule_disabled",
    "gross_total_mismatch",
    "net_payable_mismatch",
    "bid_security_mismatch",
  ])
    assert.equal(codes.has(expected as never), true, expected);
});

test("WHT is a configured payment deduction, not a unit-price addition", () => {
  const result = verifyCommercialBoq({
    ...valid,
    policy: { ...valid.policy, whtEnabled: true, whtRateBasisPoints: 500 },
    lots: [
      {
        ...valid.lots[0],
        whtRateBasisPoints: 500,
        declaredWht: "190.00",
        declaredNetPayable: "3895.00",
      },
    ],
  });
  assert.equal(result.passed, true);
});

test("missing unit conversion and invalid decimals fail closed", () => {
  const result = verifyCommercialBoq({
    ...valid,
    lines: [
      { ...valid.lines[0], sourceUnit: "m", pricingUnit: "km" },
      { ...valid.lines[1], quantity: "NaN" },
    ],
  });
  const codes = result.exceptions.map((finding) => finding.code);
  assert.equal(codes.includes("unit_conversion_missing"), true);
  assert.equal(codes.includes("invalid_decimal"), true);
});
