import "../test-env";
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import {
  db,
  organisations,
  clients,
  projects,
  retentionRequests,
  auditEvents,
  withTenantDatabase,
} from "@workspace/db";
import { runRetentionScan } from "./retentionScan";

/**
 * End-to-end proof of the retention automation scheduler: the runner opens a
 * retention request for a concluded engagement whose window has elapsed, leaves
 * live and too-recent engagements alone, is idempotent across runs, and audits
 * every request it opens with the distinct `retention.auto_requested` event.
 * The scheduler only OPENS requests — it never purges.
 */

let clientId: string;
let organisationId: string;
let concludedOldId: string;
let concludedRecentId: string;
let liveOldId: string;

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);
const MAX_VALID_RETENTION_DAYS = 36_500;

async function deleteRetentionRequestFixture(projectId: string): Promise<void> {
  // Protocol-zero and protocol-one retention evidence is deliberately
  // immutable. This test-only owner DDL runs inside withTenantDatabase's
  // transaction, disables only the completion guard (not FK/cascade
  // triggers), and is rolled back automatically if cleanup cannot finish.
  await db.execute(
    sql`ALTER TABLE public.retention_requests DISABLE TRIGGER retention_request_completion_guard`,
  );
  await db
    .delete(retentionRequests)
    .where(eq(retentionRequests.subjectProjectId, projectId));
  await db.execute(
    sql`ALTER TABLE public.retention_requests ENABLE TRIGGER retention_request_completion_guard`,
  );
}

before(async () => {
  const stamp = new Date().toISOString();

  const [organisation] = await db
    .insert(organisations)
    .values({
      name: `Retention scan integration ${stamp}`,
      slug: `retention-scan-${randomUUID()}`,
      type: "valo",
    })
    .returning();
  organisationId = organisation.id;
  // Lifecycle obligations survive tenant suspension/offboarding. Discovery
  // must not silently filter this tenant out.
  await db
    .update(organisations)
    .set({ status: "suspended" })
    .where(eq(organisations.id, organisationId));

  await withTenantDatabase(organisationId, async () => {
    const [client] = await db
      .insert(clients)
      .values({
        organisationId,
        name: `__RETENTION_SCAN_IT__ ${stamp}`,
      })
      .returning();
    clientId = client.id;

    const [concludedOld] = await db
      .insert(projects)
      .values({
        organisationId,
        clientId,
        tenderTitle: "Concluded past window",
        status: "signed_off",
        // Remains due for every valid configured retention window, so this
        // integration proof does not mutate the process-global config row.
        concludedAt: daysAgo(MAX_VALID_RETENTION_DAYS + 1),
        createdAt: daysAgo(MAX_VALID_RETENTION_DAYS + 1),
      })
      .returning();
    concludedOldId = concludedOld.id;

    const [concludedRecent] = await db
      .insert(projects)
      .values({
        organisationId,
        clientId,
        tenderTitle: "Concluded but recent",
        status: "exported",
        // Remains inside even the minimum valid one-day retention window.
        concludedAt: new Date(),
        createdAt: new Date(),
      })
      .returning();
    concludedRecentId = concludedRecent.id;

    const [liveOld] = await db
      .insert(projects)
      .values({
        organisationId,
        clientId,
        tenderTitle: "Still in review, old",
        status: "review",
        createdAt: daysAgo(100),
      })
      .returning();
    liveOldId = liveOld.id;
  });
});

after(async () => {
  await withTenantDatabase(organisationId, async () => {
    await db.execute(
      sql`SELECT set_config('valo.audit_test_cleanup', 'approved', true)`,
    );
    await deleteRetentionRequestFixture(concludedOldId);
    await db
      .delete(auditEvents)
      .where(eq(auditEvents.organisationId, organisationId));
    await db.delete(projects).where(eq(projects.clientId, clientId));
    await db.delete(clients).where(eq(clients.id, clientId));
  });
  await db.delete(organisations).where(eq(organisations.id, organisationId));
});

async function pendingFor(projectId: string): Promise<number> {
  return withTenantDatabase(organisationId, async () => {
    const rows = await db
      .select()
      .from(retentionRequests)
      .where(eq(retentionRequests.projectId, projectId));
    return rows.length;
  });
}

describe("retention automation scheduler", () => {
  test("fairly scans an inactive tenant and opens only the anchored due engagement", async () => {
    const result = await runRetentionScan({ organisationId, now: new Date() });

    // `scanned` is the bounded page of due candidates, not every concluded
    // engagement inspected by SQL; only the old fixture crosses the window.
    assert.equal(result.scanned, 1);
    assert.ok(result.opened.some((c) => c.projectId === concludedOldId));
    assert.ok(!result.opened.some((c) => c.projectId === concludedRecentId));
    assert.ok(!result.opened.some((c) => c.projectId === liveOldId));

    assert.equal(await pendingFor(concludedOldId), 1, "concluded+old opened");
    assert.equal(await pendingFor(concludedRecentId), 0, "recent not opened");
    assert.equal(await pendingFor(liveOldId), 0, "live not opened");

    // The opening is audited with the distinct scheduler event type.
    const audits = await withTenantDatabase(organisationId, () =>
      db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.projectId, concludedOldId)),
    );
    assert.ok(audits.some((a) => a.eventType === "retention.auto_requested"));
  });

  test("is idempotent — a second run opens no duplicate request", async () => {
    // The existing pending request is filtered out before it becomes a
    // candidate, so nothing new is opened and the count stays at one.
    const result = await runRetentionScan({ organisationId, now: new Date() });
    assert.ok(!result.opened.some((c) => c.projectId === concludedOldId));
    assert.equal(
      await pendingFor(concludedOldId),
      1,
      "still exactly one request",
    );
  });
});
