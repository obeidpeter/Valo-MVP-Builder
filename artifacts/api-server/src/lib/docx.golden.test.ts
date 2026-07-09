import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import JSZip from "jszip";
import { buildReportDocx, type ReportData } from "./docx";

/**
 * Golden-file test for the autopsy report (FR-ASM-01): reference inputs must
 * produce byte-stable output except dated fields. DOCX zip containers embed
 * timestamps, so the invariant is asserted on the rendered TEXT CONTENT of
 * word/document.xml — every section, table cell, banner and stamp in reading
 * order — with the two generated-at fields normalised.
 *
 * To re-baseline after an INTENTIONAL format change:
 *   REGENERATE_GOLDENS=1 pnpm --filter @workspace/api-server test
 * and review the golden diff in the PR like any other code change.
 */

const GOLDEN_PATH = join(import.meta.dirname, "__goldens__", "report-reference.txt");

const REFERENCE: ReportData = {
  project: {
    tenderTitle: "Supply of Laboratory Equipment VMT-2026-014",
    issuingEntity: "Federal Ministry of Health",
    tenderRef: "FMOH/2026/EQ/014",
    segment: "federal",
    deadline: "2026-09-30",
    valueBand: "50m-250m",
    status: "reporting",
    scope: "Full forensic autopsy of the tender/bid pair.",
    limitations: "BOQ addendum 2 was not provided by the client.",
    redactionScope: "Financial pages 41-58 excluded at client request",
    restrictedMode: false,
    responsivenessReview: "The bid is broadly responsive.\n\nSection 4 omits the after-sales plan the ITB requires.",
    responsivenessSuggested: true,
  },
  client: { name: "Acme Integrated Services Ltd", ndaStatus: "signed" },
  reviewerName: "Ada Obi",
  requirements: [
    {
      id: "r1",
      text: "Valid CAC certificate of incorporation",
      category: "eligibility",
      isMandatory: true,
      sourceDocName: "tender.pdf",
      clauseRef: "ITB 12.1",
      pageRef: "p. 14",
      reviewStatus: "confirmed",
    },
    {
      id: "r2",
      text: "Bid security of 2% of bid price",
      category: "financial_format",
      isMandatory: true,
      sourceDocName: "tender.pdf",
      clauseRef: "ITB 19",
      pageRef: "p. 22",
      reviewStatus: "edited",
    },
    {
      id: "r3",
      text: "ISO 13485 certification for medical devices",
      category: "technical",
      isMandatory: false,
      sourceDocName: "tender.pdf",
      clauseRef: "TS 3.2",
      pageRef: "p. 41",
      reviewStatus: "suggested",
    },
  ],
  evidence: [
    {
      requirementId: "r1",
      evidenceStatus: "present",
      excerpt: "Certificate of Incorporation RC 123456 dated 12 March 2015",
      notes: "Annex A, page 2",
      suggested: false,
    },
    {
      requirementId: "r2",
      evidenceStatus: "missing",
      excerpt: null,
      notes: "No bank guarantee found in the bid",
      suggested: true,
    },
  ],
  defects: [
    {
      description: "Bid security instrument absent",
      type: "omission",
      severity: "fatal",
      status: "open",
      remediation: "Obtain a 2% bank guarantee before submission",
      owner: "Client CFO",
      suggested: false,
    },
    {
      description: "Table of contents page numbers stale",
      type: "formatting",
      severity: "cosmetic",
      status: "open",
      remediation: null,
      owner: null,
      suggested: true,
    },
  ],
  boqChecks: [
    {
      lineRef: "3.04",
      checkType: "extension",
      finding: "Extension mismatch: 40 × ₦125,000.00 = ₦5,000,000.00 but sheet shows ₦4,999,999.50",
      severity: "scoring_risk",
      status: "flagged",
    },
  ],
  risk: {
    score: 45,
    band: "high",
    explanation: "1 open fatal defect (40) and 1 mandatory requirement without resolved evidence (5).",
    overrideBand: null,
    overrideNote: null,
    overrideBy: null,
  },
  version: 1,
  generatedByName: "Ada Obi",
  // Fixed timestamp: the golden asserts byte-stable output "except dated
  // fields" by pinning the only dated field to a reference instant.
  generatedAt: new Date("2026-07-01T09:00:00.000Z"),
};

/** Extract the visible text of word/document.xml in reading order. */
async function renderedText(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file("word/document.xml")!.async("string");
  return (
    xml
      // Paragraph boundaries become newlines so ordering stays assertable.
      .replace(/<\/w:p>/g, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/\n{2,}/g, "\n")
      .trim()
  );
}

describe("report golden file (FR-ASM-01)", () => {
  test("reference inputs render byte-stable text content except dated fields", async () => {
    const buffer = await buildReportDocx(REFERENCE);
    const text = await renderedText(buffer);

    if (process.env.REGENERATE_GOLDENS === "1") {
      writeFileSync(GOLDEN_PATH, text + "\n");
      return;
    }

    const golden = readFileSync(GOLDEN_PATH, "utf-8").trim();
    assert.equal(
      text,
      golden,
      "Rendered report text diverged from the golden file. If the format change is intentional, re-baseline with REGENERATE_GOLDENS=1 and review the diff.",
    );
  });

  test("two renders of the same inputs are identical (determinism)", async () => {
    const [a, b] = await Promise.all([buildReportDocx(REFERENCE), buildReportDocx(REFERENCE)]);
    assert.equal(await renderedText(a), await renderedText(b));
  });
});
