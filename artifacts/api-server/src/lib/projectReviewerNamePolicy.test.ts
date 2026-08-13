import { test } from "node:test";
import assert from "node:assert/strict";
import { validProjectReviewerName } from "./projectReviewerNamePolicy";

test("project reviewer names are bounded and free of ambiguous controls", () => {
  assert.equal(validProjectReviewerName("Named Reviewer"), true);
  for (const name of [
    "",
    " Named Reviewer",
    "Named Reviewer ",
    "\n",
    "Named\u0000Reviewer",
    "Named\u007fReviewer",
    "Named\ud800Reviewer",
    "x".repeat(513),
  ]) {
    assert.equal(validProjectReviewerName(name), false, JSON.stringify(name));
  }
});
