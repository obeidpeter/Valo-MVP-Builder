import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./storageReferences.ts", import.meta.url),
  "utf8",
);
const storageRouteSource = readFileSync(
  new URL("../routes/storage.ts", import.meta.url),
  "utf8",
);

test("storage cleanup inventory covers every persisted object-path column", () => {
  for (const column of [
    "documents.objectPath",
    "documentVersions.objectPath",
    "vaultItems.objectPath",
    "reports.docxPath",
    "reports.pdfPath",
    "packageVersions.docxObjectPath",
    "packageVersions.pdfObjectPath",
    "packageVersions.zipObjectPath",
    "partnerBranding.logoObjectPath",
  ]) {
    assert.match(source, new RegExp(column.replace(".", "\\.")), column);
  }
});

test("generic object reads deny controlled outputs and unreferenced paths", () => {
  const getRouteAt = storageRouteSource.indexOf('"/storage/objects/*path"');
  const referenceAt = storageRouteSource.indexOf(
    "storagePathReferenceKinds(objectPath)",
    getRouteAt,
  );
  const quarantineAt = storageRouteSource.indexOf(
    "hasSecurityQuarantinedDocumentReference(objectPath)",
    referenceAt,
  );
  const controlledAt = storageRouteSource.indexOf(
    '"report", "package_version", "partner_branding"',
    referenceAt,
  );
  const sourceAt = storageRouteSource.indexOf(
    '"document", "vault_item"',
    controlledAt,
  );
  const storageReadAt = storageRouteSource.indexOf(
    "getObjectEntityFile(objectPath)",
    sourceAt,
  );
  const auditAt = storageRouteSource.indexOf(
    'eventType: "storage.object_download_authorized"',
    storageReadAt,
  );
  const streamAt = storageRouteSource.indexOf(
    "downloadObject(objectFile)",
    auditAt,
  );
  assert.ok(getRouteAt >= 0 && referenceAt > getRouteAt);
  assert.ok(quarantineAt > referenceAt, "logical quarantine check missing");
  assert.ok(controlledAt > referenceAt && sourceAt > controlledAt);
  assert.ok(
    storageReadAt > sourceAt,
    "authorization must precede storage read",
  );
  assert.ok(auditAt > storageReadAt, "download audit missing");
  assert.ok(
    streamAt > auditAt,
    "audit must complete before bytes are streamed",
  );
  assert.doesNotMatch(
    storageRouteSource.slice(getRouteAt),
    /eventType: "storage\.object_downloaded"/,
  );
});

test("logical security quarantine is persisted and blocks generic reads", () => {
  assert.match(source, /eq\(documents\.extractionStatus, "quarantined"\)/);
  assert.match(
    storageRouteSource,
    /securityQuarantined \|\| controlledOutput \|\| !readableSource/,
  );
});
