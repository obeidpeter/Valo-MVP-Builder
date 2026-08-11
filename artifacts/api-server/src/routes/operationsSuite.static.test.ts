import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routes = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const route = readFileSync(
  new URL("./operationsSuite.ts", import.meta.url),
  "utf8",
);
const durableStore = readFileSync(
  new URL("../lib/operationsSuite/drizzleStore.ts", import.meta.url),
  "utf8",
);
const service = readFileSync(
  new URL("../lib/operationsSuite/service.ts", import.meta.url),
  "utf8",
);

test("mounts the durable operations suite inside the authenticated tenant transaction", () => {
  const userBoundary = routes.indexOf("router.use(attachUser)");
  const tenantBoundary = routes.indexOf("router.use(attachTenantContext)");
  const databaseBoundary = routes.indexOf("router.use(attachTenantDatabase)");
  const resourceBoundary = routes.indexOf(
    "router.use(enforceTenantResourceBoundary)",
  );
  const suiteMount = routes.indexOf("router.use(operationsSuiteRouter)");

  assert.ok(userBoundary >= 0);
  assert.ok(userBoundary < tenantBoundary);
  assert.ok(tenantBoundary < databaseBoundary);
  assert.ok(databaseBoundary < resourceBoundary);
  assert.ok(resourceBoundary < suiteMount);
  assert.match(routes, /new DrizzleOperationsSuiteStore\(\)/u);
  assert.doesNotMatch(routes, /new InMemoryOperationsSuiteStore\(\)/u);
});

test("keeps every external operation record-only and permission-gated", () => {
  assert.match(route, /opportunityAcquisition: "record_only"/u);
  assert.match(route, /clientDelivery: "manual_out_of_band"/u);
  assert.match(route, /credentialVerification: "human_recorded"/u);
  assert.match(route, /submission: "record_only"/u);
  assert.match(route, /await writeAudit\(\{/u);
  assert.match(route, /externalActionPerformedByValo: false/u);
  assert.match(route, /authoritativeStatusReason: "versioned_record"/u);
  for (const permission of [
    "project:read",
    "project:update",
    "project:assign",
    "evidence:write",
    "evidence:approve",
    "package:export",
    "package:generate",
  ]) {
    assert.match(
      route,
      new RegExp(`requirePermissionOrLegacy\\("${permission}"\\)`, "u"),
    );
  }
});

test("filters reads by the canonical record domain without disclosing hidden records", () => {
  assert.match(
    route,
    /evidence_request: "evidence:read"[\s\S]*credential_verification: "evidence:read"/u,
  );
  assert.match(
    route,
    /submission_war_room: "package:read"[\s\S]*visual_qa_report: "package:read"/u,
  );
  assert.match(route, /snapshot\.records\.filter/u);
  assert.match(route, /canReadOperationsRecord\(req, record\)/u);
  assert.match(route, /"not_found",\s*"The record was not found\."/u);
  assert.match(route, /visibility:\s*\{[\s\S]*visibleKinds:/u);
});

test("binds package and document attestations to canonical persisted hashes", () => {
  assert.match(route, /sha256: documents\.sha256/u);
  assert.match(route, /contentType: documents\.contentType/u);
  assert.match(route, /document\.sha256 !== expectedSha256/u);
  assert.match(
    route,
    /accepted\.length > 0[\s\S]*!accepted\.includes\(canonicalContentType\)/u,
  );
  assert.match(route, /manifestHash: packageVersions\.manifestHash/u);
  assert.match(route, /renderQaStatus: packageVersions\.renderQaStatus/u);
  assert.match(route, /version\.manifestHash !== constraints\.manifestSha256/u);
  assert.match(route, /version\.renderQaStatus !== "passed"/u);
  assert.match(route, /eq\(vaultItems\.version, vaultItemVersion\)/u);
  assert.match(route, /eq\(vaultItems\.sha256, documentSha256\)/u);
  assert.match(route, /eq\(documents\.sha256, documentSha256\)/u);
  assert.match(route, /document\.extractionStatus === "quarantined"/u);
  assert.match(
    route,
    /documentRows\[0\]\?\.extractionStatus === "quarantined"/u,
  );
  assert.match(route, /\.for\("share"\)/u);
});

test("reference guards require active identities and reject UUID-shaped DB binds early", () => {
  assert.match(
    route,
    /\.innerJoin\(users, eq\(users\.id, organisationMemberships\.userId\)\)/u,
  );
  assert.match(route, /eq\(users\.status, "active"\)/u);
  assert.match(route, /function assertUuid\(/u);
  assert.match(route, /assertUuid\(documentId,/u);
  assert.match(route, /assertUuid\(packageVersionId,/u);
  assert.match(durableStore, /function assertDurableScope\(/u);
  assert.match(durableStore, /function assertDurableRecordId\(/u);
});

test("exposes a bounded restricted-content mobile projection", () => {
  assert.match(route, /"\/projects\/:id\/operations-suite\/mobile-queue"/u);
  assert.match(
    route,
    /operations\.mobileQueue\(scope, readableOperationsKinds\(req\)\)/u,
  );
});

test("serialises domain uniqueness and compare-and-swap under the tenant scope lock", () => {
  assert.match(
    durableStore,
    /currentTenantDatabaseOrganisation\(\) !== scope\.organisationId/u,
  );
  assert.match(
    durableStore,
    /await this\.#lockScope\(scope\);[\s\S]*const existing = await this\.list\(scope\);/u,
  );
  assert.match(
    durableStore,
    /candidate\.packageVersionId === record\.packageVersionId[\s\S]*candidate\.status !== "cancelled"/u,
  );
  const compareAndSwap = durableStore.indexOf("async compareAndSwap(");
  const compareLock = durableStore.indexOf(
    "await this.#lockScope(scope);",
    compareAndSwap,
  );
  const compareRead = durableStore.indexOf(
    "const current = await this.get(scope, id);",
    compareAndSwap,
  );
  assert.ok(compareAndSwap >= 0 && compareLock > compareAndSwap);
  assert.ok(compareRead > compareLock);
});

test("revalidates retained mission and post-award documents inside terminal CAS mutations", () => {
  const missionStart = service.indexOf("async updateMission(");
  const postAwardCreate = service.indexOf(
    "async createPostAwardItem(",
    missionStart,
  );
  const mission = service.slice(missionStart, postAwardCreate);
  const missionCas = mission.indexOf("this.#store.compareAndSwap(");
  const missionProofRecheck = mission.indexOf("proofs.map((proof)", missionCas);
  assert.ok(missionCas >= 0 && missionProofRecheck > missionCas);
  assert.match(
    mission.slice(missionProofRecheck),
    /this\.#references\.assertDocument\([\s\S]*proof\.documentId,[\s\S]*proof\.sha256/u,
  );

  const postAwardStart = service.indexOf("async updatePostAwardItem(");
  const postAward = service.slice(postAwardStart);
  const postAwardCas = postAward.indexOf("this.#store.compareAndSwap(");
  const evidenceRecheck = postAward.indexOf(
    "this.#references.assertDocuments(scope, evidenceDocumentIds)",
    postAwardCas,
  );
  const sourceRecheck = postAward.indexOf(
    "record.sourceDocumentId",
    postAwardCas,
  );
  assert.ok(postAwardCas >= 0 && evidenceRecheck > postAwardCas);
  assert.ok(sourceRecheck > postAwardCas);
  assert.match(
    postAward.slice(sourceRecheck),
    /this\.#references\.assertDocument\([\s\S]*record\.sourceDocumentId/u,
  );
});
