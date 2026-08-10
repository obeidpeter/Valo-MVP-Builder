import assert from "node:assert/strict";
import test from "node:test";
import type { BoundedSourceCitation } from "./boundedMvpContracts";
import { projectSourceBackedBoqSanity } from "./boundedMvpBoqProjection";

const scope = { organisationId: "org-a", projectId: "project-a" };
function citation(quote: string): BoundedSourceCitation {
  return {
    ...scope,
    documentId: "boq",
    documentVersionId: "boq-v1",
    sourceSha256: "f".repeat(64),
    pageNumber: 1,
    quote,
    canonicalPageText: quote,
    lifecycleState: "active",
  };
}

test("projects exact arithmetic only from cited supplied quantities and rates", () => {
  const result = projectSourceBackedBoqSanity({
    ...scope,
    policy: {
      policyVersion: "currency-minor-v1",
      currencyMinorDigits: { NGN: 2 },
    },
    lines: [
      {
        id: "line-1",
        lotId: "lot-1",
        currency: "NGN",
        quantity: "2.5",
        unitRate: "1000.00",
        declaredExtension: "2500.00",
        citation: citation(
          "Item A | quantity 2.5 | unit rate 1000.00 | total 2500.00",
        ),
      },
    ],
  });

  assert.deepEqual(result.projectedTotalsMinor, { "lot-1:NGN": "250000" });
  assert.deepEqual(result.issues, []);
  assert.equal(result.pricingDecisionAuthorized, false);
  assert.deepEqual(result.priceRecommendations, []);
  assert.equal(result.safety.externalAction, "none");
});

test("never invents FX and flags mismatched or ungrounded lines", () => {
  const result = projectSourceBackedBoqSanity({
    ...scope,
    policy: {
      policyVersion: "currency-minor-v1",
      currencyMinorDigits: { NGN: 2, USD: 2 },
    },
    lines: [
      {
        id: "ngn",
        lotId: "lot-1",
        currency: "NGN",
        quantity: "2",
        unitRate: "100.00",
        declaredExtension: "250.00",
        citation: citation("NGN line quantity 2 rate 100.00"),
      },
      {
        id: "usd",
        lotId: "lot-1",
        currency: "USD",
        quantity: "1",
        unitRate: "5.00",
        citation: citation("USD line quantity 1 rate 5.00"),
      },
      {
        id: "invented",
        lotId: "lot-2",
        currency: "NGN",
        quantity: "99",
        unitRate: "10",
        citation: citation("Source line quantity 1 rate 10"),
      },
    ],
  });

  assert.deepEqual(result.projectedTotalsMinor, {
    "lot-1:NGN": "20000",
    "lot-1:USD": "500",
  });
  const codes = result.issues.map((issue) => issue.code);
  assert.equal(codes.includes("declared_extension_mismatch"), true);
  assert.equal(codes.includes("mixed_currency_lot"), true);
  assert.equal(codes.includes("line_values_not_in_source_quote"), true);
});

test("excludes negative commercial inputs from projection", () => {
  const result = projectSourceBackedBoqSanity({
    ...scope,
    policy: { policyVersion: "v1", currencyMinorDigits: { NGN: 2 } },
    lines: [
      {
        id: "negative",
        lotId: "lot",
        currency: "NGN",
        quantity: "1",
        unitRate: "-25",
        citation: citation("quantity 1 unit rate -25"),
      },
    ],
  });
  assert.deepEqual(result.projectedLines, []);
  assert.equal(result.issues[0]?.code, "negative_unit_rate");
});
