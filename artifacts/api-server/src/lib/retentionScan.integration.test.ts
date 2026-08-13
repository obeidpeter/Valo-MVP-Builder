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
  appConfig,
  withTenantDatabase,
} from "@workspace/db";
import { runRetentionScan } from "./retentionScan";
import { getActiveConfigRow, APP_CONFIG_ID } from "./appConfig";

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
let originalRetentionDays: number;

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

before(async () => {
  const stamp = new Date().toISOString();

  // Pin the retention window to 14 days for a deterministic boundary.
  await getActiveConfigRow();
  const [cfg] = await db
    .select()
    .from(appConfig)
    .where(eq(appConfig.id, APP_CONFIG_ID));
  originalRetentionDays = cfg.retentionDefaultDays;
  await db
    .update(appConfig)
    .set({ retentionDefaultDays: 14 })
    .where(eq(appConfig.id, APP_CONFIG_ID));

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
        concludedAt: daysAgo(30),
        createdAt: daysAgo(30),
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
        concludedAt: daysAgo(5),
        createdAt: daysAgo(5),
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
    await db
      .delete(retentionRequests)
      .where(eq(retentionRequests.projectId, concludedOldId));
    await db
      .delete(auditEvents)
      .where(eq(auditEvents.organisationId, organisationId));
    await db.delete(projects).where(eq(projects.clientId, clientId));
    await db.delete(clients).where(eq(clients.id, clientId));
  });
  await db.delete(organisations).where(eq(organisations.id, organisationId));
  await db
    .update(appConfig)
    .set({ retentionDefaultDays: originalRetentionDays })
    .where(eq(appConfig.id, APP_CONFIG_ID));
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

    // Both concluded engagements are in scope; only the old one is opened.
    assert.ok(result.scanned >= 2);
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
