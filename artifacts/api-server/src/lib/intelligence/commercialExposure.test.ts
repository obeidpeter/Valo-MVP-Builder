import assert from "node:assert/strict";
import { test } from "node:test";
import { sha256Text, type HumanReview, type SourceDocument } from "./domain";
import {
  buildCommercialExposureProjection,
  type CommercialExposureInput,
} from "./commercialExposure";

const ACCEPTED: HumanReview = {
  state: "accepted",
  reviewerId: "finance-reviewer",
  reviewedAt: "2026-08-10T10:00:00.000Z",
};

function source(
  sourceId: string,
  kind: SourceDocument["kind"],
  content: string,
  authority: SourceDocument["authority"] = "authoritative",
): SourceDocument {
  return {
    sourceId,
    versionId: "v1",
    kind,
    title: `${sourceId}.txt`,
    content,
    contentSha256: sha256Text(content),
    capturedAt: "2026-08-10T09:00:00.000Z",
    authority,
    origin: "controlled-test-fixture",
  };
}

function citation(item: SourceDocument, quote: string) {
  const startOffset = item.content.indexOf(quote);
  assert.notEqual(startOffset, -1);
  return {
    sourceId: item.sourceId,
    sourceVersionId: item.versionId,
    contentSha256: item.contentSha256,
    startOffset,
    endOffset: startOffset + quote.length,
    quote,
  };
}

function fixture(): CommercialExposureInput {
  const tender = source(
    "commercial-terms",
    "solicitation",
    "Tender term mobilisation inflow: Mobilisation payment is 100000.00 NGN on day 0. Tender term payment inflow: Interim payment is 300000.00 NGN on day 30. Tender term retention hold outflow: Retention hold is 50000.00 NGN on day 30.",
  );
  const company = source(
    "finance-assumptions",
    "company_evidence",
    "Opening working capital is 200000.00 NGN. Company assumption project cost outflow: Project delivery cost is 400000.00 NGN on day 10.",
    "corroborating",
  );
  return {
    policyVersion: "cashflow-ngn-v1",
    currencyMinorDigits: { NGN: 2 },
    sources: [tender, company],
    openingBalances: [
      {
        externalId: "opening-ngn",
        currency: "NGN",
        amountDecimal: "200000.00",
        citations: [
          citation(company, "Opening working capital is 200000.00 NGN."),
        ],
        review: ACCEPTED,
      },
    ],
    events: [
      {
        externalId: "mobilisation",
        label: "Mobilisation payment",
        eventType: "mobilisation",
        basis: "tender_term",
        direction: "inflow",
        currency: "NGN",
        amountDecimal: "100000.00",
        dayOffset: 0,
        timingText: "day 0",
        sourceTermText:
          "Tender term mobilisation inflow: Mobilisation payment is 100000.00 NGN on day 0.",
        citations: [
          citation(
            tender,
            "Tender term mobilisation inflow: Mobilisation payment is 100000.00 NGN on day 0.",
          ),
        ],
        review: ACCEPTED,
      },
      {
        externalId: "delivery-cost",
        label: "Project delivery cost",
        eventType: "project_cost",
        basis: "company_assumption",
        direction: "outflow",
        currency: "NGN",
        amountDecimal: "400000.00",
        dayOffset: 10,
        timingText: "day 10",
        sourceTermText:
          "Company assumption project cost outflow: Project delivery cost is 400000.00 NGN on day 10.",
        citations: [
          citation(
            company,
            "Company assumption project cost outflow: Project delivery cost is 400000.00 NGN on day 10.",
          ),
        ],
        review: ACCEPTED,
      },
      {
        externalId: "interim-payment",
        label: "Interim payment",
        eventType: "payment",
        basis: "tender_term",
        direction: "inflow",
        currency: "NGN",
        amountDecimal: "300000.00",
        dayOffset: 30,
        timingText: "day 30",
        sourceTermText:
          "Tender term payment inflow: Interim payment is 300000.00 NGN on day 30.",
        citations: [
          citation(
            tender,
            "Tender term payment inflow: Interim payment is 300000.00 NGN on day 30.",
          ),
        ],
        review: ACCEPTED,
      },
      {
        externalId: "retention",
        label: "Retention hold",
        eventType: "retention_hold",
        basis: "tender_term",
        direction: "outflow",
        currency: "NGN",
        amountDecimal: "50000.00",
        dayOffset: 30,
        timingText: "day 30",
        sourceTermText:
          "Tender term retention hold outflow: Retention hold is 50000.00 NGN on day 30.",
        citations: [
          citation(
            tender,
            "Tender term retention hold outflow: Retention hold is 50000.00 NGN on day 30.",
          ),
        ],
        review: ACCEPTED,
      },
    ],
  };
}

test("projects exact cited cashflow by currency and requires exact review", () => {
  const input = fixture();
  const proposed = buildCommercialExposureProjection(input);
  assert.equal(proposed.status, "review_required");
  assert.equal(proposed.exposures.length, 1);
  assert.equal(proposed.exposures[0]?.currency, "NGN");
  assert.equal(proposed.exposures[0]?.openingBalanceMinor, "20000000");
  assert.equal(proposed.exposures[0]?.closingBalanceMinor, "15000000");
  assert.equal(proposed.exposures[0]?.peakFundingRequirementMinor, "10000000");
  assert.deepEqual(
    proposed.exposures[0]?.points.map((point) => [
      point.dayOffset,
      point.deltaMinor,
      point.cumulativeBalanceMinor,
    ]),
    [
      [0, "10000000", "30000000"],
      [10, "-40000000", "-10000000"],
      [30, "25000000", "15000000"],
    ],
  );
  assert.equal(proposed.financingDecisionAuthorized, false);
  assert.equal(proposed.priceChangeAuthorized, false);
  assert.equal(proposed.taxOrLegalAdvice, false);
  assert.equal(proposed.safety.commercialDecisionAuthorized, false);

  const accepted = buildCommercialExposureProjection({
    ...input,
    projectionReview: { subjectId: proposed.projectionId, review: ACCEPTED },
  });
  assert.equal(accepted.status, "ready");
  assert.equal(accepted.readyForFinanceReview, true);
});

test("excludes an unreviewed event instead of presenting it as cashflow", () => {
  const input = fixture();
  const result = buildCommercialExposureProjection({
    ...input,
    events: input.events.map((event) =>
      event.externalId === "delivery-cost"
        ? { ...event, review: { state: "unreviewed" as const } }
        : event,
    ),
  });
  assert.equal(result.status, "review_required");
  assert.equal(
    result.events.find((event) => event.externalId === "delivery-cost")
      ?.includedInProjection,
    false,
  );
  assert.equal(result.exposures[0]?.peakFundingRequirementMinor, "0");
  assert.equal(result.readyForFinanceReview, false);
});

test("does not infer a zero opening balance for a new currency", () => {
  const base = fixture();
  const usdRule = source(
    "usd-term",
    "addendum",
    "Tender term other outflow: Foreign licence payment is 1000.00 USD on day 5.",
  );
  const result = buildCommercialExposureProjection({
    ...base,
    currencyMinorDigits: { NGN: 2, USD: 2 },
    sources: [...base.sources, usdRule],
    events: [
      ...base.events,
      {
        externalId: "usd-licence",
        label: "Foreign licence payment",
        eventType: "other",
        basis: "tender_term",
        direction: "outflow",
        currency: "USD",
        amountDecimal: "1000.00",
        dayOffset: 5,
        timingText: "day 5",
        sourceTermText:
          "Tender term other outflow: Foreign licence payment is 1000.00 USD on day 5.",
        citations: [
          citation(
            usdRule,
            "Tender term other outflow: Foreign licence payment is 1000.00 USD on day 5.",
          ),
        ],
        review: ACCEPTED,
      },
    ],
  });
  assert.equal(result.status, "incomplete");
  assert.deepEqual(result.currenciesMissingOpeningBalance, ["USD"]);
  assert.equal(
    result.exposures.some((exposure) => exposure.currency === "USD"),
    false,
  );
  assert.equal(result.mixedCurrencyNoFx, true);
});

test("rejects tender terms cited only to company assumptions", () => {
  const input = fixture();
  const company = input.sources[1]!;
  const result = buildCommercialExposureProjection({
    ...input,
    events: [
      {
        ...input.events[0]!,
        label: "Project delivery cost",
        amountDecimal: "400000.00",
        dayOffset: 10,
        timingText: "day 10",
        sourceTermText:
          "Company assumption project cost outflow: Project delivery cost is 400000.00 NGN on day 10.",
        citations: [
          citation(
            company,
            "Company assumption project cost outflow: Project delivery cost is 400000.00 NGN on day 10.",
          ),
        ],
      },
    ],
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.events.length, 0);
  assert.ok(
    result.issues.some(
      (issue) => issue.code === "commercial_event_source_invalid",
    ),
  );
});

test("rejects an amount that would require hidden currency rounding", () => {
  const input = fixture();
  const tender = source(
    "fractional-term",
    "solicitation",
    "Tender term mobilisation inflow: Fractional payment is 1.001 NGN on day 1.",
  );
  const result = buildCommercialExposureProjection({
    ...input,
    sources: [...input.sources, tender],
    events: [
      {
        ...input.events[0]!,
        externalId: "fractional-payment",
        amountDecimal: "1.001",
        dayOffset: 1,
        timingText: "day 1",
        sourceTermText:
          "Tender term mobilisation inflow: Fractional payment is 1.001 NGN on day 1.",
        citations: [
          citation(
            tender,
            "Tender term mobilisation inflow: Fractional payment is 1.001 NGN on day 1.",
          ),
        ],
      },
    ],
  });
  assert.equal(result.status, "blocked");
  assert.ok(
    result.issues.some((issue) => issue.code === "invalid_commercial_amount"),
  );
});

test("rejects event direction and day values absent from the exact citation", () => {
  const input = fixture();
  const result = buildCommercialExposureProjection({
    ...input,
    events: [
      {
        ...input.events[0]!,
        direction: "outflow",
        dayOffset: 1,
      },
    ],
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.events.length, 0);
  assert.ok(
    result.issues.some(
      (issue) => issue.code === "commercial_event_facts_not_cited",
    ),
  );
});

test("does not accept a decimal as a substring of a larger cited amount", () => {
  const input = fixture();
  const tender = source(
    "amount-substring-term",
    "solicitation",
    "Tender term mobilisation inflow: Mobilisation payment is 1000 NGN on day 0.",
  );
  const result = buildCommercialExposureProjection({
    ...input,
    sources: [...input.sources, tender],
    events: [
      {
        ...input.events[0]!,
        amountDecimal: "100",
        sourceTermText: tender.content,
        citations: [citation(tender, tender.content)],
      },
    ],
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.events.length, 0);
  assert.ok(
    result.issues.some(
      (issue) => issue.code === "commercial_event_facts_not_cited",
    ),
  );
});

test("does not accept day one from a cited day ten", () => {
  const input = fixture();
  const result = buildCommercialExposureProjection({
    ...input,
    events: [{ ...input.events[1]!, dayOffset: 1 }],
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.events.length, 0);
  assert.ok(
    result.issues.some(
      (issue) => issue.code === "commercial_event_facts_not_cited",
    ),
  );
});

test("does not launder company assumptions through mixed source kinds", () => {
  const input = fixture();
  const tenderLikeAssumption = source(
    "tender-like-assumption",
    "solicitation",
    "Company assumption project cost outflow: Project delivery cost is 400000.00 NGN on day 10.",
  );
  const irrelevantCompany = source(
    "irrelevant-company-record",
    "company_evidence",
    "Registered office record only.",
    "corroborating",
  );
  const result = buildCommercialExposureProjection({
    ...input,
    sources: [...input.sources, tenderLikeAssumption, irrelevantCompany],
    events: [
      {
        ...input.events[1]!,
        citations: [
          citation(tenderLikeAssumption, tenderLikeAssumption.content),
          citation(irrelevantCompany, irrelevantCompany.content),
        ],
      },
    ],
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.events.length, 0);
  assert.ok(
    result.issues.some(
      (issue) => issue.code === "commercial_event_source_invalid",
    ),
  );
});

test("projection identity is deterministic across input order", () => {
  const input = fixture();
  const baseline = buildCommercialExposureProjection(input);
  const reordered = buildCommercialExposureProjection({
    ...input,
    sources: [...input.sources].reverse(),
    openingBalances: [...input.openingBalances].reverse(),
    events: [...input.events].reverse(),
  });
  assert.equal(reordered.projectionId, baseline.projectionId);
  assert.deepEqual(reordered.exposures, baseline.exposures);
});

test("projection identity binds the reviewed decimal display value", () => {
  const input = fixture();
  const dualDisplay = source(
    "dual-display-opening",
    "company_evidence",
    "Opening working capital is 200000.00 NGN, displayed as 200000.0 NGN.",
    "corroborating",
  );
  const baseline = buildCommercialExposureProjection({
    ...input,
    sources: [...input.sources, dualDisplay],
    openingBalances: [
      {
        ...input.openingBalances[0]!,
        citations: [citation(dualDisplay, dualDisplay.content)],
      },
    ],
  });
  const changed = buildCommercialExposureProjection({
    ...input,
    sources: [...input.sources, dualDisplay],
    openingBalances: [
      {
        ...input.openingBalances[0]!,
        amountDecimal: "200000.0",
        citations: [citation(dualDisplay, dualDisplay.content)],
      },
    ],
  });
  assert.equal(changed.status, "review_required");
  assert.equal(
    changed.openingBalances[0]?.amountMinor,
    baseline.openingBalances[0]?.amountMinor,
  );
  assert.notEqual(
    changed.openingBalances[0]?.openingBalanceId,
    baseline.openingBalances[0]?.openingBalanceId,
  );
  assert.notEqual(changed.projectionId, baseline.projectionId);
});

test("a finance review cannot transfer when event timing changes", () => {
  const input = fixture();
  const baseline = buildCommercialExposureProjection(input);
  const changed = buildCommercialExposureProjection({
    ...input,
    events: input.events.map((event) =>
      event.externalId === "delivery-cost"
        ? { ...event, dayOffset: 11 }
        : event,
    ),
    projectionReview: { subjectId: baseline.projectionId, review: ACCEPTED },
  });
  assert.equal(changed.status, "blocked");
  assert.equal(changed.readyForFinanceReview, false);
  assert.ok(
    changed.issues.some((issue) => issue.code === "review_subject_mismatch"),
  );
});

test("a finance review cannot transfer to a different named item reviewer", () => {
  const input = fixture();
  const baseline = buildCommercialExposureProjection(input);
  const changed = buildCommercialExposureProjection({
    ...input,
    events: input.events.map((event) =>
      event.externalId === "delivery-cost"
        ? {
            ...event,
            review: { ...ACCEPTED, reviewerId: "finance-reviewer-2" },
          }
        : event,
    ),
    projectionReview: { subjectId: baseline.projectionId, review: ACCEPTED },
  });
  assert.equal(changed.status, "blocked");
  assert.ok(
    changed.issues.some((issue) => issue.code === "review_subject_mismatch"),
  );
});
