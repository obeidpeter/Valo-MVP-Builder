import { ObjectStorageService } from "./objectStorage";

const objectStorage = new ObjectStorageService();

export interface ExtractionResult {
  text: string | null;
  status: "extracted" | "failed" | "skipped";
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
      const parsed = await pdfParse(buf);
      const text = (parsed?.text ?? "").trim();
      return text ? { text, status: "extracted" } : { text: null, status: "failed" };
    }

    return { text: null, status: "skipped" };
  } catch {
    return { text: null, status: "failed" };
  }
}
