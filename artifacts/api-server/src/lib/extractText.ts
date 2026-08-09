import { ObjectStorageService } from "./objectStorage";
import { extractPdfTextMultimodal } from "./llm";
import { getMaxUploadBytes } from "./intakeLimits";

const objectStorage = new ObjectStorageService();

// Below this many characters of embedded PDF text we treat the page(s) as
// scanned / image-only and fall back to multimodal OCR.
const LOW_TEXT_THRESHOLD = 100;

export type ExtractionMethod =
  | "textual"
  | "text_layer"
  | "multimodal_ocr"
  | "none";

export interface ExtractionResult {
  text: string | null;
  status: "extracted" | "failed" | "skipped";
  /**
   * Extraction telemetry (FR-OCR-01/02): how the text was obtained, a coarse
   * deterministic confidence heuristic, and human-readable notes. The notes
   * accumulate into the OCR evaluation set the roadmap requires — every
   * failure or fallback is recorded, never lost to memory.
   */
  method: ExtractionMethod;
  confidence: number | null;
  notes: string | null;
}

export interface ExtractionContext {
  projectId?: string | null;
  filename?: string;
  signal?: AbortSignal;
}

function isTextual(contentType: string | null | undefined): boolean {
  if (!contentType) return false;
  return (
    contentType.startsWith("text/") ||
    contentType.includes("csv") ||
    contentType.includes("json") ||
    contentType.includes("xml")
  );
}

async function readObjectBuffer(objectPath: string): Promise<Buffer> {
  return objectStorage.downloadObjectEntityBuffer(
    objectPath,
    getMaxUploadBytes(),
  );
}

/**
 * Download the stored object once so callers can both hash it (FR-INT-02
 * manifest) and extract text from the same bytes. Throws on storage failure.
 */
export async function downloadDocumentBuffer(
  objectPath: string,
): Promise<Buffer> {
  return readObjectBuffer(objectPath);
}

/**
 * Best-effort text extraction from an already-downloaded document buffer.
 * Handles text-based formats directly and PDFs via pdf-parse (with a
 * multimodal OCR fallback for scanned PDFs). Returns skipped for formats we
 * cannot read (e.g. images, xlsx) so a reviewer can paste text manually.
 *
 * Confidence heuristic (deterministic, documented):
 *  - native text formats: 1.0 — the bytes ARE the text;
 *  - PDF embedded text layer: 0.9 — reliable but layout can drop content;
 *  - multimodal OCR transcription: 0.6 — a model SUGGESTION the reviewer
 *    must verify against the source pages;
 *  - failed/skipped: null.
 */
export async function extractDocumentTextFromBuffer(
  buf: Buffer,
  contentType: string | null | undefined,
  context?: ExtractionContext,
): Promise<ExtractionResult> {
  try {
    context?.signal?.throwIfAborted();
    if (isTextual(contentType)) {
      const text = buf.toString("utf-8");
      return {
        text,
        status: "extracted",
        method: "textual",
        confidence: 1,
        notes: `native text format (${contentType}); ${text.length.toLocaleString()} chars`,
      };
    }

    if (contentType?.includes("pdf")) {
      context?.signal?.throwIfAborted();
      // @ts-expect-error - no type declarations for the pdf-parse internal entrypoint
      const mod = await import("pdf-parse/lib/pdf-parse.js");
      const pdfParse = (mod as any).default ?? mod;
      let text = "";
      let pdfParseError: string | null = null;
      try {
        context?.signal?.throwIfAborted();
        const parsed = await pdfParse(buf);
        context?.signal?.throwIfAborted();
        text = (parsed?.text ?? "").trim();
      } catch (error) {
        pdfParseError = error instanceof Error ? error.message : String(error);
        text = "";
      }
      const layerChars = text.length;

      // Scanned / low-text PDF: fall back to multimodal OCR transcription.
      if (text.length < LOW_TEXT_THRESHOLD) {
        let ocrError: string | null = null;
        try {
          context?.signal?.throwIfAborted();
          const ocr = await extractPdfTextMultimodal(buf, {
            projectId: context?.projectId ?? null,
            filename: context?.filename,
            signal: context?.signal,
          });
          context?.signal?.throwIfAborted();
          if (ocr.length > text.length) {
            return {
              text: ocr,
              status: "extracted",
              method: "multimodal_ocr",
              confidence: 0.6,
              notes:
                `low embedded text layer (${layerChars} chars` +
                (pdfParseError
                  ? `; pdf-parse error: ${pdfParseError.slice(0, 200)}`
                  : "") +
                `); multimodal OCR transcription used: ${ocr.length.toLocaleString()} chars — verify against source pages`,
            };
          }
          ocrError = "OCR returned no additional text";
        } catch (error) {
          ocrError = error instanceof Error ? error.message : String(error);
        }
        context?.signal?.throwIfAborted();
        if (!text) {
          return {
            text: null,
            status: "failed",
            method: "none",
            confidence: null,
            notes:
              `no embedded text layer` +
              (pdfParseError
                ? ` (pdf-parse error: ${pdfParseError.slice(0, 200)})`
                : "") +
              `; OCR fallback failed: ${ocrError?.slice(0, 200) ?? "unknown"}`,
          };
        }
      }

      return text
        ? {
            text,
            status: "extracted",
            method: "text_layer",
            confidence: 0.9,
            notes: `embedded PDF text layer: ${layerChars.toLocaleString()} chars`,
          }
        : {
            text: null,
            status: "failed",
            method: "none",
            confidence: null,
            notes: pdfParseError
              ? `pdf-parse error: ${pdfParseError.slice(0, 200)}`
              : "empty text layer",
          };
    }

    context?.signal?.throwIfAborted();
    return {
      text: null,
      status: "skipped",
      method: "none",
      confidence: null,
      notes: `unsupported content type (${contentType ?? "unknown"}); paste text manually or upload a PDF`,
    };
  } catch (error) {
    if (context?.signal?.aborted) context.signal.throwIfAborted();
    return {
      text: null,
      status: "failed",
      method: "none",
      confidence: null,
      notes: `extraction crashed: ${(error instanceof Error ? error.message : String(error)).slice(0, 200)}`,
    };
  }
}

/**
 * Best-effort text extraction from an uploaded document by object path.
 * Downloads the object then delegates to `extractDocumentTextFromBuffer`.
 */
export async function extractDocumentText(
  objectPath: string,
  contentType: string | null | undefined,
  context?: ExtractionContext,
): Promise<ExtractionResult> {
  let buf: Buffer;
  try {
    buf = await readObjectBuffer(objectPath);
  } catch (error) {
    return {
      text: null,
      status: "failed",
      method: "none",
      confidence: null,
      notes: `stored object unreadable: ${(error instanceof Error ? error.message : String(error)).slice(0, 200)}`,
    };
  }
  return extractDocumentTextFromBuffer(buf, contentType, context);
}
