import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateJurisdictionRules,
  selectMonetaryBand,
  type JurisdictionRule,
} from "./jurisdictionRules";

const rule = (overrides: Partial<JurisdictionRule> = {}): JurisdictionRule => ({
  ruleId: "NG-PROC-THRESH-2025-05",
  domain: "procurement_threshold",
  jurisdiction: "NG-FED",
  effectiveFrom: "2025-05-01",
  effectiveTo: null,
  entityScope: ["federal_procuring_entity"],
  categoryScope: ["works"],
  legalReviewStatus: "verified_official_signed_table",
  severity: "advisory_requires_human_approval",
  enabled: true,
  sourceUrls: ["https://example.test/primary"],
  ...overrides,
});

test("rules are effective-dated, jurisdiction-scoped, and advisory", () => {
  const [result] = evaluateJurisdictionRules([rule()], {
    at: "2026-08-08T00:00:00Z",
    jurisdiction: "NG-FED",
    entityScopes: ["federal_procuring_entity"],
    categoryScopes: ["works"],
  });
  assert.equal(result.applicable, true);
  assert.equal(result.manualReviewRequired, true);
  assert.equal(result.sourceUrls.length, 1);
});

test("pre-effective, state, and category mismatches do not apply", () => {
  const contexts = [
    {
      at: "2025-04-30T00:00:00Z",
      jurisdiction: "NG-FED",
      entityScopes: ["federal_procuring_entity"],
      categoryScopes: ["works"],
    },
    {
      at: "2026-08-08T00:00:00Z",
      jurisdiction: "NG-LA",
      entityScopes: ["state_entity"],
      categoryScopes: ["works"],
    },
    {
      at: "2026-08-08T00:00:00Z",
      jurisdiction: "NG-FED",
      entityScopes: ["federal_procuring_entity"],
      categoryScopes: ["goods"],
    },
  ];
  for (const context of contexts)
    assert.equal(
      evaluateJurisdictionRules([rule()], context)[0]?.applicable,
      false,
    );
});

test("disabled transition rules stay pending legal activation", () => {
  const [result] = evaluateJurisdictionRules(
    [
      rule({
        ruleId: "NG-TAX-WHT-2024-TRANSITION-REVIEW",
        enabled: false,
        legalReviewStatus: "transition_review_required",
      }),
    ],
    {
      at: "2026-08-08T00:00:00Z",
      jurisdiction: "NG-FED",
      entityScopes: ["federal_procuring_entity"],
      categoryScopes: ["works"],
    },
  );
  assert.equal(result.applicable, true);
  assert.equal(result.enabled, false);
  assert.equal(result.manualReviewRequired, true);
});

test("monetary bands use exact minor-unit integers and exclusive ceilings", () => {
  const bands = [
    {
      owner: "MTB",
      category: "works",
      minimumNaira: "5000000000",
      maximumNairaExclusive: "10000000000",
    },
    {
      owner: "FEC",
      category: "works",
      minimumNaira: "10000000000",
      maximumNairaExclusive: null,
    },
  ];
  assert.equal(
    selectMonetaryBand({
      bands,
      category: "works",
      amountMinor: "999999999999",
      minorUnitDigits: 2,
    })?.owner,
    "MTB",
  );
  assert.equal(
    selectMonetaryBand({
      bands,
      category: "works",
      amountMinor: "1000000000000",
      minorUnitDigits: 2,
    })?.owner,
    "FEC",
  );
  assert.equal(
    selectMonetaryBand({
      bands,
      category: "goods",
      amountMinor: "1000000000000",
      minorUnitDigits: 2,
    }),
    null,
  );
});
