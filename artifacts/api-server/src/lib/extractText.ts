import { ObjectStorageService } from "./objectStorage";
import { extractPdfTextMultimodal } from "./llm";

const objectStorage = new ObjectStorageService();

// Below this many characters of embedded PDF text we treat the page(s) as
// scanned / image-only and fall back to multimodal OCR.
const LOW_TEXT_THRESHOLD = 100;

export interface ExtractionResult {
  text: string | null;
  status: "extracted" | "failed" | "skipped";
}

export interface ExtractionContext {
  projectId?: string | null;
  filename?: string;
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
  const file = await objectStorage.getObjectEntityFile(objectPath);
  const [buf] = await file.download();
  return buf;
}

/**
 * Best-effort text extraction from an uploaded document. Handles text-based
 * formats directly and PDFs via pdf-parse. Returns skipped for formats we
 * cannot read (e.g. images, xlsx) so a reviewer can paste text manually.
 */
export async function extractDocumentText(
  objectPath: string,
  contentType: string | null | undefined,
  context?: ExtractionContext,
): Promise<ExtractionResult> {
  try {
    if (isTextual(contentType)) {
      const buf = await readObjectBuffer(objectPath);
      return { text: buf.toString("utf-8"), status: "extracted" };
    }

    if (contentType?.includes("pdf")) {
      const buf = await readObjectBuffer(objectPath);
      // @ts-expect-error - no type declarations for the pdf-parse internal entrypoint
      const mod = await import("pdf-parse/lib/pdf-parse.js");
      const pdfParse = (mod as any).default ?? mod;
      let text = "";
      try {
        const parsed = await pdfParse(buf);
        text = (parsed?.text ?? "").trim();
      } catch {
        text = "";
      }

      // Scanned / low-text PDF: fall back to multimodal OCR transcription.
      if (text.length < LOW_TEXT_THRESHOLD) {
        try {
          const ocr = await extractPdfTextMultimodal(buf, {
            projectId: context?.projectId ?? null,
            filename: context?.filename,
          });
          if (ocr.length > text.length) text = ocr;
        } catch {
          // Fall through to whatever embedded text we managed to extract.
        }
      }

      return text ? { text, status: "extracted" } : { text: null, status: "failed" };
    }

    return { text: null, status: "skipped" };
  } catch {
    return { text: null, status: "failed" };
  }
}
