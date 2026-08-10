import assert from "node:assert/strict";
import test from "node:test";
import { sha256Text, type ExactCitation, type SourceDocument } from "./domain";
import {
  evaluateEligibilityPassport,
  type EligibilityPassportInput,
} from "./eligibilityPassport";

const accepted = {
  state: "accepted" as const,
  reviewerId: "compliance-officer-1",
  reviewedAt: "2026-08-10T11:00:00.000Z",
};

function source(
  sourceId: string,
  kind: SourceDocument["kind"],
  content: string,
): SourceDocument {
  return {
    sourceId,
    versionId: "v1",
    kind,
    title: sourceId,
    content,
    contentSha256: sha256Text(content),
    capturedAt: "2026-08-10T08:00:00.000Z",
    authority: "authoritative",
    origin: `record:${sourceId}`,
  };
}

function cite(document: SourceDocument, quote: string): ExactCitation {
  const startOffset = document.content.indexOf(quote);
  return {
    sourceId: document.sourceId,
    sourceVersionId: document.versionId,
    contentSha256: document.contentSha256,
    startOffset,
    endOffset: startOffset + quote.length,
    quote,
    page: 2,
  };
}

const tender = source(
  "tender-eligibility",
  "solicitation",
  "Mandatory: provide a current tax clearance certificate in the bidder's legal name.",
);
const certificate = source(
  "tax-certificate",
  "company_evidence",
  "ACME Nigeria Limited tax clearance certificate, valid until 2027-12-31.",
);

const validInput: EligibilityPassportInput = {
  legalEntityName: "ACME Nigeria Limited",
  submissionDate: "2026-08-20",
  sources: [tender, certificate],
  requirements: [
    {
      externalId: "tax-clearance-requirement",
      description: "Provide current tax clearance in the bidder's legal name.",
      evidenceKind: "tax_clearance",
      mandatory: true,
      requiresCurrentOnSubmissionDate: true,
      requiresExactLegalEntityMatch: true,
      citations: [cite(tender, "provide a current tax clearance certificate")],
      review: accepted,
    },
  ],
  artifacts: [
    {
      externalId: "tax-clearance-2027",
      evidenceKind: "tax_clearance",
      label: "Tax clearance certificate",
      issuer: "Recorded issuing authority",
      legalEntityName: "ACME Nigeria Limited",
      validFrom: "2025-01-01",
      validUntil: "2027-12-31",
      citations: [
        cite(certificate, "ACME Nigeria Limited tax clearance certificate"),
      ],
      review: accepted,
    },
  ],
};

test("passport uses only tender-cited criteria and remains unapproved by default", () => {
  const result = evaluateEligibilityPassport(validInput);
  assert.equal(result.criteria[0]?.status, "met");
  assert.equal(result.status, "review_required");
  assert.equal(result.readyForSubmissionUse, false);
  assert.equal(result.review.state, "unreviewed");
  assert.equal(result.issues.length, 0);
});

test("accepting the exact passport ID makes a complete passport ready", () => {
  const proposed = evaluateEligibilityPassport(validInput);
  const result = evaluateEligibilityPassport({
    ...validInput,
    passportReview: { subjectId: proposed.passportId, review: accepted },
  });
  assert.equal(result.status, "ready");
  assert.equal(result.readyForSubmissionUse, true);
});

test("missing tender requirements fail closed instead of inferring a universal list", () => {
  const result = evaluateEligibilityPassport({
    ...validInput,
    requirements: [],
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.readyForSubmissionUse, false);
  assert.equal(
    result.issues.some(
      (issue) => issue.code === "tender_requirements_required",
    ),
    true,
  );
});

test("expired, undated, and wrong-entity artifacts cannot satisfy current criteria", () => {
  const expired = evaluateEligibilityPassport({
    ...validInput,
    artifacts: [{ ...validInput.artifacts[0], validUntil: "2025-12-31" }],
  });
  assert.equal(expired.criteria[0]?.status, "expired");
  assert.equal(expired.status, "incomplete");

  const undated = evaluateEligibilityPassport({
    ...validInput,
    artifacts: [
      {
        ...validInput.artifacts[0],
        validFrom: undefined,
        validUntil: undefined,
      },
    ],
  });
  assert.equal(undated.criteria[0]?.status, "validity_unknown");

  const wrongEntity = evaluateEligibilityPassport({
    ...validInput,
    artifacts: [
      { ...validInput.artifacts[0], legalEntityName: "ACME Holdings Limited" },
    ],
  });
  assert.equal(wrongEntity.criteria[0]?.status, "identity_mismatch");
});

test("a previous approval cannot transfer to a changed passport", () => {
  const first = evaluateEligibilityPassport(validInput);
  const changed = evaluateEligibilityPassport({
    ...validInput,
    legalEntityName: "ACME Nigeria Limited Plc",
    passportReview: { subjectId: first.passportId, review: accepted },
  });
  assert.equal(changed.status, "blocked");
  assert.equal(changed.readyForSubmissionUse, false);
  assert.equal(
    changed.issues.some((issue) => issue.code === "review_subject_mismatch"),
    true,
  );
});

test("company evidence cannot be used as the source of a tender requirement", () => {
  const result = evaluateEligibilityPassport({
    ...validInput,
    requirements: [
      {
        ...validInput.requirements[0],
        citations: [cite(certificate, "tax clearance certificate")],
      },
    ],
  });
  assert.equal(result.status, "blocked");
  assert.equal(
    result.issues.some(
      (issue) => issue.code === "eligibility_requirement_source_invalid",
    ),
    true,
  );
});
