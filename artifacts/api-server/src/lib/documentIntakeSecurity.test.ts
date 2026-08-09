import assert from "node:assert/strict";
import test from "node:test";
import type { MalwareAdapter } from "./providerContracts";
import { inspectDocumentIntake } from "./documentIntakeSecurity";
import type { UploadInspectionPolicy } from "./uploadInspection";

const policy: UploadInspectionPolicy = {
  maxBytes: 10_000,
  maxPages: 100,
  maxArchiveEntries: 100,
  maxArchiveExpandedBytes: 100_000,
  maxCompressionRatio: 20,
  allowedFormats: ["pdf", "docx", "xlsx", "png", "jpeg", "zip"],
  requireMalwareScan: true,
};

function scanner(
  verdict: "clean" | "infected" | "indeterminate",
): MalwareAdapter {
  return {
    descriptor: {
      kind: "malware_scan",
      provider: "fixture-scanner",
      mode: "production",
      productionApproved: true,
      capabilities: ["raw_bytes"],
    },
    async health() {
      return {
        healthy: true,
        checkedAt: "2026-08-09T00:00:00Z",
        message: "ok",
      };
    },
    async scan() {
      return { verdict, engineVersion: "fixture-1", evidence: "fixture" };
    },
  };
}

const base = {
  tenantId: "tenant-a",
  filename: "tender.pdf",
  declaredMime: "application/pdf",
  bytes: Buffer.from("%PDF-1.7\nfixture\n%%EOF"),
  idempotencyKey: "upload-object-1",
  policy,
};

test("only a signature-valid upload with a clean scanner verdict may process", async () => {
  const result = await inspectDocumentIntake({
    ...base,
    malwareAdapters: [scanner("clean")],
  });
  assert.equal(result.disposition, "ready");
  assert.equal(result.mayProcess, true);
  assert.equal(result.malware.engineVersion, "fixture-1");
});

test("missing and indeterminate malware scanning quarantine before processing", async () => {
  const missing = await inspectDocumentIntake({
    ...base,
    malwareAdapters: [],
  });
  const indeterminate = await inspectDocumentIntake({
    ...base,
    malwareAdapters: [scanner("indeterminate")],
  });
  for (const result of [missing, indeterminate]) {
    assert.equal(result.disposition, "quarantined");
    assert.equal(result.mayProcess, false);
    assert.equal(
      result.findings.some(
        (finding) => finding.code === "malware_scan_incomplete",
      ),
      true,
    );
  }
});

test("infected and magic/MIME-mismatched bytes never process", async () => {
  const infected = await inspectDocumentIntake({
    ...base,
    malwareAdapters: [scanner("infected")],
  });
  assert.equal(infected.disposition, "rejected");
  assert.equal(infected.mayProcess, false);

  const mismatch = await inspectDocumentIntake({
    ...base,
    declaredMime: "image/png",
    malwareAdapters: [scanner("clean")],
  });
  assert.equal(mismatch.disposition, "quarantined");
  assert.equal(mismatch.mayProcess, false);
});

test("password-protected PDFs are quarantined before parser extraction", async () => {
  const result = await inspectDocumentIntake({
    ...base,
    bytes: Buffer.from("%PDF-1.7\n/Encrypt 1 0 R\n%%EOF"),
    malwareAdapters: [scanner("clean")],
  });
  assert.equal(result.disposition, "quarantined");
  assert.equal(
    result.findings.some((finding) => finding.code === "password_protected"),
    true,
  );
});
