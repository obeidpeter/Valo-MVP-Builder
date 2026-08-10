import assert from "node:assert/strict";
import test from "node:test";
import { sha256Text, type ExactCitation, type SourceDocument } from "./domain";
import { buildEvidenceGraph, type EvidenceGraphInput } from "./evidenceGraph";

const accepted = {
  state: "accepted" as const,
  reviewerId: "reviewer-1",
  reviewedAt: "2026-08-10T09:00:00.000Z",
};

function source(
  sourceId: string,
  versionId: string,
  kind: SourceDocument["kind"],
  content: string,
): SourceDocument {
  return {
    sourceId,
    versionId,
    kind,
    title: sourceId,
    content,
    contentSha256: sha256Text(content),
    capturedAt: "2026-08-10T08:00:00.000Z",
    authority: "authoritative",
    origin: `upload:${sourceId}`,
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
    page: 1,
  };
}

const solicitation = source(
  "solicitation-1",
  "v1",
  "solicitation",
  "Mandatory: provide a current tax clearance certificate.",
);
const companyEvidence = source(
  "company-tax-clearance",
  "v3",
  "company_evidence",
  "Tax clearance certificate. Valid until 2027-12-31.",
);

const validInput: EvidenceGraphInput = {
  asOfDate: "2026-08-10",
  sources: [solicitation, companyEvidence],
  requirements: [
    {
      externalId: "requirement-tax",
      statement: "Provide a current tax clearance certificate.",
      mandatory: true,
      citations: [
        cite(solicitation, "provide a current tax clearance certificate"),
      ],
      review: accepted,
    },
  ],
  evidence: [
    {
      externalId: "evidence-tax",
      evidenceKind: "tax_clearance",
      label: "Current tax clearance",
      validUntil: "2027-12-31",
      citations: [cite(companyEvidence, "Tax clearance certificate")],
      review: accepted,
    },
  ],
  links: [
    {
      externalId: "link-tax",
      requirementExternalId: "requirement-tax",
      evidenceExternalId: "evidence-tax",
      rationale: "The accepted certificate addresses the stated requirement.",
      citations: [cite(companyEvidence, "Tax clearance certificate")],
      review: accepted,
    },
  ],
};

test("accepted, current and exactly cited evidence produces a ready graph", () => {
  const proposed = buildEvidenceGraph(validInput);
  const result = buildEvidenceGraph({
    ...validInput,
    graphReview: { subjectId: proposed.graphId, review: accepted },
  });
  assert.equal(result.status, "ready");
  assert.equal(result.readyForUse, true);
  assert.equal(result.edges[0]?.usable, true);
  assert.equal(result.coverage[0]?.status, "covered");
  assert.equal(result.issues.length, 0);
  assert.match(result.graphId, /^evgraph_[a-f0-9]{24}$/);
  assert.equal(result.edges[0]?.citations[0]?.offsetUnit, "utf16_code_unit");
});

test("graph identity is deterministic and independent of source order", () => {
  const first = buildEvidenceGraph(validInput);
  const second = buildEvidenceGraph({
    ...validInput,
    sources: [...validInput.sources].reverse(),
  });
  assert.equal(second.graphId, first.graphId);
  assert.deepEqual(second.requirements, first.requirements);
  assert.deepEqual(second.evidence, first.evidence);
});

test("unreviewed links and graph never become usable", () => {
  const result = buildEvidenceGraph({
    ...validInput,
    links: [{ ...validInput.links[0], review: { state: "unreviewed" } }],
  });
  assert.equal(result.status, "review_required");
  assert.equal(result.readyForUse, false);
  assert.equal(result.edges[0]?.usable, false);
  assert.equal(result.coverage[0]?.status, "pending_review");
});

test("a mismatched quote blocks the graph and cannot create an evidence link", () => {
  const citation = validInput.links[0].citations[0];
  const result = buildEvidenceGraph({
    ...validInput,
    links: [
      {
        ...validInput.links[0],
        citations: [{ ...citation, quote: "Tax clearance certifikate" }],
      },
    ],
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.readyForUse, false);
  assert.equal(result.edges.length, 0);
  assert.equal(
    result.issues.some((issue) => issue.code === "citation_quote_mismatch"),
    true,
  );
});

test("expired evidence remains visible but never usable", () => {
  const result = buildEvidenceGraph({
    ...validInput,
    evidence: [{ ...validInput.evidence[0], validUntil: "2025-12-31" }],
  });
  assert.equal(result.evidence[0]?.validity, "expired");
  assert.equal(result.edges[0]?.usable, false);
  assert.equal(result.readyForUse, false);
});
