import assert from "node:assert/strict";
import test from "node:test";
import { sha256Text, type SourceDocument } from "./domain";
import {
  boundedNextCapabilityRecordKeys,
  NEXT_CAPABILITY_MAX_ITEMS,
  NEXT_CAPABILITY_MAX_TEXT_CHARS,
  nextCapabilitySafety,
  validateNextCapabilitySources,
} from "./nextCapabilityContracts";

function source(content: string): SourceDocument {
  return {
    sourceId: "source-1",
    versionId: "version-1",
    kind: "company_evidence",
    title: "Bounded source",
    content,
    contentSha256: sha256Text(content),
    capturedAt: "2026-08-10T10:00:00.000Z",
    authority: "authoritative",
    origin: "vault:bounded-source",
  };
}

test("oversized source content is blocked and never admitted for citation validation", () => {
  const result = validateNextCapabilitySources([
    source("x".repeat(NEXT_CAPABILITY_MAX_TEXT_CHARS + 1)),
  ]);
  assert.equal(result.sourceSet.byKey.size, 0);
  assert.equal(
    result.issues.some(
      (issue) => issue.code === "capability_text_limit_exceeded",
    ),
    true,
  );
});

test("source collection overflow is sliced before source inspection", () => {
  const item = source("Verified evidence.");
  const result = validateNextCapabilitySources(
    Array.from({ length: NEXT_CAPABILITY_MAX_ITEMS + 1 }, (_, index) => ({
      ...item,
      sourceId: `source-${index + 1}`,
    })),
  );
  assert.equal(result.sourceSet.byKey.size, NEXT_CAPABILITY_MAX_ITEMS);
  assert.equal(
    result.issues.some(
      (issue) => issue.code === "capability_item_limit_exceeded",
    ),
    true,
  );
});

test("the safety envelope exposes the exact declared target ceiling", () => {
  assert.equal(nextCapabilitySafety().targetCeilingLevel, 1);
  assert.equal(nextCapabilitySafety(2).targetCeilingLevel, 2);
  assert.equal(nextCapabilitySafety(2).authoritativeStateChange, false);
});

test("review-map keys are bounded before they reach issue paths or IDs", () => {
  const result = boundedNextCapabilityRecordKeys(
    { ["x".repeat(NEXT_CAPABILITY_MAX_TEXT_CHARS + 1)]: {} },
    "reviews",
    "Reviews",
  );
  assert.deepEqual(result.keys, []);
  assert.equal(
    result.issues.some(
      (issue) => issue.code === "capability_record_key_invalid",
    ),
    true,
  );
  assert.equal(result.issues[0]?.path, "reviews[0]");
});
