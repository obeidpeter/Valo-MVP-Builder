import assert from "node:assert/strict";
import { test } from "node:test";
import {
  promoteEvidenceRenewalWithStorageLifecycle,
  type EvidenceRenewalApprovalCanonicalProjection,
  type EvidenceRenewalApprovalLifecycleDependencies,
  type EvidenceRenewalApprovalVaultProjection,
} from "./approvalLifecycle";

const ORGANISATION_ID = "11111111-1111-4111-8111-111111111111";
const OLD_PATH = `/objects/tenants/${ORGANISATION_ID}/documents/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
const NEW_PATH = `/objects/tenants/${ORGANISATION_ID}/documents/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb`;

const expected = {
  expectedVaultItemVersion: 7,
  documentId: "22222222-2222-4222-8222-222222222222",
  documentVersionId: "33333333-3333-4333-8333-333333333333",
  documentVersionNumber: 3,
  sha256: "a".repeat(64),
};

const canonical: EvidenceRenewalApprovalCanonicalProjection = {
  documentId: expected.documentId,
  documentVersionId: expected.documentVersionId,
  documentVersionNumber: expected.documentVersionNumber,
  sha256: expected.sha256,
  objectPath: NEW_PATH,
};

const legacyVault: EvidenceRenewalApprovalVaultProjection = {
  version: expected.expectedVaultItemVersion,
  objectPath: OLD_PATH,
  sourceDocumentId: null,
};

function dependencies(
  overrides: Partial<EvidenceRenewalApprovalLifecycleDependencies> = {},
): EvidenceRenewalApprovalLifecycleDependencies {
  return {
    readVaultCandidate: async () => legacyVault,
    readCanonicalCandidate: async () => canonical,
    lockObjectPath: async () => {},
    readVaultForUpdate: async () => legacyVault,
    readFreshCanonical: async () => canonical,
    promote: async () => {},
    enqueueSupersededObject: async () => {},
    ...overrides,
  };
}

test("locks candidate paths in global order and queues an old path even without sourceDocumentId", async () => {
  const calls: string[] = [];
  const outcome = await promoteEvidenceRenewalWithStorageLifecycle(
    expected,
    dependencies({
      readVaultCandidate: async () => {
        calls.push("read:vault-candidate");
        return legacyVault;
      },
      readCanonicalCandidate: async () => {
        calls.push("read:canonical-candidate");
        return canonical;
      },
      lockObjectPath: async (path) => {
        calls.push(`lock:${path}`);
      },
      readVaultForUpdate: async () => {
        calls.push("read:vault-for-update");
        return legacyVault;
      },
      readFreshCanonical: async () => {
        calls.push("read:canonical-fresh");
        return canonical;
      },
      promote: async () => {
        calls.push("promote");
      },
      enqueueSupersededObject: async (path) => {
        calls.push(`enqueue:${path}`);
      },
    }),
  );

  assert.equal(outcome, "promoted");
  assert.deepEqual(calls, [
    "read:vault-candidate",
    "read:canonical-candidate",
    `lock:${OLD_PATH}`,
    `lock:${NEW_PATH}`,
    "read:vault-for-update",
    "read:canonical-fresh",
    "promote",
    `enqueue:${OLD_PATH}`,
  ]);
});

test("path drift fails safely after candidate locks and asks the caller to retry", async () => {
  let promoted = false;
  let enqueued = false;
  const outcome = await promoteEvidenceRenewalWithStorageLifecycle(
    expected,
    dependencies({
      readVaultForUpdate: async () => ({
        ...legacyVault,
        objectPath: `${OLD_PATH}-drifted`,
      }),
      promote: async () => {
        promoted = true;
      },
      enqueueSupersededObject: async () => {
        enqueued = true;
      },
    }),
  );

  assert.equal(outcome, "vault_conflict");
  assert.equal(promoted, false);
  assert.equal(enqueued, false);
});

test("canonical path drift also fails before CAS or deletion-intent creation", async () => {
  let promoted = false;
  let enqueued = false;
  const outcome = await promoteEvidenceRenewalWithStorageLifecycle(
    expected,
    dependencies({
      readFreshCanonical: async () => ({
        ...canonical,
        objectPath: `${NEW_PATH}-drifted`,
      }),
      promote: async () => {
        promoted = true;
      },
      enqueueSupersededObject: async () => {
        enqueued = true;
      },
    }),
  );

  assert.equal(outcome, "evidence_conflict");
  assert.equal(promoted, false);
  assert.equal(enqueued, false);
});

test("an enqueue failure escapes after CAS so the surrounding transaction rolls it back", async () => {
  const persisted = { objectPath: OLD_PATH };
  const calls: string[] = [];

  async function transaction(work: () => Promise<void>): Promise<void> {
    const before = persisted.objectPath;
    try {
      await work();
      calls.push("commit");
    } catch (error) {
      persisted.objectPath = before;
      calls.push("rollback");
      throw error;
    }
  }

  await assert.rejects(
    transaction(async () => {
      await promoteEvidenceRenewalWithStorageLifecycle(
        expected,
        dependencies({
          promote: async () => {
            calls.push("promote");
            persisted.objectPath = NEW_PATH;
          },
          enqueueSupersededObject: async () => {
            calls.push("enqueue");
            throw new Error("queue unavailable");
          },
        }),
      );
    }),
    /queue unavailable/u,
  );

  assert.deepEqual(calls, ["promote", "enqueue", "rollback"]);
  assert.equal(persisted.objectPath, OLD_PATH);
});
