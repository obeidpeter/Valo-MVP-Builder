import assert from "node:assert/strict";
import test from "node:test";
import {
  deterministicId,
  resolveSubjectReview,
  sha256Text,
  validateCitation,
  validateHumanReview,
  validateSources,
  type ExactCitation,
  type SourceDocument,
} from "./domain";

const content = "Clause 😀 requires an exact quotation.";
const source: SourceDocument = {
  sourceId: "source-1",
  versionId: "v1",
  kind: "solicitation",
  title: "Tender",
  content,
  contentSha256: sha256Text(content),
  capturedAt: "2026-08-10T08:00:00.000Z",
  authority: "authoritative",
  origin: "upload:source-1",
};

test("citations use exact UTF-16 offsets and immutable source hashes", () => {
  const quote = "😀 requires";
  const startOffset = content.indexOf(quote);
  const citation: ExactCitation = {
    sourceId: source.sourceId,
    sourceVersionId: source.versionId,
    contentSha256: source.contentSha256,
    startOffset,
    endOffset: startOffset + quote.length,
    quote,
  };
  const sourceSet = validateSources([source]);
  const result = validateCitation(citation, sourceSet.byKey, "citation");
  assert.equal(result.issues.length, 0);
  assert.equal(result.citation?.offsetUnit, "utf16_code_unit");
  assert.equal(result.citation?.quote, quote);
});

test("source content changes fail closed against a declared old hash", () => {
  const result = validateSources([
    { ...source, content: `${source.content} changed` },
  ]);
  assert.equal(
    result.issues.some((issue) => issue.code === "source_hash_mismatch"),
    true,
  );
});

test("deterministic IDs canonicalize object keys but preserve array order", () => {
  assert.equal(
    deterministicId("record", { beta: 2, alpha: 1 }),
    deterministicId("record", { alpha: 1, beta: 2 }),
  );
  assert.notEqual(
    deterministicId("record", ["first", "second"]),
    deterministicId("record", ["second", "first"]),
  );
});

test("human decisions require valid state, identity, time, and exact subject", () => {
  const invalidState = validateHumanReview(
    {
      state: "approved" as never,
      reviewerId: "reviewer-1",
      reviewedAt: "2026-08-10T09:00:00.000Z",
    },
    "review",
  );
  assert.equal(
    invalidState.some((issue) => issue.code === "invalid_human_review_state"),
    true,
  );

  const mismatch = resolveSubjectReview(
    "record-current",
    {
      subjectId: "record-old",
      review: {
        state: "accepted",
        reviewerId: "reviewer-1",
        reviewedAt: "2026-08-10T09:00:00.000Z",
      },
    },
    "review",
  );
  assert.equal(
    mismatch.issues.some((issue) => issue.code === "review_subject_mismatch"),
    true,
  );
});
