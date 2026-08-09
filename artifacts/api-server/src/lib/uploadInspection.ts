import { createHash } from "node:crypto";

export type UploadFormat =
  | "pdf"
  | "docx"
  | "xlsx"
  | "png"
  | "jpeg"
  | "zip"
  | "unknown";
export type MalwareScanState = "clean" | "infected" | "pending" | "unavailable";
export type UploadDisposition =
  | "ready"
  | "quarantined"
  | "rejected"
  | "duplicate";

export interface ArchiveEntryInspection {
  path: string;
  compressedBytes: number;
  expandedBytes: number;
  encrypted?: boolean;
}

export interface UploadInspectionPolicy {
  maxBytes: number;
  maxPages: number;
  maxArchiveEntries: number;
  maxArchiveExpandedBytes: number;
  maxCompressionRatio: number;
  allowedFormats: UploadFormat[];
  requireMalwareScan: boolean;
}

export interface UploadInspectionInput {
  tenantId: string;
  filename: string;
  declaredMime: string;
  bytes: Uint8Array;
  pageCount?: number | null;
  passwordProtected?: boolean;
  parserReportedCorrupt?: boolean;
  malwareScan: MalwareScanState;
  archiveEntries?: ArchiveEntryInspection[];
  knownTenantHashes?: string[];
  idempotencyKey?: string | null;
}

export type UploadFindingCode =
  | "filename_unsafe"
  | "empty_file"
  | "file_too_large"
  | "page_limit_exceeded"
  | "unsupported_format"
  | "mime_signature_mismatch"
  | "password_protected"
  | "corrupt_file"
  | "malware_detected"
  | "malware_scan_incomplete"
  | "archive_manifest_missing"
  | "archive_entry_limit"
  | "archive_expansion_limit"
  | "archive_bomb_suspected"
  | "archive_path_traversal"
  | "archive_executable"
  | "archive_encrypted"
  | "idempotency_key_missing"
  | "duplicate_document";

export interface UploadFinding {
  code: UploadFindingCode;
  severity: "reject" | "quarantine" | "notice";
  message: string;
}

export interface UploadInspectionResult {
  disposition: UploadDisposition;
  detectedFormat: UploadFormat;
  sha256: string;
  findings: UploadFinding[];
  mayProcess: boolean;
}

const MIME_BY_FORMAT: Record<Exclude<UploadFormat, "unknown">, Set<string>> = {
  pdf: new Set(["application/pdf"]),
  docx: new Set([
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/zip",
  ]),
  xlsx: new Set([
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/zip",
  ]),
  png: new Set(["image/png"]),
  jpeg: new Set(["image/jpeg"]),
  zip: new Set(["application/zip", "application/x-zip-compressed"]),
};

const extension = (filename: string): string =>
  filename.toLowerCase().split(".").pop() ?? "";

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

function detectFormat(
  bytes: Uint8Array,
  filename: string,
  entries?: ArchiveEntryInspection[],
): UploadFormat {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "pdf";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return "png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  if (
    startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) ||
    startsWith(bytes, [0x50, 0x4b, 0x05, 0x06])
  ) {
    const paths = new Set(
      (entries ?? []).map((entry) => entry.path.replaceAll("\\", "/")),
    );
    if (
      paths.has("[Content_Types].xml") &&
      [...paths].some((path) => path.startsWith("word/"))
    )
      return "docx";
    if (
      paths.has("[Content_Types].xml") &&
      [...paths].some((path) => path.startsWith("xl/"))
    )
      return "xlsx";
    if (extension(filename) === "docx") return "docx";
    if (extension(filename) === "xlsx") return "xlsx";
    return "zip";
  }
  return "unknown";
}

const isUnsafePath = (path: string): boolean => {
  const normal = path.replaceAll("\\", "/");
  return (
    normal.startsWith("/") ||
    /^[a-z]:\//i.test(normal) ||
    normal.split("/").includes("..")
  );
};

/**
 * Synchronous gate for intake metadata and file signatures. Decompression,
 * parser sandboxing, and malware engines remain adapters, but their evidence
 * is mandatory before this function can return `ready`.
 */
export function inspectUpload(
  input: UploadInspectionInput,
  policy: UploadInspectionPolicy,
): UploadInspectionResult {
  const findings: UploadFinding[] = [];
  const add = (finding: UploadFinding) => findings.push(finding);
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  const format = detectFormat(
    input.bytes,
    input.filename,
    input.archiveEntries,
  );

  if (
    !input.filename.trim() ||
    input.filename.includes("/") ||
    input.filename.includes("\\") ||
    input.filename.includes("\0")
  )
    add({
      code: "filename_unsafe",
      severity: "reject",
      message: "Filename must be a basename without path or null characters.",
    });
  if (input.bytes.byteLength === 0)
    add({
      code: "empty_file",
      severity: "reject",
      message: "Empty files are rejected.",
    });
  if (input.bytes.byteLength > policy.maxBytes)
    add({
      code: "file_too_large",
      severity: "reject",
      message: "File exceeds the configured byte limit.",
    });
  if (input.pageCount != null && input.pageCount > policy.maxPages)
    add({
      code: "page_limit_exceeded",
      severity: "quarantine",
      message: "Document exceeds the configured page review limit.",
    });
  if (!policy.allowedFormats.includes(format))
    add({
      code: "unsupported_format",
      severity: "reject",
      message: "Detected file format is not approved.",
    });
  if (
    format !== "unknown" &&
    !MIME_BY_FORMAT[format].has(input.declaredMime.toLowerCase())
  )
    add({
      code: "mime_signature_mismatch",
      severity: "quarantine",
      message: "Declared MIME type does not match the file signature.",
    });
  if (input.passwordProtected)
    add({
      code: "password_protected",
      severity: "quarantine",
      message:
        "Password-protected documents require controlled unlock and rescan.",
    });
  if (input.parserReportedCorrupt)
    add({
      code: "corrupt_file",
      severity: "quarantine",
      message: "Parser reported a corrupt or malformed document.",
    });
  if (input.malwareScan === "infected")
    add({
      code: "malware_detected",
      severity: "reject",
      message: "Malware scanner rejected the upload.",
    });
  if (
    policy.requireMalwareScan &&
    input.malwareScan !== "clean" &&
    input.malwareScan !== "infected"
  )
    add({
      code: "malware_scan_incomplete",
      severity: "quarantine",
      message: "A clean malware verdict is required before processing.",
    });
  if (!input.idempotencyKey?.trim())
    add({
      code: "idempotency_key_missing",
      severity: "quarantine",
      message: "Upload completion requires a stable idempotency key.",
    });

  if (format === "zip" || format === "docx" || format === "xlsx") {
    const entries = input.archiveEntries;
    if (!entries) {
      add({
        code: "archive_manifest_missing",
        severity: "quarantine",
        message: "ZIP-based formats require a sandboxed archive manifest.",
      });
    } else {
      if (entries.length > policy.maxArchiveEntries)
        add({
          code: "archive_entry_limit",
          severity: "reject",
          message: "Archive contains too many entries.",
        });
      const expanded = entries.reduce(
        (total, entry) => total + Math.max(0, entry.expandedBytes),
        0,
      );
      const compressed = entries.reduce(
        (total, entry) => total + Math.max(0, entry.compressedBytes),
        0,
      );
      if (expanded > policy.maxArchiveExpandedBytes)
        add({
          code: "archive_expansion_limit",
          severity: "reject",
          message: "Archive expands beyond the configured safe limit.",
        });
      if (compressed > 0 && expanded / compressed > policy.maxCompressionRatio)
        add({
          code: "archive_bomb_suspected",
          severity: "reject",
          message: "Archive compression ratio exceeds the safe threshold.",
        });
      if (entries.some((entry) => isUnsafePath(entry.path)))
        add({
          code: "archive_path_traversal",
          severity: "reject",
          message: "Archive contains a path traversal or absolute path.",
        });
      if (
        entries.some((entry) =>
          /\.(?:exe|dll|com|bat|cmd|ps1|js|vbs|scr|msi)$/i.test(entry.path),
        )
      )
        add({
          code: "archive_executable",
          severity: "reject",
          message: "Archive contains executable content.",
        });
      if (entries.some((entry) => entry.encrypted))
        add({
          code: "archive_encrypted",
          severity: "quarantine",
          message: "Encrypted archive entries require controlled review.",
        });
    }
  }

  if (input.knownTenantHashes?.includes(sha256))
    add({
      code: "duplicate_document",
      severity: "notice",
      message: "The tenant already has an identical content hash.",
    });

  const rejected = findings.some((finding) => finding.severity === "reject");
  const quarantined = findings.some(
    (finding) => finding.severity === "quarantine",
  );
  const duplicate =
    !rejected &&
    !quarantined &&
    findings.some((finding) => finding.code === "duplicate_document");
  const disposition: UploadDisposition = rejected
    ? "rejected"
    : quarantined
      ? "quarantined"
      : duplicate
        ? "duplicate"
        : "ready";
  return {
    disposition,
    detectedFormat: format,
    sha256,
    findings,
    mayProcess: disposition === "ready",
  };
}
