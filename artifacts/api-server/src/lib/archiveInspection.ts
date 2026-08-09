import type { ArchiveEntryInspection } from "./uploadInspection";

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_FILE_SIGNATURE = 0x02014b50;
const ZIP64_SENTINEL_16 = 0xffff;
const ZIP64_SENTINEL_32 = 0xffffffff;
const MAX_EOCD_SEARCH = 65_557;

export interface ArchiveStructureInspection {
  entries?: ArchiveEntryInspection[];
  corrupt: boolean;
  passwordProtected: boolean;
  reason?: string;
}

function isZip(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 4) return false;
  const signature = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getUint32(0, true);
  return (
    signature === 0x04034b50 ||
    signature === EOCD_SIGNATURE ||
    signature === 0x08074b50
  );
}

function findEndOfCentralDirectory(view: DataView): number {
  const lowerBound = Math.max(0, view.byteLength - MAX_EOCD_SEARCH);
  for (let offset = view.byteLength - 22; offset >= lowerBound; offset -= 1) {
    if (view.getUint32(offset, true) !== EOCD_SIGNATURE) continue;
    const commentLength = view.getUint16(offset + 20, true);
    if (offset + 22 + commentLength <= view.byteLength) return offset;
  }
  return -1;
}

/**
 * Read ZIP central-directory metadata without inflating attacker-controlled
 * content. Entry collection is capped at policy limit + 1: that is enough to
 * prove an entry-limit violation while keeping parser memory bounded.
 */
export function inspectArchiveStructure(
  bytes: Uint8Array,
  maxEntries: number,
): ArchiveStructureInspection {
  if (!isZip(bytes)) {
    return { corrupt: false, passwordProtected: false };
  }
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {
    throw new Error("maxEntries must be a positive safe integer");
  }

  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const eocd = findEndOfCentralDirectory(view);
    if (eocd < 0) {
      return {
        corrupt: true,
        passwordProtected: false,
        reason: "ZIP end-of-central-directory record is missing.",
      };
    }

    const diskNumber = view.getUint16(eocd + 4, true);
    const centralDisk = view.getUint16(eocd + 6, true);
    const entriesOnDisk = view.getUint16(eocd + 8, true);
    const totalEntries = view.getUint16(eocd + 10, true);
    const centralSize = view.getUint32(eocd + 12, true);
    const centralOffset = view.getUint32(eocd + 16, true);
    if (
      totalEntries === ZIP64_SENTINEL_16 ||
      centralSize === ZIP64_SENTINEL_32 ||
      centralOffset === ZIP64_SENTINEL_32
    ) {
      return {
        corrupt: true,
        passwordProtected: false,
        reason: "ZIP64 archives require a separately approved parser.",
      };
    }
    if (
      diskNumber !== 0 ||
      centralDisk !== 0 ||
      entriesOnDisk !== totalEntries
    ) {
      return {
        corrupt: true,
        passwordProtected: false,
        reason: "Multi-disk ZIP archives are not supported.",
      };
    }
    if (
      centralOffset > eocd ||
      centralSize > eocd - centralOffset ||
      centralOffset + centralSize > bytes.byteLength
    ) {
      return {
        corrupt: true,
        passwordProtected: false,
        reason: "ZIP central-directory bounds are invalid.",
      };
    }

    const decoder = new TextDecoder("utf-8", { fatal: false });
    const entries: ArchiveEntryInspection[] = [];
    const entriesToRead = Math.min(totalEntries, maxEntries + 1);
    let offset = centralOffset;
    let passwordProtected = false;
    for (let index = 0; index < entriesToRead; index += 1) {
      if (
        offset + 46 > eocd ||
        view.getUint32(offset, true) !== CENTRAL_FILE_SIGNATURE
      ) {
        return {
          corrupt: true,
          passwordProtected,
          reason: "ZIP central-directory entry is truncated or malformed.",
        };
      }
      const flags = view.getUint16(offset + 8, true);
      const compressedBytes = view.getUint32(offset + 20, true);
      const expandedBytes = view.getUint32(offset + 24, true);
      const nameLength = view.getUint16(offset + 28, true);
      const extraLength = view.getUint16(offset + 30, true);
      const commentLength = view.getUint16(offset + 32, true);
      const recordLength = 46 + nameLength + extraLength + commentLength;
      if (offset + recordLength > eocd) {
        return {
          corrupt: true,
          passwordProtected,
          reason: "ZIP central-directory filename or metadata is truncated.",
        };
      }
      if (
        compressedBytes === ZIP64_SENTINEL_32 ||
        expandedBytes === ZIP64_SENTINEL_32
      ) {
        return {
          corrupt: true,
          passwordProtected,
          reason: "ZIP64 entry metadata requires a separately approved parser.",
        };
      }
      const encrypted = (flags & 0x0001) !== 0;
      passwordProtected ||= encrypted;
      entries.push({
        path: decoder.decode(
          bytes.subarray(offset + 46, offset + 46 + nameLength),
        ),
        compressedBytes,
        expandedBytes,
        encrypted,
      });
      offset += recordLength;
    }

    return { entries, corrupt: false, passwordProtected };
  } catch (error) {
    return {
      corrupt: true,
      passwordProtected: false,
      reason:
        error instanceof Error
          ? error.message
          : "ZIP metadata could not be inspected.",
    };
  }
}
