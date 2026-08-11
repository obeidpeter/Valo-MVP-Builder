import { createHash } from "node:crypto";
import { OPERATIONS_SUITE_BOUNDS, SHA256_PATTERN } from "./bounds";
import type {
  CreateVisualQaReportInput,
  VisualQaFinding,
  VisualQaResult,
} from "./contracts";
import { OperationsSuiteError } from "./errors";

function fail(message: string): never {
  throw new OperationsSuiteError("invalid_request", message);
}

function canonicalInput(input: CreateVisualQaReportInput): string {
  return JSON.stringify({
    packageVersionId: input.packageVersionId,
    manifestSha256: input.manifestSha256,
    expectedManifestSha256: input.expectedManifestSha256,
    pages: [...input.pages].sort((a, b) => a.pageNumber - b.pageNumber),
    crossReferences: [...(input.crossReferences ?? [])].sort((a, b) =>
      a.label.localeCompare(b.label),
    ),
    signatures: [...(input.signatures ?? [])].sort((a, b) =>
      a.label.localeCompare(b.label),
    ),
  });
}

function assertVisualQaInput(input: CreateVisualQaReportInput): void {
  if (!SHA256_PATTERN.test(input.manifestSha256)) {
    fail("manifestSha256 must be a lowercase SHA-256 digest.");
  }
  if (!SHA256_PATTERN.test(input.expectedManifestSha256)) {
    fail("expectedManifestSha256 must be a lowercase SHA-256 digest.");
  }
  if (
    input.pages.length === 0 ||
    input.pages.length > OPERATIONS_SUITE_BOUNDS.visualQaPages
  ) {
    fail("pages must contain a bounded, non-empty render summary.");
  }
  if (
    (input.crossReferences?.length ?? 0) >
    OPERATIONS_SUITE_BOUNDS.visualQaCrossReferences
  ) {
    fail("crossReferences exceeds the deterministic QA bound.");
  }
  if (
    (input.signatures?.length ?? 0) > OPERATIONS_SUITE_BOUNDS.visualQaSignatures
  ) {
    fail("signatures exceeds the deterministic QA bound.");
  }

  const pageNumbers = new Set<number>();
  for (const page of input.pages) {
    if (
      !Number.isSafeInteger(page.pageNumber) ||
      page.pageNumber < 1 ||
      !Number.isSafeInteger(page.textCharacterCount) ||
      page.textCharacterCount < 0 ||
      !Number.isFinite(page.nonWhitespacePixelRatio) ||
      page.nonWhitespacePixelRatio < 0 ||
      page.nonWhitespacePixelRatio > 1 ||
      !Number.isSafeInteger(page.clippedElementCount) ||
      page.clippedElementCount < 0
    ) {
      fail("Every page metric must be finite, non-negative and in range.");
    }
    if (pageNumbers.has(page.pageNumber)) {
      fail("Page numbers must be unique.");
    }
    pageNumbers.add(page.pageNumber);
  }
}

/**
 * Evaluates render measurements only. It performs no OCR, model call, file
 * access or network request, so the same bounded input always yields the same
 * report and input hash.
 */
export function evaluateVisualPackageQa(
  input: CreateVisualQaReportInput,
): VisualQaResult {
  assertVisualQaInput(input);
  const findings: VisualQaFinding[] = [];

  if (input.manifestSha256 !== input.expectedManifestSha256) {
    findings.push({
      code: "manifest_mismatch",
      severity: "blocker",
      message: "The rendered package does not match the frozen manifest.",
      pageNumber: null,
    });
  }

  for (const page of [...input.pages].sort(
    (left, right) => left.pageNumber - right.pageNumber,
  )) {
    if (page.textCharacterCount === 0 && page.nonWhitespacePixelRatio < 0.002) {
      findings.push({
        code: "unexpected_blank_page",
        severity: "warning",
        message: `Page ${page.pageNumber} appears unexpectedly blank.`,
        pageNumber: page.pageNumber,
      });
    }
    if (page.clippedElementCount > 0) {
      findings.push({
        code: "clipped_content",
        severity: "blocker",
        message: `Page ${page.pageNumber} contains ${page.clippedElementCount} clipped element(s).`,
        pageNumber: page.pageNumber,
      });
    }
  }

  for (const reference of [...(input.crossReferences ?? [])].sort((a, b) =>
    a.label.localeCompare(b.label),
  )) {
    if (!reference.resolved) {
      findings.push({
        code: "broken_cross_reference",
        severity: "blocker",
        message: `Cross-reference "${reference.label}" is unresolved.`,
        pageNumber: null,
      });
    }
  }

  for (const signature of [...(input.signatures ?? [])].sort((a, b) =>
    a.label.localeCompare(b.label),
  )) {
    if (signature.required && !signature.present) {
      findings.push({
        code: "missing_signature",
        severity: "blocker",
        message: `Required signature "${signature.label}" is missing.`,
        pageNumber: null,
      });
    }
  }

  return {
    algorithmVersion: "visual-qa-v1",
    status: findings.some(({ severity }) => severity === "blocker")
      ? "fail"
      : findings.length > 0
        ? "review"
        : "pass",
    inputSha256: createHash("sha256")
      .update(canonicalInput(input), "utf8")
      .digest("hex"),
    findings,
  };
}
