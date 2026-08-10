import { createHash } from "node:crypto";

export function aiSourceSha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function pdfOcrIdempotencyKey(input: {
  projectId: string;
  promptVersion: string;
  filename: string;
  bytes: Buffer;
}): string {
  const sourceSha256 = aiSourceSha256(input.bytes);
  return createHash("sha256")
    .update(
      `${input.projectId}\0extract_pdf_multimodal\0${input.promptVersion}\0${input.filename}\0${sourceSha256}`,
    )
    .digest("hex");
}
