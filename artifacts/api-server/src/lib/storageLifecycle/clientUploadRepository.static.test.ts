import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./clientUploadRepository.ts", import.meta.url),
  "utf8",
);
const route = readFileSync(
  new URL("../../routes/clientActionUpload.ts", import.meta.url),
  "utf8",
);
const objectStorage = readFileSync(
  new URL("../objectStorage.ts", import.meta.url),
  "utf8",
);
const references = readFileSync(
  new URL("../storageReferences.ts", import.meta.url),
  "utf8",
);

test("lease and finalize lock authority, project, record and object before storage", () => {
  const authority = source.indexOf("resolveCurrentDirectAuthority(");
  const project = source.indexOf("scope.projectId}, 0)", authority);
  const record = source.indexOf("loadTargetForWrite(", project);
  const object = source.indexOf("lockStagedUploadObject(objectPath)", record);
  const storage = source.indexOf("downloadObjectEntityForIntake(", object);
  assert.ok(authority >= 0 && project > authority);
  assert.ok(record > project && object > record && storage > object);
  assert.match(source, /\.for\("update"\)/u);
  assert.match(source, /authority\.permissions\.has\("document:upload"\)/u);
});

test("closed lease replay is O(1), target-bound and project-capacity bounded", () => {
  assert.match(
    source,
    /deterministicLeaseId\([\s\S]*CLIENT_UPLOAD_LEASE_SCHEMA/u,
  );
  assert.match(source, /eq\(uploadSessions\.id, leaseId\)/u);
  assert.match(source, /assertLeaseMatches\(/u);
  assert.match(
    source,
    /limit\(STORAGE_LIFECYCLE_BOUNDS\.activeUploadLeasesPerProject \+ 1\)/u,
  );
  assert.match(source, /active\.recordId === command\.recordId/u);
  assert.match(source, /uploadSignedUrlMaximumSeconds/u);
  assert.match(source, /uploadSignedUrlLeaseCushionSeconds/u);
  assert.match(source, /signedNotAfter/u);
  assert.match(
    source,
    /lateRewriteClosure: STORAGE_LIFECYCLE_BOUNDS\.lateRewriteClosure/u,
  );
});

test("finalize downloads once, inspects exact material and commits all DB records atomically", () => {
  assert.equal(
    source.match(/downloadObjectEntityForIntake\(/gu)?.length,
    2,
    "one interface declaration plus one finalization call is expected",
  );
  assert.match(source, /intake\.bytes\.length === session\.expectedBytes/u);
  assert.match(source, /measuredSha256 === session\.expectedSha256/u);
  assert.match(source, /intake\.contentType === envelope\.contentType/u);
  assert.match(source, /inspectDocumentIntake/u);
  assert.match(source, /promoteStagedUploadToDocument\(/u);
  assert.match(source, /\.insert\(documents\)/u);
  assert.match(source, /\.insert\(documentVersions\)/u);
  assert.match(source, /\.update\(workTasks\)/u);
  assert.match(source, /\.update\(uploadSessions\)/u);
  assert.match(source, /eventType: "client_action\.upload_finalized"/u);
  assert.match(source, /rawFileAcceptedByApi: false/u);
});

test("staged leases remain sweep references and ambiguous cleanup fails closed", () => {
  assert.match(references, /uploadSessions/u);
  assert.match(references, /excludeUploadSessionId/u);
  assert.match(
    references,
    /eq\(uploadSessions\.status, "open"\)[\s\S]*eq\(uploadSessions\.status, "completed"\)[\s\S]*eq\(uploadSessions\.status, "rejected"\)[\s\S]*eq\(uploadSessions\.status, "quarantined"\)[\s\S]*eq\(uploadSessions\.status, "cleanup_unconfirmed"\)/u,
  );
  assert.match(source, /status: "cleanup_unconfirmed"/u);
  assert.match(source, /ObjectPromotionCleanupError/u);
  assert.match(source, /ObjectQuarantinePartialMoveError/u);
  assert.match(
    source,
    /quarantineObjectEntity\([\s\S]*intake\.contentType,[\s\S]*session\.id/u,
  );
  assert.doesNotMatch(
    source,
    /enqueueStorageDeletionIntentTx/u,
    "request-side expiry must leave the open lease for atomic multi-path sweep",
  );
  assert.match(objectStorage, /await deleteAndConfirmAbsent\(file\)/u);
});

test("route accepts bounded metadata only and exposes no generic portal", () => {
  assert.match(route, /CLIENT_UPLOAD_REQUEST_BODY_BYTES/u);
  assert.match(route, /requirePermissionOrLegacy\("document:upload"\)/u);
  assert.match(route, /accessContext\.source !== "membership"/u);
  assert.match(route, /Cache-Control", "private, no-store"/u);
  assert.match(route, /holdTenantDatabaseUntilComplete/u);
  assert.doesNotMatch(route, /multer|form-data|Readable|Buffer/u);
  assert.doesNotMatch(
    route,
    /sendExternal|deliverPackage|sendEmail|providerId/u,
  );
});
