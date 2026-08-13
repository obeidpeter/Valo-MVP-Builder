import assert from "node:assert/strict";
import test from "node:test";
import { createStorageDeletionIntent } from "./contracts";
import { runStorageDeletionReconciliation } from "./reconciler";
import type {
  StoredStorageDeletionIntent,
  StorageDeletionObjectStore,
} from "./repository";

const ORG_A = "10000000-0000-4000-8000-000000000001";
const ORG_B = "20000000-0000-4000-8000-000000000002";
const PROJECT = "30000000-0000-4000-8000-000000000003";
const EVENT_A = "40000000-0000-4000-8000-000000000004";
const EVENT_B = "50000000-0000-4000-8000-000000000005";

function intent(
  organisationId: string,
  id: string,
): StoredStorageDeletionIntent {
  return {
    id,
    version: 1,
    status: "queued",
    replayed: false,
    envelope: createStorageDeletionIntent({
      organisationId,
      projectId: PROJECT,
      objectPath: `/objects/tenants/${organisationId}/documents/${id}`,
      aggregateType: "document",
      aggregateId: id,
      reason: "record_deleted",
      requestedAt: "2026-08-13T12:00:00.000Z",
    }),
  };
}

const objectStore: StorageDeletionObjectStore = {
  deleteObjectEntity: async () => true,
};

test("reconciler gives each tenant one bounded FIFO page and isolates failures", async () => {
  const calls: string[] = [];
  let page = 0;
  const result = await runStorageDeletionReconciliation({
    listOrganisationIds: async (after, limit) => {
      assert.equal(limit, 11);
      calls.push(`page:${after ?? "start"}`);
      page += 1;
      return page === 1 ? [ORG_A, ORG_B] : [];
    },
    listIntents: async (organisationId) => {
      calls.push(`list:${organisationId}`);
      if (organisationId === ORG_B) throw new Error("tenant unavailable");
      return {
        items: [intent(ORG_A, EVENT_A), intent(ORG_A, EVENT_B)],
        limit: 5,
        truncated: true,
      };
    },
    sweepExpiredLeases: async (organisationId) => {
      calls.push(`sweep:${organisationId}`);
      return organisationId === ORG_A
        ? {
            considered: 2,
            expired: 1,
            completedCleanupQueued: 1,
            rejectedCleanupQueued: 0,
            quarantinedCleanupQueued: 0,
            cleanupUnconfirmedPostExpiryQueued: 0,
            truncated: false,
          }
        : {
            considered: 0,
            expired: 0,
            completedCleanupQueued: 0,
            rejectedCleanupQueued: 0,
            quarantinedCleanupQueued: 0,
            cleanupUnconfirmedPostExpiryQueued: 0,
            truncated: false,
          };
    },
    reconcile: async ({ eventId, expectedVersion, organisationId }) => {
      calls.push(`reconcile:${eventId}`);
      assert.equal(organisationId, ORG_A);
      assert.equal(expectedVersion, 1);
      return eventId === EVENT_A
        ? {
            outcome: "completed" as const,
            eventId,
            version: 2,
            objectDeleted: true,
            references: [],
          }
        : {
            outcome: "retry_wait" as const,
            eventId,
            version: 2,
            objectDeleted: false,
            references: [],
          };
    },
    objectStore,
    now: () => new Date("2026-08-13T12:00:00.000Z"),
    monotonicNow: () => 0,
  });

  assert.deepEqual(result, {
    organisationsScanned: 2,
    uploadLeasesConsidered: 2,
    uploadLeasesExpired: 1,
    completedLeaseCleanupQueued: 1,
    rejectedLeaseCleanupQueued: 0,
    quarantinedLeaseCleanupQueued: 0,
    unconfirmedLeaseCleanupQueued: 0,
    uploadLeasePagesRemaining: 0,
    intentsConsidered: 2,
    completed: 1,
    cancelled: 0,
    replayed: 0,
    retryWait: 1,
    deadLetter: 0,
    tenantPagesRemaining: 1,
    tenantFailures: 1,
    intentFailures: 0,
    oldestPendingAgeSeconds: 0,
    organisationPageTruncated: true,
    cycleComplete: false,
    // The cursor advances only through the last fully processed tenant, so
    // the failed tenant is retried on the next bounded run rather than skipped.
    nextOrganisationCursor: ORG_A,
  });
  assert.deepEqual(calls, [
    "page:start",
    `sweep:${ORG_A}`,
    `list:${ORG_A}`,
    `reconcile:${EVENT_A}`,
    `reconcile:${EVENT_B}`,
    `sweep:${ORG_B}`,
    `list:${ORG_B}`,
  ]);
});

test("reconciler rejects a non-monotonic organisation page", async () => {
  await assert.rejects(
    runStorageDeletionReconciliation({
      listOrganisationIds: async () => [ORG_B, ORG_A],
      listIntents: async () => ({
        items: [],
        limit: 5,
        truncated: false,
      }),
      sweepExpiredLeases: async () => ({
        considered: 0,
        expired: 0,
        completedCleanupQueued: 0,
        rejectedCleanupQueued: 0,
        quarantinedCleanupQueued: 0,
        cleanupUnconfirmedPostExpiryQueued: 0,
        truncated: false,
      }),
      reconcile: async () => {
        throw new Error("unreachable");
      },
      objectStore,
      now: () => new Date("2026-08-13T12:00:00.000Z"),
      monotonicNow: () => 0,
    }),
    /organisation page is invalid/u,
  );
});

test("tenant discovery does not restrict lifecycle cleanup to active organisations", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("./reconciler.ts", import.meta.url), "utf8"),
  );
  assert.doesNotMatch(source, /organisations\.status/u);
  assert.match(source, /\.from\(organisations\)/u);
  assert.match(source, /gt\(organisations\.id, afterOrganisationId\)/u);
});
