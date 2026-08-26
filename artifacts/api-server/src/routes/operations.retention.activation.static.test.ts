import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (name: string) =>
  readFileSync(new URL(name, import.meta.url), "utf8");

const operations = source("./operations.ts");
const completionRoute = source("./retentionCompletion.ts");
const routeIndex = source("./index.ts");
const completionService = source("../lib/retentionCompletion/service.ts");
const completionRepository = source(
  "../lib/retentionCompletion/drizzleRepository.ts",
);
const projects = source("./projects.ts");
const openapi = source("../../../../lib/api-spec/openapi.yaml");

test("retention request creation remains mounted while completion is isolated", () => {
  assert.match(operations, /"\/projects\/:id\/retention-requests"/u);
  assert.doesNotMatch(operations, /"\/retention-requests\/:id\/complete"/u);
  assert.match(completionRoute, /"\/retention-requests\/:id\/complete"/u);
  assert.match(completionRoute, /"\/retention-actions\/:id\/reconcile"/u);
  assert.match(completionRoute, /"\/retention-actions\/:id\/certify"/u);
});

test("production completion is bound to the checked fail-closed manifest", () => {
  assert.match(
    routeIndex,
    /activationManifest:\s*loadCheckedRetentionCompletionActivationManifest\(\)/u,
  );
  assert.match(completionService, /#assertActivated\(\)/u);
  assert.match(
    completionService,
    /No data was deleted and no deletion certificate was issued/u,
  );
  const gateAt = completionService.indexOf("this.#assertActivated()");
  const detachAt = completionService.indexOf("this.#repository.detach", gateAt);
  assert.ok(gateAt >= 0 && detachAt > gateAt);
});

test("retention never performs synchronous blob deletion or direct project DELETE", () => {
  assert.match(completionRepository, /enqueueStorageDeletionIntentTx/u);
  assert.match(completionRepository, /purge_retention_project/u);
  assert.doesNotMatch(
    completionRepository,
    /ObjectStorageService|deleteObjectEntity|purgeBlobs/u,
  );
  assert.doesNotMatch(
    operations,
    /ObjectStorageService|planProjectBlobPurge|purgeBlobs/u,
  );
  assert.match(projects, /Direct deletion is disabled/u);
  const projectDeleteContract = openapi.slice(
    openapi.indexOf("  /projects/{id}:"),
    openapi.indexOf("  /workflow/alerts:"),
  );
  // The retired deleteProject compatibility operation has left the contract
  // entirely; only the server keeps its fail-closed 409 stub for stale
  // clients. No delete operation — working or deprecated — may reappear on
  // the project resource.
  assert.doesNotMatch(projectDeleteContract, /^    delete:/mu);
  assert.doesNotMatch(projectDeleteContract, /"204":/u);
});
