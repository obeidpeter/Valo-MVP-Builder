import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  groundedEvidenceStatus,
  isQuoteGroundedInSourceMap,
  isSourceQuoteGrounded,
  normalizeSourceText,
} from "./sourceGrounding";

describe("source grounding", () => {
  test("normalizes Unicode compatibility forms, invisible formatting, and whitespace", () => {
    assert.equal(
      normalizeSourceText(
        "  Tax\u00a0clear\u00adance\r\n  certi\u200bficate １２ ",
      ),
      "Tax clearance certificate 12",
    );
  });

  test("accepts only exact normalized substrings", () => {
    const source =
      "Clause 4.2:\nThe bidder shall submit a valid tax clearance certificate.";
    assert.equal(
      isSourceQuoteGrounded(
        source,
        "The bidder shall submit a valid tax clearance certificate.",
      ),
      true,
    );
    assert.equal(
      isSourceQuoteGrounded(
        source,
        "The bidder must submit a valid tax clearance certificate.",
      ),
      false,
    );
    assert.equal(
      isSourceQuoteGrounded(
        source,
        "the bidder shall submit a valid tax clearance certificate.",
      ),
      false,
    );
  });

  test("rejects missing and empty sources or quotes", () => {
    assert.equal(isSourceQuoteGrounded(null, "quote"), false);
    assert.equal(isSourceQuoteGrounded("source", null), false);
    assert.equal(isSourceQuoteGrounded("source", " \n\t "), false);
    assert.equal(isSourceQuoteGrounded(" \n\t ", "quote"), false);
  });

  test("binds a quote to the specifically named in-scope source", () => {
    const sources = new Map([
      ["doc-1", "Submit a tax certificate."],
      ["doc-2", "Submit an audited statement."],
    ]);
    assert.equal(
      isQuoteGroundedInSourceMap(sources, "doc-1", "tax certificate"),
      true,
    );
    assert.equal(
      isQuoteGroundedInSourceMap(sources, "doc-2", "tax certificate"),
      false,
    );
    assert.equal(
      isQuoteGroundedInSourceMap(sources, "outside-project", "tax certificate"),
      false,
    );
  });

  test("downgrades unsupported positive evidence but preserves non-positive statuses", () => {
    const sources = new Map([
      ["bid-1", "Certificate number TCC-123 is valid."],
    ]);
    assert.equal(
      groundedEvidenceStatus("present", sources, "bid-1", "TCC-123 is valid"),
      "present",
    );
    assert.equal(
      groundedEvidenceStatus("present", sources, "bid-1", "TCC-999 is valid"),
      "unclear",
    );
    assert.equal(
      groundedEvidenceStatus(
        "present",
        sources,
        "other-bid",
        "TCC-123 is valid",
      ),
      "unclear",
    );
    assert.equal(
      groundedEvidenceStatus("expired", sources, "bid-1", "TCC-123 is valid"),
      "expired",
    );
    assert.equal(
      groundedEvidenceStatus("expired", sources, "bid-1", "expired in 2024"),
      "unclear",
    );
    assert.equal(
      groundedEvidenceStatus("missing", sources, null, null),
      "missing",
    );
  });
});
