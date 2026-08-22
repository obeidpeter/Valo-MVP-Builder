import assert from "node:assert/strict";
import test from "node:test";
import {
  StorageLifecycleContractError,
  clientUploadDocumentPath,
  clientUploadObjectPath,
  clientUploadQuarantinePath,
  createClientUploadLeaseEnvelope,
  createStorageDeletionIntent,
  parseClientUploadLeaseEnvelope,
  parseStorageDeletionIntent,
  serializeClientUploadLeaseEnvelope,
  serializeStorageDeletionIntent,
} from "./contracts";

const ORG = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const ACTOR = "33333333-3333-4333-8333-333333333333";
const RECORD = "44444444-4444-4444-8444-444444444444";
const SLOT = "55555555-5555-4555-8555-555555555555";
const INTENT = "66666666-6666-4666-8666-666666666666";
const LEASE = "77777777-7777-4777-8777-777777777777";

test("client upload lease envelope is closed, hashed and path deterministic", () => {
  const envelope = createClientUploadLeaseEnvelope({
    idempotencyKey: "client-upload-test-0001",
    actorUserId: ACTOR,
    recordId: RECORD,
    recordVersion: 3,
    slotId: SLOT,
    intentId: INTENT,
    contentType: "Application/PDF",
  });
  assert.equal(envelope.contentType, "application/pdf");
  assert.match(envelope.idempotencyKeySha256, /^[0-9a-f]{64}$/u);
  assert.deepEqual(
    parseClientUploadLeaseEnvelope(
      serializeClientUploadLeaseEnvelope(envelope),
    ),
    envelope,
  );
  assert.equal(
    clientUploadObjectPath(ORG, LEASE),
    `/objects/tenants/${ORG}/uploads/${LEASE}`,
  );
  assert.equal(
    clientUploadDocumentPath(ORG, LEASE),
    `/objects/tenants/${ORG}/documents/${LEASE}`,
  );
  assert.equal(
    clientUploadQuarantinePath(ORG, LEASE),
    `/objects/tenants/${ORG}/quarantine/${LEASE}`,
  );
});

test("client upload lease parsing rejects additional fields", () => {
  const envelope = createClientUploadLeaseEnvelope({
    idempotencyKey: "client-upload-test-0002",
    actorUserId: ACTOR,
    recordId: RECORD,
    recordVersion: 3,
    slotId: SLOT,
    intentId: INTENT,
    contentType: "application/pdf",
  });
  assert.throws(
    () =>
      parseClientUploadLeaseEnvelope(
        JSON.stringify({ ...envelope, signedUrl: "secret" }),
      ),
    StorageLifecycleContractError,
  );
});

test("storage deletion intent is tenant-bound and tamper evident", () => {
  const intent = createStorageDeletionIntent({
    organisationId: ORG,
    projectId: PROJECT,
    objectPath: `/objects/tenants/${ORG}/documents/${LEASE}`,
    aggregateType: "document",
    aggregateId: LEASE,
    reason: "record_deleted",
    requestedAt: "2026-08-13T08:00:00.000Z",
  });
  assert.deepEqual(
    parseStorageDeletionIntent(serializeStorageDeletionIntent(intent)),
    intent,
  );
  assert.throws(
    () =>
      parseStorageDeletionIntent(
        JSON.stringify({ ...intent, objectPath: "/objects/tenants/other/x" }),
      ),
    StorageLifecycleContractError,
  );
});

test("retention completion uses the closed durable deletion contract", () => {
  const intent = createStorageDeletionIntent({
    organisationId: ORG,
    projectId: PROJECT,
    objectPath: `/objects/tenants/${ORG}/retention/${RECORD}`,
    aggregateType: "project_retention",
    aggregateId: RECORD,
    reason: "retention_completion",
    requestedAt: "2026-08-22T12:00:00.000Z",
  });
  assert.deepEqual(
    parseStorageDeletionIntent(serializeStorageDeletionIntent(intent)),
    intent,
  );
});
