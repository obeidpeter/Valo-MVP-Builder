import { createHash } from "node:crypto";
import { inspectArchiveStructure } from "./archiveInspection";
import { getMaxUploadBytes } from "./intakeLimits";
import { configuredMalwareAdapters } from "./malwareScanner";
import type { MalwareAdapter } from "./providerContracts";
import {
  inspectUpload,
  type MalwareScanState,
  type UploadInspectionPolicy,
  type UploadInspectionResult,
} from "./uploadInspection";

const DEFAULT_MAX_PAGES = 2_000;
const DEFAULT_MAX_ARCHIVE_ENTRIES = 1_000;
const DEFAULT_MAX_ARCHIVE_EXPANDED_BYTES = 500 * 1024 * 1024;
const DEFAULT_MAX_COMPRESSION_RATIO = 100;

function positiveInteger(
  name: string,
  raw: string | undefined,
  fallback: number,
): number {
  if (!raw?.trim()) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

export function getDocumentIntakePolicy(): UploadInspectionPolicy {
  return {
    maxBytes: getMaxUploadBytes(),
    maxPages: positiveInteger(
      "VALO_MAX_UPLOAD_PAGES",
      process.env.VALO_MAX_UPLOAD_PAGES,
      DEFAULT_MAX_PAGES,
    ),
    maxArchiveEntries: positiveInteger(
      "VALO_MAX_ARCHIVE_ENTRIES",
      process.env.VALO_MAX_ARCHIVE_ENTRIES,
      DEFAULT_MAX_ARCHIVE_ENTRIES,
    ),
    maxArchiveExpandedBytes: positiveInteger(
      "VALO_MAX_ARCHIVE_EXPANDED_BYTES",
      process.env.VALO_MAX_ARCHIVE_EXPANDED_BYTES,
      DEFAULT_MAX_ARCHIVE_EXPANDED_BYTES,
    ),
    maxCompressionRatio: positiveInteger(
      "VALO_MAX_ARCHIVE_COMPRESSION_RATIO",
      process.env.VALO_MAX_ARCHIVE_COMPRESSION_RATIO,
      DEFAULT_MAX_COMPRESSION_RATIO,
    ),
    allowedFormats: ["pdf", "docx", "xlsx", "png", "jpeg", "zip"],
    requireMalwareScan: true,
  };
}

export interface DocumentIntakeSecurityResult extends UploadInspectionResult {
  malware: {
    state: MalwareScanState;
    provider: string | null;
    engineVersion: string | null;
    evidence: string | null;
  };
  archiveReason: string | null;
}

export async function inspectDocumentIntake(input: {
  tenantId: string;
  filename: string;
  declaredMime: string;
  bytes: Uint8Array;
  idempotencyKey: string;
  knownTenantHashes?: string[];
  policy?: UploadInspectionPolicy;
  malwareAdapters?: MalwareAdapter[];
}): Promise<DocumentIntakeSecurityResult> {
  const policy = input.policy ?? getDocumentIntakePolicy();
  const archive = inspectArchiveStructure(
    input.bytes,
    policy.maxArchiveEntries,
  );
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  const adapters = input.malwareAdapters ?? configuredMalwareAdapters();
  let malwareState: MalwareScanState = "unavailable";
  let provider: string | null = null;
  let engineVersion: string | null = null;
  let evidence: string | null = null;

  for (const adapter of adapters) {
    provider = adapter.descriptor.provider;
    try {
      const health = await adapter.health();
      if (!health.healthy) continue;
      const scan = await adapter.scan({
        bytes: input.bytes,
        sha256,
        timeoutMs: 20_000,
      });
      malwareState =
        scan.verdict === "indeterminate" ? "unavailable" : scan.verdict;
      engineVersion = scan.engineVersion;
      evidence = scan.evidence;
      break;
    } catch (error) {
      evidence =
        error instanceof Error
          ? error.message.slice(0, 500)
          : "Scanner request failed";
    }
  }

  const pdfPasswordProtected =
    input.bytes.byteLength >= 5 &&
    Buffer.from(input.bytes).subarray(0, 5).toString("ascii") === "%PDF-" &&
    Buffer.from(input.bytes).includes(Buffer.from("/Encrypt", "ascii"));
  const result = inspectUpload(
    {
      tenantId: input.tenantId,
      filename: input.filename,
      declaredMime: input.declaredMime,
      bytes: input.bytes,
      passwordProtected: archive.passwordProtected || pdfPasswordProtected,
      parserReportedCorrupt: archive.corrupt,
      malwareScan: malwareState,
      archiveEntries: archive.entries,
      knownTenantHashes: input.knownTenantHashes,
      idempotencyKey: input.idempotencyKey,
    },
    policy,
  );
  return {
    ...result,
    malware: {
      state: malwareState,
      provider,
      engineVersion,
      evidence,
    },
    archiveReason: archive.reason ?? null,
  };
}
