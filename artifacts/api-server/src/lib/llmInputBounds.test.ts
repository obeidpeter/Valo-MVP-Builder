import assert from "node:assert/strict";
import { test } from "node:test";
import {
  completeBoundedInput,
  ModelInputTooLargeError,
} from "./sourceGrounding";

test("complete model inputs pass unchanged at the configured boundary", () => {
  const input = "x".repeat(60_000);
  assert.equal(completeBoundedInput(input), input);
});

test("oversized model inputs fail closed instead of returning a sampled corpus", () => {
  assert.throws(
    () => completeBoundedInput("x".repeat(60_001)),
    (error: unknown) => {
      assert.ok(error instanceof ModelInputTooLargeError);
      assert.equal(error.code, "AI_SOURCE_CORPUS_TOO_LARGE");
      assert.equal(error.actualChars, 60_001);
      assert.equal(error.maxChars, 60_000);
      return true;
    },
  );
});
