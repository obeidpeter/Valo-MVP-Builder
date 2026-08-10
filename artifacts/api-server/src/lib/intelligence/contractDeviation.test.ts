import assert from "node:assert/strict";
import test from "node:test";
import { sha256Text, type ExactCitation, type SourceDocument } from "./domain";
import { compareTenderToContract } from "./contractDeviation";

const accepted = {
  state: "accepted" as const,
  reviewerId: "legal-1",
  reviewedAt: "2026-08-10T10:00:00.000Z",
};
function source(
  id: string,
  content: string,
  kind: SourceDocument["kind"] = "other",
): SourceDocument {
  return {
    sourceId: id,
    versionId: "v1",
    kind,
    title: id,
    content,
    contentSha256: sha256Text(content),
    capturedAt: "2026-08-09T10:00:00.000Z",
    authority: "authoritative",
    origin: `record:${id}`,
  };
}
function cite(item: SourceDocument): ExactCitation {
  return {
    sourceId: item.sourceId,
    sourceVersionId: item.versionId,
    contentSha256: item.contentSha256,
    startOffset: 0,
    endOffset: item.content.length,
    quote: item.content,
  };
}
const solicitation = source(
  "solicitation",
  "Payment is due within 30 days.",
  "solicitation",
);
const contract = source("contract", "Payment is due within 60 days.");
const input = {
  sources: [solicitation, contract],
  clauses: [
    {
      externalId: "payment-solicitation",
      stage: "solicitation" as const,
      topic: "payment",
      text: solicitation.content,
      citation: cite(solicitation),
      review: accepted,
    },
    {
      externalId: "payment-contract",
      stage: "draft_contract" as const,
      topic: "payment",
      text: contract.content,
      citation: cite(contract),
      review: accepted,
    },
  ],
};

test("surfaces a cited tender-to-contract change without accepting it", () => {
  const first = compareTenderToContract(input);
  const deviationId = first.deviations[0]?.deviationId;
  assert.ok(deviationId);
  const ready = compareTenderToContract({
    ...input,
    deviationReviews: { [deviationId]: accepted },
  });
  assert.equal(ready.status, "ready");
  assert.equal(ready.deviations[0]?.classification, "changed");
  assert.equal(ready.deviations[0]?.acceptedAsTerm, false);
  assert.equal(ready.contractualAcceptanceAuthority, "none");
});

test("identical clauses do not create a false deviation", () => {
  const identicalContract = source("contract-identical", solicitation.content);
  const result = compareTenderToContract({
    sources: [solicitation, identicalContract],
    clauses: [
      input.clauses[0],
      {
        ...input.clauses[1],
        text: solicitation.content,
        citation: cite(identicalContract),
      },
    ],
  });
  assert.equal(result.deviations.length, 0);
  assert.equal(result.status, "review_required");
});

test("blocks clause text that is not exact source content", () => {
  const result = compareTenderToContract({
    ...input,
    clauses: [
      { ...input.clauses[0], text: "Payment is immediate." },
      input.clauses[1],
    ],
  });
  assert.equal(result.status, "blocked");
  assert.equal(
    result.issues.some((issue) => issue.code === "contract_clause_not_exact"),
    true,
  );
});

test("blocks unverified or mislabeled document-stage provenance", () => {
  const result = compareTenderToContract({
    ...input,
    sources: [{ ...solicitation, authority: "unverified" as const }, contract],
  });
  assert.equal(result.status, "blocked");
  assert.equal(
    result.issues.some(
      (issue) => issue.code === "contract_clause_metadata_not_grounded",
    ),
    true,
  );
});

test("a deviation review cannot transfer to differently reviewed clauses", () => {
  const first = compareTenderToContract(input);
  const deviationId = first.deviations[0]?.deviationId;
  assert.ok(deviationId);
  const changed = compareTenderToContract({
    ...input,
    clauses: [
      { ...input.clauses[0], review: { ...accepted, reviewerId: "legal-2" } },
      input.clauses[1],
    ],
    deviationReviews: { [deviationId]: accepted },
  });
  assert.notEqual(changed.deviations[0]?.deviationId, deviationId);
  assert.equal(changed.status, "blocked");
});

test("detects an omitted baseline clause and a new comparison obligation", () => {
  const warranty = source(
    "solicitation-warranty",
    "A two-year warranty is required.",
    "solicitation",
  );
  const insurance = source(
    "draft-contract-insurance",
    "New cyber insurance is required.",
  );
  const result = compareTenderToContract({
    sources: [warranty, insurance],
    baselineStage: "solicitation",
    comparisonStage: "draft_contract",
    clauses: [
      {
        externalId: "warranty-solicitation",
        stage: "solicitation",
        topic: "warranty",
        text: warranty.content,
        citation: cite(warranty),
        review: accepted,
      },
      {
        externalId: "insurance-contract",
        stage: "draft_contract",
        topic: "insurance",
        text: insurance.content,
        citation: cite(insurance),
        review: accepted,
      },
    ],
  });
  assert.deepEqual(
    result.deviations.map((deviation) => deviation.classification).sort(),
    ["new_obligation", "omitted"],
  );
  assert.equal(result.status, "review_required");
});

test("does not infer obligations from a missing compared document snapshot", () => {
  const result = compareTenderToContract({
    sources: [contract],
    baselineStage: "solicitation",
    comparisonStage: "draft_contract",
    clauses: [input.clauses[1]],
  });
  assert.equal(result.status, "blocked");
  assert.equal(
    result.issues.some(
      (issue) => issue.code === "contract_comparison_snapshot_missing",
    ),
    true,
  );
});
