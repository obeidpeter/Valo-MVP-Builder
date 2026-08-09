import assert from "node:assert/strict";
import test from "node:test";
import { inspectArchiveStructure } from "./archiveInspection";

function singleEntryZip(input: {
  name: string;
  compressedBytes?: number;
  expandedBytes?: number;
  encrypted?: boolean;
}): Uint8Array {
  const name = Buffer.from(input.name);
  const compressedBytes = input.compressedBytes ?? 8;
  const expandedBytes = input.expandedBytes ?? 16;
  const centralOffset = 30 + name.length + compressedBytes;
  const centralSize = 46 + name.length;
  const eocd = centralOffset + centralSize;
  const bytes = Buffer.alloc(eocd + 22);
  bytes.writeUInt32LE(0x04034b50, 0);
  bytes.writeUInt16LE(input.encrypted ? 1 : 0, 6);
  bytes.writeUInt32LE(compressedBytes, 18);
  bytes.writeUInt32LE(expandedBytes, 22);
  bytes.writeUInt16LE(name.length, 26);
  name.copy(bytes, 30);
  bytes.writeUInt32LE(0x02014b50, centralOffset);
  bytes.writeUInt16LE(input.encrypted ? 1 : 0, centralOffset + 8);
  bytes.writeUInt32LE(compressedBytes, centralOffset + 20);
  bytes.writeUInt32LE(expandedBytes, centralOffset + 24);
  bytes.writeUInt16LE(name.length, centralOffset + 28);
  name.copy(bytes, centralOffset + 46);
  bytes.writeUInt32LE(0x06054b50, eocd);
  bytes.writeUInt16LE(1, eocd + 8);
  bytes.writeUInt16LE(1, eocd + 10);
  bytes.writeUInt32LE(centralSize, eocd + 12);
  bytes.writeUInt32LE(centralOffset, eocd + 16);
  return bytes;
}

test("reads archive paths and size evidence without expanding content", () => {
  const result = inspectArchiveStructure(
    singleEntryZip({
      name: "../payload.exe",
      compressedBytes: 2,
      expandedBytes: 1000,
      encrypted: true,
    }),
    100,
  );
  assert.equal(result.corrupt, false);
  assert.equal(result.passwordProtected, true);
  assert.deepEqual(result.entries, [
    {
      path: "../payload.exe",
      compressedBytes: 2,
      expandedBytes: 1000,
      encrypted: true,
    },
  ]);
});

test("malformed and ZIP64 containers fail closed", () => {
  const truncated = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
  assert.equal(inspectArchiveStructure(truncated, 100).corrupt, true);

  const zip64 = Buffer.from(singleEntryZip({ name: "safe.txt" }));
  zip64.writeUInt16LE(0xffff, zip64.length - 12);
  const result = inspectArchiveStructure(zip64, 100);
  assert.equal(result.corrupt, true);
  assert.match(result.reason ?? "", /ZIP64/);
});
