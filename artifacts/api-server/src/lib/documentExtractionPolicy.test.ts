import assert from "node:assert/strict";
import test from "node:test";
import {
  EXCLUDED_EXTRACTION_NOTES,
  ELIGIBLE_EXTRACTION_NOTES,
  initialExtractionState,
  stateAfterRedactionChange,
} from "./documentExtractionPolicy";

test("excluded intake persists a truthful skipped/no-model state", () => {
  assert.deepEqual(initialExtractionState("excluded"), {
    extractionStatus: "skipped",
    extractionMethod: "none",
    extractionConfidence: null,
    extractionNotes: EXCLUDED_EXTRACTION_NOTES,
  });
});

test("excluding an extracted document clears derived content", () => {
  assert.deepEqual(stateAfterRedactionChange("excluded"), {
    contentText: null,
    extractedChars: null,
    extractionStatus: "skipped",
    extractionMethod: "none",
    extractionConfidence: null,
    extractionNotes: EXCLUDED_EXTRACTION_NOTES,
  });
  assert.deepEqual(stateAfterRedactionChange("included"), {});
});

test("making an excluded document eligible does not auto-extract", () => {
  assert.deepEqual(stateAfterRedactionChange("redacted", "excluded"), {
    contentText: null,
    extractedChars: null,
    extractionStatus: "skipped",
    extractionMethod: "none",
    extractionConfidence: null,
    extractionNotes: ELIGIBLE_EXTRACTION_NOTES,
  });
});
