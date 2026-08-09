export const EXCLUDED_EXTRACTION_NOTES =
  "Skipped by confidentiality policy: this document is excluded and no text extraction or model OCR was run.";

export const ELIGIBLE_EXTRACTION_NOTES =
  "A reviewer made this document eligible for processing. Start extraction deliberately to allow text extraction or model OCR.";

export interface InitialExtractionState {
  extractionStatus: "pending" | "skipped";
  extractionMethod?: "none";
  extractionConfidence?: null;
  extractionNotes?: string;
}

/**
 * Confidentiality is fail-closed. An excluded object may be hashed and
 * malware-scanned for secure intake, but it must never enter a text parser or
 * model-backed OCR path.
 */
export function initialExtractionState(
  redactionStatus: string,
): InitialExtractionState {
  return redactionStatus === "excluded"
    ? {
        extractionStatus: "skipped",
        extractionMethod: "none",
        extractionConfidence: null,
        extractionNotes: EXCLUDED_EXTRACTION_NOTES,
      }
    : { extractionStatus: "pending" };
}

export function stateAfterRedactionChange(
  redactionStatus: string | undefined,
  previousRedactionStatus?: string,
): Partial<{
  contentText: null;
  extractedChars: null;
  extractionStatus: "skipped";
  extractionMethod: "none";
  extractionConfidence: null;
  extractionNotes: string;
}> {
  if (redactionStatus === "excluded") {
    return {
      contentText: null,
      extractedChars: null,
      extractionStatus: "skipped",
      extractionMethod: "none",
      extractionConfidence: null,
      extractionNotes: EXCLUDED_EXTRACTION_NOTES,
    };
  }
  if (
    previousRedactionStatus === "excluded" &&
    (redactionStatus === "included" || redactionStatus === "redacted")
  ) {
    return {
      contentText: null,
      extractedChars: null,
      extractionStatus: "skipped",
      extractionMethod: "none",
      extractionConfidence: null,
      extractionNotes: ELIGIBLE_EXTRACTION_NOTES,
    };
  }
  return {};
}
