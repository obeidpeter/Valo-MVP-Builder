import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ObjectPromotionCleanupError,
  ObjectQuarantinePartialMoveError,
  ObjectStorageService,
} from "./objectStorage";

const source = readFileSync(
  new URL("./objectStorage.ts", import.meta.url),
  "utf8",
);
const promotionStart = source.indexOf("async promoteStagedUploadToDocument(");
const promotionEnd = source.indexOf(
  "normalizeObjectEntityPath(",
  promotionStart,
);
const promotion = source.slice(promotionStart, promotionEnd);
const quarantineStart = source.indexOf("async quarantineObjectEntity(");
const quarantine = source.slice(quarantineStart, promotionStart);
const documentRouteSource = readFileSync(
  new URL("../routes/documents.ts", import.meta.url),
  "utf8",
);

test("promotion writes the inspected bytes to a non-upload create-only path", () => {
  assert.match(promotion, /`\/documents\/\$\{documentId\}`/);
  assert.match(promotion, /destination\.save\(inspectedBytes/);
  assert.match(promotion, /ifGenerationMatch: 0/);
  assert.doesNotMatch(promotion, /source\.copy\(/);
  const existenceAt = promotion.indexOf("await this.getObjectEntityFile(");
  const copyAt = promotion.indexOf("await destination.save(");
  const deleteAt = promotion.indexOf("await source.delete(");
  assert.ok(existenceAt >= 0 && copyAt > existenceAt);
  assert.ok(deleteAt > copyAt);
});

test("quarantine supports a durable caller identity and verifies exact inspected bytes create-only", () => {
  assert.match(
    quarantine,
    /const quarantineId = requestedQuarantineId \?\? randomUUID\(\)/,
  );
  assert.match(quarantine, /`\/quarantine\/\$\{quarantineId\}`/);
  assert.match(quarantine, /destination\.save\(inspectedBytes/);
  assert.match(quarantine, /ifGenerationMatch: 0/);
  assert.match(quarantine, /destination\.createReadStream\(\)/);
  assert.match(quarantine, /storedBytes\.equals\(inspectedBytes\)/);
  assert.doesNotMatch(quarantine, /file\.copy\(/);
});

test("promotion rolls back the stable copy if staging revocation fails", () => {
  assert.match(
    promotion,
    /catch \(error\)[\s\S]*deleteAndConfirmAbsent\(destination\)[\s\S]*ObjectPromotionCleanupError[\s\S]*throw error/,
  );
});

const organisationId = "11111111-1111-4111-8111-111111111111";
const uploadId = "22222222-2222-4222-8222-222222222222";
const documentId = "33333333-3333-4333-8333-333333333333";
const stagedPath = `/objects/tenants/${organisationId}/uploads/${uploadId}`;

function serviceWithSource(source: object): ObjectStorageService {
  const service = new ObjectStorageService();
  Object.defineProperty(service, "getObjectEntityFile", {
    value: async () => source,
  });
  return service;
}

test("save-committed/ACK-lost promotion reports unconfirmed stable cleanup", async () => {
  let remoteStableCopyExists = false;
  const acknowledgementLost = new Error("save acknowledgement lost");
  const destination = {
    save: async () => {
      remoteStableCopyExists = true;
      throw acknowledgementLost;
    },
    delete: async () => {
      throw new Error("delete acknowledgement lost");
    },
    exists: async () => {
      throw new Error("absence probe unavailable");
    },
  };
  const source = {
    name: `private/tenants/${organisationId}/uploads/${uploadId}`,
    bucket: { file: () => destination },
    delete: async () => undefined,
  };

  await assert.rejects(
    serviceWithSource(source).promoteStagedUploadToDocument(
      stagedPath,
      documentId,
      Buffer.from("inspected"),
      "application/pdf",
    ),
    (error: unknown) =>
      error instanceof ObjectPromotionCleanupError &&
      error.destinationPath ===
        `/objects/tenants/${organisationId}/documents/${documentId}`,
  );
  assert.equal(remoteStableCopyExists, true);
});

test("copy-success/source-delete-failure preserves confirmed quarantine retention", async () => {
  let quarantineCopyExists = false;
  const destination = {
    save: async () => {
      quarantineCopyExists = true;
    },
    createReadStream: () =>
      (async function* () {
        yield Buffer.from("inspected");
      })(),
  };
  const source = {
    name: `private/tenants/${organisationId}/uploads/${uploadId}`,
    bucket: { file: () => destination },
    delete: async () => {
      throw new Error("source delete failed");
    },
  };

  await assert.rejects(
    serviceWithSource(source).quarantineObjectEntity(
      stagedPath,
      Buffer.from("inspected"),
      "application/pdf",
      uploadId,
    ),
    (error: unknown) =>
      error instanceof ObjectQuarantinePartialMoveError &&
      error.quarantineCopyConfirmed === true &&
      error.quarantinePath ===
        `/objects/tenants/${organisationId}/quarantine/${uploadId}`,
  );
  assert.equal(quarantineCopyExists, true);
});

test("copy-committed/ACK-lost with failed probe returns an unknown quarantine disposition", async () => {
  let quarantineCopyExists = false;
  const destination = {
    save: async () => {
      quarantineCopyExists = true;
      throw new Error("save acknowledgement lost");
    },
    delete: async () => {
      throw new Error("cleanup acknowledgement lost");
    },
    exists: async () => {
      throw new Error("probe unavailable");
    },
  };
  const source = {
    name: `private/tenants/${organisationId}/uploads/${uploadId}`,
    bucket: { file: () => destination },
    delete: async () => undefined,
  };

  await assert.rejects(
    serviceWithSource(source).quarantineObjectEntity(
      stagedPath,
      Buffer.from("inspected"),
      "application/pdf",
      uploadId,
    ),
    (error: unknown) =>
      error instanceof ObjectQuarantinePartialMoveError &&
      error.quarantineCopyConfirmed === false &&
      error.quarantinePath ===
        `/objects/tenants/${organisationId}/quarantine/${uploadId}`,
  );
  assert.equal(quarantineCopyExists, true);
});

test("intake response keeps ambiguous quarantine retention explicitly unknown", () => {
  assert.match(
    documentRouteSource,
    /error\.quarantineCopyConfirmed \? true : null/,
  );
  assert.match(
    documentRouteSource,
    /possibleQuarantinedPath[\s\S]*quarantineRetained[\s\S]*cleanupConfirmed/,
  );
  assert.doesNotMatch(
    documentRouteSource,
    /quarantineRetained: quarantinedPath !== null/,
  );
});
