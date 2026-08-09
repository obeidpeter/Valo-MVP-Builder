import assert from "node:assert/strict";
import test from "node:test";
import {
  inspectUpload,
  type UploadInspectionInput,
  type UploadInspectionPolicy,
} from "./uploadInspection";

const policy: UploadInspectionPolicy = {
  maxBytes: 10_000,
  maxPages: 100,
  maxArchiveEntries: 100,
  maxArchiveExpandedBytes: 100_000,
  maxCompressionRatio: 20,
  allowedFormats: ["pdf", "docx", "xlsx", "png", "jpeg", "zip"],
  requireMalwareScan: true,
};
const pdfBytes = new TextEncoder().encode("%PDF-1.7\nfixture");
const base: UploadInspectionInput = {
  tenantId: "tenant-a",
  filename: "tender.pdf",
  declaredMime: "application/pdf",
  bytes: pdfBytes,
  pageCount: 2,
  malwareScan: "clean",
  idempotencyKey: "upload-1-part-final",
};

test("a clean signature-verified upload is ready with a SHA-256 manifest", () => {
  const result = inspectUpload(base, policy);
  assert.equal(result.disposition, "ready");
  assert.equal(result.sha256.length, 64);
});

test("malware and unsupported content are rejected", () => {
  assert.equal(
    inspectUpload({ ...base, malwareScan: "infected" }, policy).disposition,
    "rejected",
  );
  assert.equal(
    inspectUpload({ ...base, bytes: new Uint8Array([1, 2, 3]) }, policy)
      .disposition,
    "rejected",
  );
});

test("unavailable scanning, MIME mismatch, password, corrupt files, and missing idempotency quarantine", () => {
  const result = inspectUpload(
    {
      ...base,
      declaredMime: "image/png",
      malwareScan: "unavailable",
      passwordProtected: true,
      parserReportedCorrupt: true,
      idempotencyKey: null,
    },
    policy,
  );
  assert.equal(result.disposition, "quarantined");
  const codes = new Set(result.findings.map((finding) => finding.code));
  for (const expected of [
    "mime_signature_mismatch",
    "malware_scan_incomplete",
    "password_protected",
    "corrupt_file",
    "idempotency_key_missing",
  ])
    assert.equal(codes.has(expected as never), true);
});

test("limits and unsafe archive contents fail closed", () => {
  const zipBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
  const result = inspectUpload(
    {
      ...base,
      filename: "package.zip",
      declaredMime: "application/zip",
      bytes: zipBytes,
      pageCount: 101,
      archiveEntries: [
        {
          path: "../escape.exe",
          compressedBytes: 1,
          expandedBytes: 1000,
          encrypted: true,
        },
      ],
    },
    { ...policy, maxArchiveEntries: 0, maxArchiveExpandedBytes: 10 },
  );
  assert.equal(result.disposition, "rejected");
  const codes = new Set(result.findings.map((finding) => finding.code));
  for (const expected of [
    "page_limit_exceeded",
    "archive_entry_limit",
    "archive_expansion_limit",
    "archive_bomb_suspected",
    "archive_path_traversal",
    "archive_executable",
    "archive_encrypted",
  ])
    assert.equal(codes.has(expected as never), true);
});

test("ZIP-based Office formats require an inspected archive manifest", () => {
  const result = inspectUpload(
    {
      ...base,
      filename: "boq.xlsx",
      declaredMime:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
    },
    policy,
  );
  assert.equal(result.detectedFormat, "xlsx");
  assert.equal(
    result.findings.some(
      (finding) => finding.code === "archive_manifest_missing",
    ),
    true,
  );
  assert.equal(result.disposition, "quarantined");
});

test("same-tenant content hashes are idempotent duplicates", () => {
  const first = inspectUpload(base, policy);
  const duplicate = inspectUpload(
    { ...base, knownTenantHashes: [first.sha256] },
    policy,
  );
  assert.equal(duplicate.disposition, "duplicate");
  assert.equal(duplicate.mayProcess, false);
});
