import assert from "node:assert/strict";
import test from "node:test";
import type { CreateVisualQaReportInput } from "./contracts";
import { OperationsSuiteError } from "./errors";
import { evaluateVisualPackageQa } from "./visualQa";

const A = "a".repeat(64);
const B = "b".repeat(64);

test("visual QA is deterministic and blocks integrity and render defects", () => {
  const input: CreateVisualQaReportInput = {
    packageVersionId: "package-version-1",
    manifestSha256: A,
    expectedManifestSha256: B,
    pages: [
      {
        pageNumber: 2,
        textCharacterCount: 0,
        nonWhitespacePixelRatio: 0,
        clippedElementCount: 0,
      },
      {
        pageNumber: 1,
        textCharacterCount: 400,
        nonWhitespacePixelRatio: 0.25,
        clippedElementCount: 2,
      },
    ],
    crossReferences: [{ label: "Schedule 4", resolved: false }],
    signatures: [
      { label: "Authorised signatory", required: true, present: false },
    ],
  };

  const first = evaluateVisualPackageQa(input);
  const second = evaluateVisualPackageQa({
    ...input,
    pages: [...input.pages].reverse(),
  });

  assert.equal(first.status, "fail");
  assert.equal(first.inputSha256, second.inputSha256);
  assert.deepEqual(
    first.findings.map(({ code }) => code),
    [
      "manifest_mismatch",
      "clipped_content",
      "unexpected_blank_page",
      "broken_cross_reference",
      "missing_signature",
    ],
  );
});

test("visual QA passes a matching, complete render summary", () => {
  const result = evaluateVisualPackageQa({
    packageVersionId: "package-version-1",
    manifestSha256: A,
    expectedManifestSha256: A,
    pages: [
      {
        pageNumber: 1,
        textCharacterCount: 800,
        nonWhitespacePixelRatio: 0.2,
        clippedElementCount: 0,
      },
    ],
    crossReferences: [{ label: "Table 1", resolved: true }],
    signatures: [{ label: "Director", required: true, present: true }],
  });
  assert.equal(result.status, "pass");
  assert.deepEqual(result.findings, []);
});

test("visual QA rejects duplicate or unbounded page summaries", () => {
  assert.throws(
    () =>
      evaluateVisualPackageQa({
        packageVersionId: "package-version-1",
        manifestSha256: A,
        expectedManifestSha256: A,
        pages: [1, 1].map((pageNumber) => ({
          pageNumber,
          textCharacterCount: 1,
          nonWhitespacePixelRatio: 0.1,
          clippedElementCount: 0,
        })),
      }),
    (error: unknown) =>
      error instanceof OperationsSuiteError && error.code === "invalid_request",
  );
});
