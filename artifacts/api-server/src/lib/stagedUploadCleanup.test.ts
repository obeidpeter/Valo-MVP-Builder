import assert from "node:assert/strict";
import test from "node:test";
import {
  discardStagedUpload,
  isOwnedStagedUploadPath,
} from "./stagedUploadCleanup";

const tenantId = "11111111-1111-4111-8111-111111111111";
const otherTenantId = "22222222-2222-4222-8222-222222222222";
const objectId = "33333333-3333-4333-8333-333333333333";
const ownedPath = `/objects/tenants/${tenantId}/uploads/${objectId}`;

test("cleanup accepts only an exact staged object in the active tenant", () => {
  assert.equal(isOwnedStagedUploadPath(ownedPath, tenantId), true);
  assert.equal(
    isOwnedStagedUploadPath(
      `/objects/tenants/${otherTenantId}/uploads/${objectId}`,
      tenantId,
    ),
    false,
  );
  assert.equal(
    isOwnedStagedUploadPath(
      `/objects/tenants/${tenantId}/quarantine/${objectId}`,
      tenantId,
    ),
    false,
  );
  assert.equal(
    isOwnedStagedUploadPath("https://objects.test/signed-delete", tenantId),
    false,
  );
});

test("cleanup never deletes an object already referenced by a document", async () => {
  let deleteCalls = 0;
  const result = await discardStagedUpload(
    { objectPath: ownedPath, organisationId: tenantId },
    {
      isReferenced: async () => true,
      deleteObject: async () => {
        deleteCalls += 1;
        return true;
      },
    },
  );

  assert.equal(result, "referenced");
  assert.equal(deleteCalls, 0);
});

test("cleanup deletes an unreferenced staged object and remains idempotent", async () => {
  const results = [true, false];
  const dependencies = {
    isReferenced: async () => false,
    deleteObject: async () => results.shift() ?? false,
  };

  assert.equal(
    await discardStagedUpload(
      { objectPath: ownedPath, organisationId: tenantId },
      dependencies,
    ),
    "deleted",
  );
  assert.equal(
    await discardStagedUpload(
      { objectPath: ownedPath, organisationId: tenantId },
      dependencies,
    ),
    "already_absent",
  );
});
