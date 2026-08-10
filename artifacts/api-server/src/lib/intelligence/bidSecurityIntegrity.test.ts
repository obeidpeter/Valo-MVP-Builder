import assert from "node:assert/strict";
import { test } from "node:test";
import { sha256Text, type HumanReview, type SourceDocument } from "./domain";
import {
  evaluateBidSecurityIntegrity,
  type BidSecurityIntegrityInput,
} from "./bidSecurityIntegrity";

const ACCEPTED: HumanReview = {
  state: "accepted",
  reviewerId: "security-reviewer",
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
    title: `${sourceId}.pdf`,
    content,
    contentSha256: sha256Text(content),
    capturedAt: "2026-08-10T09:00:00.000Z",
    authority,
    origin: "controlled-test-fixture",
  };
}

function citation(item: SourceDocument) {
  return {
    sourceId: item.sourceId,
    sourceVersionId: item.versionId,
    contentSha256: item.contentSha256,
    startOffset: 0,
    endOffset: item.content.length,
    quote: item.content,
  };
}

function fixture(): BidSecurityIntegrityInput {
  const tender = source(
    "security-form",
    "solicitation",
    "Road Works Bond requires Ten million naira (1000000000 minor units) NGN for Federal Ministry of Works from a commercial bank, issue not before 2026-08-01 and required valid until 2026-12-31, unconditional and payable on first demand.",
  );
  const instrument = source(
    "bank-instrument",
    "company_evidence",
    "Ten million naira (1000000000 minor units) NGN in favour of Federal Ministry of Works, issued by Zenith Bank, a commercial bank, issue date 2026-08-10 and expiry date 2027-01-15; unconditional and payable on first demand.",
    "corroborating",
  );
  return {
    sources: [tender, instrument],
    requirements: [
      {
        externalId: "road-bond",
        label: "Road Works Bond",
        requiredAmountMinor: "1000000000",
        requiredAmountText: "Ten million naira (1000000000 minor units)",
        currency: "NGN",
        beneficiary: "Federal Ministry of Works",
        permittedIssuerTypes: ["commercial bank"],
        issueNotBefore: "2026-08-01",
        issueNotBeforeText: "issue not before 2026-08-01",
        requiredValidUntil: "2026-12-31",
        requiredValidUntilText: "required valid until 2026-12-31",
        requiredPhrases: ["unconditional", "payable on first demand"],
        citations: [citation(tender)],
        review: ACCEPTED,
      },
    ],
    instruments: [
      {
        externalId: "zenith-bond",
        requirementExternalId: "road-bond",
        statedAmountMinor: "1000000000",
        statedAmountText: "Ten million naira (1000000000 minor units)",
        currency: "NGN",
        beneficiary: "Federal Ministry of Works",
        issuerName: "Zenith Bank",
        issuerType: "commercial bank",
        issueDate: "2026-08-10",
        issueDateText: "issue date 2026-08-10",
        expiryDate: "2027-01-15",
        expiryDateText: "expiry date 2027-01-15",
        citations: [citation(instrument)],
        review: ACCEPTED,
      },
    ],
  };
}

test("checks exact cited instrument facts but still requires desk acceptance", () => {
  const input = fixture();
  const proposed = evaluateBidSecurityIntegrity(input);
  assert.equal(proposed.status, "review_required");
  assert.equal(proposed.checks[0]?.state, "matches");
  assert.deepEqual(proposed.checks[0]?.mismatches, []);
  assert.equal(proposed.instrumentLegallyValidated, false);
  assert.equal(proposed.bankInstructionAuthorized, false);
  assert.equal(proposed.safety.externalAction, "none");
  assert.equal(proposed.safety.requiresNamedHumanApproval, true);

  const accepted = evaluateBidSecurityIntegrity({
    ...input,
    deskReview: { subjectId: proposed.deskId, review: ACCEPTED },
  });
  assert.equal(accepted.status, "ready");
  assert.equal(accepted.readyForHumanDecision, true);
});

test("surfaces amount, validity, and wording mismatches without correcting them", () => {
  const base = fixture();
  const shortInstrument = source(
    "bank-instrument-short",
    "company_evidence",
    "Nine million naira (900000000 minor units) NGN in favour of Federal Ministry of Works, issued by Zenith Bank, a commercial bank, issue date 2026-08-10 and expiry date 2026-11-30.",
    "corroborating",
  );
  const result = evaluateBidSecurityIntegrity({
    ...base,
    sources: [base.sources[0]!, shortInstrument],
    instruments: [
      {
        ...base.instruments[0]!,
        statedAmountMinor: "900000000",
        statedAmountText: "Nine million naira (900000000 minor units)",
        expiryDate: "2026-11-30",
        expiryDateText: "expiry date 2026-11-30",
        citations: [citation(shortInstrument)],
      },
    ],
  });
  assert.equal(result.status, "review_required");
  assert.equal(result.checks[0]?.state, "mismatch");
  assert.deepEqual(result.checks[0]?.mismatches, [
    "amount_mismatch",
    "required_wording_missing",
    "validity_too_short",
  ]);
  assert.equal(result.readyForHumanDecision, false);
});

test("rejects instrument facts cited only to the tender source", () => {
  const input = fixture();
  const tender = input.sources[0]!;
  const result = evaluateBidSecurityIntegrity({
    ...input,
    instruments: [
      {
        ...input.instruments[0]!,
        statedAmountText: "Ten million naira (1000000000 minor units)",
        issuerName: "commercial bank",
        issueDate: "2026-08-01",
        issueDateText: "issue date 2026-08-01",
        expiryDate: "2026-12-31",
        expiryDateText: "expiry date 2026-12-31",
        citations: [citation(tender)],
      },
    ],
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.instruments.length, 0);
  assert.ok(
    result.issues.some(
      (issue) => issue.code === "security_instrument_source_invalid",
    ),
  );
});

test("rejects machine amounts that diverge from the exact cited amount", () => {
  const input = fixture();
  const result = evaluateBidSecurityIntegrity({
    ...input,
    requirements: [{ ...input.requirements[0]!, requiredAmountMinor: "1" }],
    instruments: [{ ...input.instruments[0]!, statedAmountMinor: "1" }],
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.checks.length, 0);
  assert.ok(
    result.issues.some(
      (issue) => issue.code === "security_requirement_facts_not_cited",
    ),
  );
  assert.ok(
    result.issues.some(
      (issue) => issue.code === "security_instrument_facts_not_cited",
    ),
  );
});

test("requires the emitted requirement label in the exact tender citation", () => {
  const input = fixture();
  const result = evaluateBidSecurityIntegrity({
    ...input,
    requirements: [
      { ...input.requirements[0]!, label: "Uncited replacement bond" },
    ],
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.requirements.length, 0);
  assert.ok(
    result.issues.some(
      (issue) => issue.code === "security_requirement_facts_not_cited",
    ),
  );
});

test("bounds optional earliest-issue source text", () => {
  const input = fixture();
  const result = evaluateBidSecurityIntegrity({
    ...input,
    requirements: [
      {
        ...input.requirements[0]!,
        issueNotBeforeText: "x".repeat(20_001),
      },
    ],
  });
  assert.equal(result.status, "blocked");
  assert.ok(
    result.issues.some(
      (issue) =>
        issue.code === "capability_text_limit_exceeded" &&
        issue.path === "requirements[0].issueNotBeforeText",
    ),
  );
});

test("does not launder instrument provenance through a mixed citation set", () => {
  const input = fixture();
  const instrumentLikeTender = source(
    "instrument-like-tender",
    "solicitation",
    input.sources[1]!.content,
  );
  const irrelevantCompany = source(
    "irrelevant-company-record",
    "company_evidence",
    "Registered office record only.",
    "corroborating",
  );
  const result = evaluateBidSecurityIntegrity({
    ...input,
    sources: [...input.sources, instrumentLikeTender, irrelevantCompany],
    instruments: [
      {
        ...input.instruments[0]!,
        citations: [
          citation(instrumentLikeTender),
          citation(irrelevantCompany),
        ],
      },
    ],
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.instruments.length, 0);
  assert.ok(
    result.issues.some(
      (issue) => issue.code === "security_instrument_source_invalid",
    ),
  );
});

test("does not assemble required wording from an unrelated company citation", () => {
  const input = fixture();
  const coreInstrument = source(
    "core-instrument-without-wording",
    "company_evidence",
    "Ten million naira (1000000000 minor units) NGN in favour of Federal Ministry of Works, issued by Zenith Bank, a commercial bank, issue date 2026-08-10 and expiry date 2027-01-15.",
    "corroborating",
  );
  const unrelatedWording = source(
    "unrelated-wording-record",
    "company_evidence",
    "A different instrument is unconditional and payable on first demand.",
    "corroborating",
  );
  const result = evaluateBidSecurityIntegrity({
    ...input,
    sources: [input.sources[0]!, coreInstrument, unrelatedWording],
    instruments: [
      {
        ...input.instruments[0]!,
        citations: [citation(coreInstrument), citation(unrelatedWording)],
      },
    ],
  });
  assert.equal(result.status, "review_required");
  assert.deepEqual(result.checks[0]?.mismatches, ["required_wording_missing"]);
});

test("desk identity is deterministic across source order", () => {
  const input = fixture();
  const baseline = evaluateBidSecurityIntegrity(input);
  const reordered = evaluateBidSecurityIntegrity({
    ...input,
    sources: [...input.sources].reverse(),
  });
  assert.equal(reordered.deskId, baseline.deskId);
  assert.deepEqual(reordered.checks, baseline.checks);
});

test("desk identity binds displayed requirement source text", () => {
  const input = fixture();
  const baseline = evaluateBidSecurityIntegrity(input);
  const changed = evaluateBidSecurityIntegrity({
    ...input,
    requirements: [
      {
        ...input.requirements[0]!,
        requiredValidUntilText: "valid until 2026-12-31",
      },
    ],
  });
  assert.equal(changed.status, "review_required");
  assert.notEqual(
    changed.requirements[0]?.requirementId,
    baseline.requirements[0]?.requirementId,
  );
  assert.notEqual(changed.deskId, baseline.deskId);
});

test("a desk decision does not transfer after an instrument changes", () => {
  const input = fixture();
  const baseline = evaluateBidSecurityIntegrity(input);
  const changed = evaluateBidSecurityIntegrity({
    ...input,
    instruments: [
      {
        ...input.instruments[0]!,
        statedAmountMinor: "900000000",
      },
    ],
    deskReview: { subjectId: baseline.deskId, review: ACCEPTED },
  });
  assert.equal(changed.status, "blocked");
  assert.equal(changed.readyForHumanDecision, false);
  assert.ok(
    changed.issues.some((issue) => issue.code === "review_subject_mismatch"),
  );
});

test("a desk decision does not transfer to a different named item reviewer", () => {
  const input = fixture();
  const baseline = evaluateBidSecurityIntegrity(input);
  const changed = evaluateBidSecurityIntegrity({
    ...input,
    instruments: [
      {
        ...input.instruments[0]!,
        review: { ...ACCEPTED, reviewerId: "second-security-reviewer" },
      },
    ],
    deskReview: { subjectId: baseline.deskId, review: ACCEPTED },
  });
  assert.equal(changed.status, "blocked");
  assert.ok(
    changed.issues.some((issue) => issue.code === "review_subject_mismatch"),
  );
});
