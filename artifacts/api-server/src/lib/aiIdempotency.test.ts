import assert from "node:assert/strict";
import test from "node:test";
import { pdfOcrIdempotencyKey } from "./aiIdempotency";

const base = {
  projectId: "00000000-0000-4000-8000-000000000001",
  promptVersion: "prompt-v1",
  filename: "tender.pdf",
};

test("PDF OCR idempotency is stable and binds the exact document bytes", () => {
  const first = pdfOcrIdempotencyKey({
    ...base,
    bytes: Buffer.from("AAAA", "utf8"),
  });
  assert.equal(
    first,
    pdfOcrIdempotencyKey({ ...base, bytes: Buffer.from("AAAA", "utf8") }),
  );
  assert.notEqual(
    first,
    pdfOcrIdempotencyKey({ ...base, bytes: Buffer.from("BBBB", "utf8") }),
    "same-length PDFs with different bytes must not share a provider key",
  );
});

test("PDF OCR idempotency also binds project, prompt and filename", () => {
  const bytes = Buffer.from("document", "utf8");
  const first = pdfOcrIdempotencyKey({ ...base, bytes });
  assert.notEqual(
    first,
    pdfOcrIdempotencyKey({ ...base, projectId: "other-project", bytes }),
  );
  assert.notEqual(
    first,
    pdfOcrIdempotencyKey({ ...base, promptVersion: "prompt-v2", bytes }),
  );
  assert.notEqual(
    first,
    pdfOcrIdempotencyKey({ ...base, filename: "other.pdf", bytes }),
  );
});
