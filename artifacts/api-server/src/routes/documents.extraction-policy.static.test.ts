import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./documents.ts", import.meta.url), "utf8");
const createStart = source.indexOf('"/projects/:id/documents"');
const workerStart = source.indexOf("async function runClaimedExtraction");
const manualStart = source.indexOf('"/documents/:id/extract"');
const patchStart = source.indexOf("router.patch(");
const createSource = source.slice(createStart, workerStart);
const workerSource = source.slice(workerStart, manualStart);
const manualSource = source.slice(manualStart, patchStart);
const patchSource = source.slice(patchStart);
const tenancySource = readFileSync(
  new URL("../middlewares/tenancy.ts", import.meta.url),
  "utf8",
);
const databaseTenancySource = readFileSync(
  new URL("../middlewares/databaseTenancy.ts", import.meta.url),
  "utf8",
);
const extractTextSource = readFileSync(
  new URL("../lib/extractText.ts", import.meta.url),
  "utf8",
);
const llmSource = readFileSync(
  new URL("../lib/llm.ts", import.meta.url),
  "utf8",
);

test("new registrations are excluded/no-model and never auto-schedule extraction", () => {
  assert.match(createSource, /parsed\.data\.redactionStatus !== "excluded"/);
  assert.match(createSource, /initialExtractionState\("excluded"\)/);
  assert.doesNotMatch(createSource, /runClaimedExtraction\(/);
  assert.doesNotMatch(createSource, /extractDocumentTextFromBuffer\(/);
  const promotionAt = createSource.indexOf(
    "await objectStorage.promoteStagedUploadToDocument(",
  );
  const insertAt = createSource.indexOf(".insert(documents)", promotionAt);
  assert.ok(promotionAt >= 0 && insertAt > promotionAt);
  assert.match(createSource, /objectPath: finalizedObjectPath/);
  const finalNdaLockAt = createSource.indexOf(
    "projectNdaStatus(projectId, true)",
  );
  assert.ok(finalNdaLockAt >= 0 && finalNdaLockAt < promotionAt);
  assert.match(source, /query\.for\("share", \{ of: clients \}\)/);
});

test("accepted registration atomically creates a truthful governed version manifest", () => {
  const documentInsertAt = createSource.indexOf(".insert(documents)");
  const versionInsertAt = createSource.indexOf(
    "db.insert(documentVersions)",
    documentInsertAt,
  );
  const auditAt = createSource.indexOf(
    'eventType: "document.created"',
    versionInsertAt,
  );
  assert.ok(documentInsertAt >= 0 && versionInsertAt > documentInsertAt);
  assert.ok(
    auditAt > versionInsertAt,
    "version creation must precede success audit",
  );
  assert.match(
    createSource,
    /inspection\.malware\.state !== "clean"[\s\S]*inspection\.disposition !== "ready"[\s\S]*!inspection\.mayProcess/,
  );
  assert.match(
    createSource,
    /malwareStatus: "clean"[\s\S]*quarantineStatus: "cleared"/,
  );
  assert.match(createSource, /detectedFormat: inspection\.detectedFormat/);
  assert.match(
    createSource,
    /canonicalMimeForDetectedFormat\([\s\S]*inspection\.detectedFormat/,
  );
  assert.doesNotMatch(
    createSource,
    /const detectedMime = parsed\.data\.contentType/,
  );
  assert.match(
    createSource,
    /promoteStagedUploadToDocument\([\s\S]*buffer,[\s\S]*detectedMime/,
  );
  assert.match(source, /valo\.document-version-integrity\/v1/);
  assert.match(source, /scannerEvidenceSha256/);
  assert.doesNotMatch(
    source,
    /scanner:\s*\{[\s\S]*evidence:\s*input\.scannerEvidence/,
  );
});

test("manual extraction verifies the intake hash before inspection or parser/model", () => {
  const hashAt = manualSource.indexOf("const actualSha256 = sha256Hex(buffer)");
  const mismatchAt = manualSource.indexOf(
    "actualSha256 !== doc.sha256",
    hashAt,
  );
  const inspectionAt = manualSource.indexOf(
    "await inspectDocumentIntake(",
    mismatchAt,
  );
  const workerAt = manualSource.indexOf(
    "await runClaimedExtraction(",
    inspectionAt,
  );
  assert.ok(hashAt >= 0 && mismatchAt > hashAt);
  assert.ok(
    inspectionAt > mismatchAt,
    "integrity gate must precede inspection",
  );
  assert.ok(
    workerAt > inspectionAt,
    "integrity gate must precede parser/model",
  );
  assert.match(
    manualSource,
    /!doc\.sha256 \|\| actualSha256 !== doc\.sha256[\s\S]*status\(409\)/,
  );
});

test("manual extraction claims processing atomically before invoking the worker", () => {
  const claimAt = manualSource.indexOf('extractionStatus: "extracting"');
  const eligibilityAt = manualSource.indexOf(
    'ne(documents.redactionStatus, "excluded")',
  );
  const workerAt = manualSource.indexOf("await runClaimedExtraction(");
  const responseAt = manualSource.indexOf("res.status(200)", workerAt);
  assert.ok(claimAt >= 0, "atomic extraction claim missing");
  assert.ok(eligibilityAt > claimAt, "claim must require eligible redaction");
  assert.ok(workerAt > eligibilityAt, "worker must start only after the claim");
  assert.ok(
    responseAt > workerAt,
    "response must wait for the extraction worker",
  );
  assert.match(manualSource, /if \(!claimed\)[\s\S]*status\(409\)/);
  assert.match(
    tenancySource,
    /pg_advisory_xact_lock\(hashtextextended\(\$\{projectId\}, 0\)\)/,
  );
});

test("only reviewers can change redaction or deliberately start extraction", () => {
  assert.match(manualSource, /requirePermissionOrLegacy\("evidence:approve"\)/);
  const reviewerGuardAt = patchSource.indexOf(
    'hasRequestPermission(req, "evidence:approve")',
  );
  const updateAt = patchSource.indexOf(".update(documents)", reviewerGuardAt);
  assert.ok(reviewerGuardAt >= 0 && updateAt > reviewerGuardAt);
  assert.match(patchSource, /redactionChange[\s\S]*status\(403\)[\s\S]*return/);
});

test("disconnect keeps tenant/project locks until parser or model work settles", () => {
  const holdAt = manualSource.indexOf("holdTenantDatabaseUntilComplete(req)");
  const closeAt = manualSource.indexOf('res.once("close", abortOnDisconnect)');
  const claimAt = manualSource.indexOf('extractionStatus: "extracting"');
  const workerAt = manualSource.indexOf("await runClaimedExtraction(", claimAt);
  const releaseAt = manualSource.indexOf(
    "releaseTenantWork(routeError)",
    workerAt,
  );
  assert.ok(holdAt >= 0 && closeAt > holdAt && claimAt > closeAt);
  assert.ok(workerAt > claimAt && releaseAt > workerAt);
  assert.match(
    databaseTenancySource,
    /control\.holds > 0[\s\S]*?null[\s\S]*?Tenant request connection closed early/,
  );
  assert.match(
    databaseTenancySource,
    /if \(control\.terminal && control\.holds === 0\)[\s\S]*control\.settle/,
  );
  assert.match(extractTextSource, /signal\?\.throwIfAborted\(\)/);
  assert.match(
    llmSource,
    /signal\?\.throwIfAborted\(\)[\s\S]*executeProjectAi/,
  );
});

test("security reinspection creates an in-place logical quarantine without claiming a move", () => {
  assert.match(
    manualSource,
    /securityBlocked[\s\S]*extractionStatus: "quarantined"[\s\S]*redactionStatus: "excluded"/,
  );
  assert.match(
    manualSource,
    /contentText: null[\s\S]*eventType: "document\.reinspection_security_blocked"/,
  );
  assert.match(manualSource, /storageMoved: false/);
  assert.match(
    manualSource,
    /doc\.extractionStatus === "quarantined"[\s\S]*status\(409\)/,
  );
  assert.match(
    patchSource,
    /existing\.extractionStatus === "quarantined"[\s\S]*status\(409\)/,
  );
});

test("worker completion and failure are compare-and-set writes", () => {
  const statusGuards =
    workerSource.match(/eq\(documents\.extractionStatus, "extracting"\)/g) ??
    [];
  const redactionGuards =
    workerSource.match(/ne\(documents\.redactionStatus, "excluded"\)/g) ?? [];
  assert.equal(statusGuards.length, 2);
  assert.equal(redactionGuards.length, 2);
});

test("PATCH exclusion cannot claim success once processing has started", () => {
  assert.match(
    patchSource,
    /excluding[\s\S]*ne\(documents\.extractionStatus, "extracting"\)/,
  );
  assert.match(
    patchSource,
    /current\?\.extractionStatus === "extracting"[\s\S]*status\(409\)/,
  );
  assert.match(patchSource, /redaction status was not changed/);
});
