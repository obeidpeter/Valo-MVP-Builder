import "../../test-env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import {
  auditEvents,
  clients,
  db,
  documents,
  notificationAttempts,
  notificationEvents,
  organisations,
  projects,
  withTenantDatabase,
} from "@workspace/db";
import { and, asc, eq, sql } from "drizzle-orm";
import { lockStagedUploadObject } from "../stagedUploadLock";
import {
  enqueueStorageDeletionIntent,
  listPendingStorageDeletionIntents,
  purgeRetainedStorageDeletionTerminals,
  reconcileStorageDeletionIntent,
} from "./repository";

let organisationId: string;
let clientId: string;
let projectId: string;

function objectPath(label: string): string {
  return `/objects/tenants/${organisationId}/documents/${label}-${randomUUID()}`;
}

async function enqueue(path: string, aggregateId: string, requestedAt: Date) {
  return withTenantDatabase(organisationId, () =>
    enqueueStorageDeletionIntent({
      organisationId,
      projectId,
      objectPath: path,
      aggregateType: "document",
      aggregateId,
      reason: "record_deleted",
      requestedAt,
      actor: null,
    }),
  );
}

before(async () => {
  const stamp = randomUUID();
  const [organisation] = await db
    .insert(organisations)
    .values({
      name: `Storage lifecycle integration ${stamp}`,
      slug: `storage-lifecycle-integration-${stamp}`,
      type: "client",
      status: "active",
    })
    .returning();
  assert.ok(organisation);
  organisationId = organisation.id;
  await withTenantDatabase(organisationId, async () => {
    const [client] = await db
      .insert(clients)
      .values({
        organisationId,
        name: "Storage lifecycle integration client",
        ndaStatus: "signed",
      })
      .returning();
    assert.ok(client);
    clientId = client.id;
    const [project] = await db
      .insert(projects)
      .values({
        organisationId,
        clientId,
        tenderTitle: "Storage lifecycle integration pursuit",
        status: "extraction",
        conflictStatus: "clear",
      })
      .returning();
    assert.ok(project);
    projectId = project.id;
  });
});

after(async () => {
  await withTenantDatabase(organisationId, async () => {
    await db.execute(
      sql`SELECT set_config('valo.audit_test_cleanup', 'approved', true)`,
    );
    await db
      .delete(auditEvents)
      .where(eq(auditEvents.organisationId, organisationId));
    await db
      .delete(notificationEvents)
      .where(eq(notificationEvents.organisationId, organisationId));
    await db.delete(projects).where(eq(projects.id, projectId));
    await db.delete(clients).where(eq(clients.id, clientId));
  });
  await db.delete(organisations).where(eq(organisations.id, organisationId));
});

test("a reference committed while reconciliation waits on the path lock cancels deletion", async () => {
  const documentId = randomUUID();
  const path = objectPath("reference-race");
  const event = await enqueue(
    path,
    documentId,
    new Date("2026-08-13T10:00:00Z"),
  );
  let referenceInserted!: () => void;
  const inserted = new Promise<void>((resolve) => {
    referenceInserted = resolve;
  });
  let releaseReference!: () => void;
  const release = new Promise<void>((resolve) => {
    releaseReference = resolve;
  });
  const writer = withTenantDatabase(organisationId, async () => {
    await lockStagedUploadObject(path);
    await db.insert(documents).values({
      id: documentId,
      organisationId,
      projectId,
      type: "other",
      filename: "reference-race.pdf",
      objectPath: path,
      contentType: "application/pdf",
      size: 1,
      sha256: "a".repeat(64),
      redactionStatus: "excluded",
      extractionStatus: "skipped",
    });
    referenceInserted();
    await release;
  });
  await inserted;
  let providerCalls = 0;
  const reconciliation = withTenantDatabase(organisationId, () =>
    reconcileStorageDeletionIntent({
      organisationId,
      eventId: event.id,
      expectedVersion: event.version,
      actor: null,
      objectStore: {
        async deleteObjectEntity() {
          providerCalls += 1;
          return true;
        },
      },
      now: new Date("2026-08-13T10:01:00Z"),
    }),
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  releaseReference();
  await writer;
  const result = await reconciliation;
  assert.equal(result.outcome, "cancelled");
  assert.deepEqual(result.references, ["document"]);
  assert.equal(providerCalls, 0);
});

test("transient failure is not eligible before backoff and then reconciles", async () => {
  const aggregateId = randomUUID();
  const clock = await withTenantDatabase(organisationId, () =>
    db.execute(sql`SELECT pg_catalog.clock_timestamp() AS now`),
  );
  const requestedAt = new Date((clock.rows[0] as { now: string | Date }).now);
  const event = await enqueue(objectPath("retry"), aggregateId, requestedAt);
  const failed = await withTenantDatabase(organisationId, () =>
    reconcileStorageDeletionIntent({
      organisationId,
      eventId: event.id,
      expectedVersion: event.version,
      actor: null,
      objectStore: {
        async deleteObjectEntity() {
          throw new Error("transient provider failure");
        },
      },
      now: requestedAt,
    }),
  );
  assert.equal(failed.outcome, "retry_wait");
  const hidden = await withTenantDatabase(organisationId, () =>
    listPendingStorageDeletionIntents(organisationId),
  );
  assert.equal(
    hidden.items.some((item) => item.id === event.id),
    false,
  );
  let prematureProviderCalls = 0;
  await assert.rejects(
    withTenantDatabase(organisationId, () =>
      reconcileStorageDeletionIntent({
        organisationId,
        eventId: event.id,
        expectedVersion: failed.version,
        actor: null,
        objectStore: {
          async deleteObjectEntity() {
            prematureProviderCalls += 1;
            return true;
          },
        },
        now: new Date(requestedAt.valueOf() + 1_000),
      }),
    ),
    /invalid_state/u,
  );
  assert.equal(prematureProviderCalls, 0);

  await withTenantDatabase(organisationId, () =>
    db
      .update(notificationEvents)
      .set({ availableAt: new Date("2000-01-01T00:00:00Z") })
      .where(eq(notificationEvents.id, event.id)),
  );
  const eligible = await withTenantDatabase(organisationId, () =>
    listPendingStorageDeletionIntents(organisationId),
  );
  assert.equal(
    eligible.items.some((item) => item.id === event.id),
    true,
  );
  const completed = await withTenantDatabase(organisationId, () =>
    reconcileStorageDeletionIntent({
      organisationId,
      eventId: event.id,
      expectedVersion: failed.version,
      actor: null,
      objectStore: {
        async deleteObjectEntity() {
          return false;
        },
      },
      now: new Date(requestedAt.valueOf() + 6 * 60_000),
    }),
  );
  assert.equal(completed.outcome, "completed");
  assert.equal(completed.objectDeleted, false);
});

test("attempt exhaustion creates an audited dead letter after bounded backoff", async () => {
  const aggregateId = randomUUID();
  const event = await enqueue(
    objectPath("dead-letter"),
    aggregateId,
    new Date("2026-08-13T12:00:00Z"),
  );
  let version = event.version;
  let outcome = "";
  const attemptTimes = [
    new Date("2026-08-13T12:00:00Z"),
    new Date("2026-08-13T12:05:01Z"),
    new Date("2026-08-13T12:15:02Z"),
    new Date("2026-08-13T12:35:03Z"),
    new Date("2026-08-13T13:15:04Z"),
  ];
  const expectedRetrySeconds = [300, 600, 1_200, 2_400, null];
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    if (attempt > 1) {
      await withTenantDatabase(organisationId, () =>
        db
          .update(notificationEvents)
          .set({ availableAt: new Date("2000-01-01T00:00:00Z") })
          .where(eq(notificationEvents.id, event.id)),
      );
    }
    const result = await withTenantDatabase(organisationId, () =>
      reconcileStorageDeletionIntent({
        organisationId,
        eventId: event.id,
        expectedVersion: version,
        actor: null,
        objectStore: {
          async deleteObjectEntity() {
            throw new Error("persistent provider failure");
          },
        },
        now: attemptTimes[attempt - 1]!,
      }),
    );
    outcome = result.outcome;
    version = result.version;
    assert.equal(result.outcome, attempt === 5 ? "dead_letter" : "retry_wait");
    await withTenantDatabase(organisationId, async () => {
      const rows = await db
        .select({
          attemptedAt: notificationAttempts.attemptedAt,
          nextAttemptAt: notificationAttempts.nextAttemptAt,
        })
        .from(notificationAttempts)
        .where(
          and(
            eq(notificationAttempts.organisationId, organisationId),
            eq(notificationAttempts.notificationEventId, event.id),
            eq(notificationAttempts.attemptNumber, attempt),
          ),
        )
        .limit(2);
      assert.equal(rows.length, 1);
      const expectedSeconds = expectedRetrySeconds[attempt - 1];
      assert.equal(
        rows[0]!.nextAttemptAt === null
          ? null
          : Math.round(
              (rows[0]!.nextAttemptAt!.valueOf() -
                rows[0]!.attemptedAt.valueOf()) /
                1_000,
            ),
        expectedSeconds === null ? null : expectedSeconds,
      );
      assert.notEqual(
        rows[0]!.attemptedAt.toISOString(),
        attemptTimes[attempt - 1]!.toISOString(),
        "persisted attempt time must ignore the caller clock",
      );
    });
  }
  assert.equal(outcome, "dead_letter");
  await withTenantDatabase(organisationId, async () => {
    const attempts = await db
      .select({
        attemptNumber: notificationAttempts.attemptNumber,
        status: notificationAttempts.status,
      })
      .from(notificationAttempts)
      .where(
        and(
          eq(notificationAttempts.organisationId, organisationId),
          eq(notificationAttempts.notificationEventId, event.id),
        ),
      )
      .orderBy(asc(notificationAttempts.attemptNumber));
    assert.equal(attempts.length, 5);
    assert.equal(attempts.at(-1)?.status, "dead_letter");
    const receipts = await db
      .select({ eventType: auditEvents.eventType })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organisationId, organisationId),
          eq(auditEvents.objectId, aggregateId),
          eq(auditEvents.eventType, "storage.deletion_dead_lettered"),
        ),
      )
      .limit(2);
    assert.equal(receipts.length, 1);
  });
});

test("concurrent exact enqueue requests converge without duplicate queue rows", async () => {
  const aggregateId = randomUUID();
  const path = objectPath("enqueue-race");
  const requestedAt = new Date("2026-08-13T13:00:00Z");
  const [first, second] = await Promise.all([
    enqueue(path, aggregateId, requestedAt),
    enqueue(path, aggregateId, requestedAt),
  ]);
  assert.equal(first.id, second.id);
  assert.equal(Number(first.replayed) + Number(second.replayed), 1);
  await withTenantDatabase(organisationId, async () => {
    const rows = await db
      .select({ id: notificationEvents.id })
      .from(notificationEvents)
      .where(eq(notificationEvents.id, first.id))
      .limit(2);
    assert.equal(rows.length, 1);
  });
});

test("terminal purge retains every accepted-unresolved provider locator", async () => {
  const requestedAt = new Date("2000-01-01T00:00:00Z");
  const unresolved = await enqueue(
    objectPath("accepted-unresolved"),
    randomUUID(),
    requestedAt,
  );
  const confirmed = await enqueue(
    objectPath("confirmed-deleted"),
    randomUUID(),
    requestedAt,
  );
  await withTenantDatabase(organisationId, async () => {
    await db
      .update(notificationEvents)
      .set({
        status: "resolved",
        storageTerminalAt: requestedAt,
        updatedAt: requestedAt,
      })
      .where(eq(notificationEvents.id, unresolved.id));
    await db
      .update(notificationEvents)
      .set({
        status: "completed",
        storageTerminalAt: requestedAt,
        updatedAt: requestedAt,
      })
      .where(eq(notificationEvents.id, confirmed.id));
    const purge = await purgeRetainedStorageDeletionTerminals(
      organisationId,
      5,
    );
    assert.equal(purge.purged, 1);
    const remaining = await db
      .select({ id: notificationEvents.id })
      .from(notificationEvents)
      .where(
        and(
          eq(notificationEvents.organisationId, organisationId),
          eq(notificationEvents.id, unresolved.id),
        ),
      );
    assert.deepEqual(remaining, [{ id: unresolved.id }]);
  });
});
