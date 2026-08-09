import "../test-env";
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import {
  db,
  clients,
  projects,
  retentionRequests,
  auditEvents,
  appConfig,
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

  const [client] = await db
    .insert(clients)
    .values({ name: `__RETENTION_SCAN_IT__ ${stamp}` })
    .returning();
  clientId = client.id;

  const [concludedOld] = await db
    .insert(projects)
    .values({
      clientId,
      tenderTitle: "Concluded past window",
      status: "signed_off",
      createdAt: daysAgo(30),
    })
    .returning();
  concludedOldId = concludedOld.id;

  const [concludedRecent] = await db
    .insert(projects)
    .values({
      clientId,
      tenderTitle: "Concluded but recent",
      status: "exported",
      createdAt: daysAgo(5),
    })
    .returning();
  concludedRecentId = concludedRecent.id;

  const [liveOld] = await db
    .insert(projects)
    .values({
      clientId,
      tenderTitle: "Still in review, old",
      status: "review",
      createdAt: daysAgo(100),
    })
    .returning();
  liveOldId = liveOld.id;
});

after(async () => {
  await db
    .delete(retentionRequests)
    .where(eq(retentionRequests.projectId, concludedOldId));
  await db.delete(auditEvents).where(eq(auditEvents.projectId, concludedOldId));
  await db.delete(projects).where(eq(projects.clientId, clientId));
  await db.delete(clients).where(eq(clients.id, clientId));
  await db
    .update(appConfig)
    .set({ retentionDefaultDays: originalRetentionDays })
    .where(eq(appConfig.id, APP_CONFIG_ID));
});

async function pendingFor(projectId: string): Promise<number> {
  const rows = await db
    .select()
    .from(retentionRequests)
    .where(eq(retentionRequests.projectId, projectId));
  return rows.length;
}

describe("retention automation scheduler", () => {
  test("opens a request only for the concluded engagement past its window", async () => {
    const result = await runRetentionScan();

    // Both concluded engagements are in scope; only the old one is opened.
    assert.ok(result.scanned >= 2);
    assert.ok(result.opened.some((c) => c.projectId === concludedOldId));
    assert.ok(!result.opened.some((c) => c.projectId === concludedRecentId));
    assert.ok(!result.opened.some((c) => c.projectId === liveOldId));

    assert.equal(await pendingFor(concludedOldId), 1, "concluded+old opened");
    assert.equal(await pendingFor(concludedRecentId), 0, "recent not opened");
    assert.equal(await pendingFor(liveOldId), 0, "live not opened");

    // The opening is audited with the distinct scheduler event type.
    const audits = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.projectId, concludedOldId));
    assert.ok(audits.some((a) => a.eventType === "retention.auto_requested"));
  });

  test("is idempotent — a second run opens no duplicate request", async () => {
    // The existing pending request is filtered out before it becomes a
    // candidate, so nothing new is opened and the count stays at one.
    const result = await runRetentionScan();
    assert.ok(!result.opened.some((c) => c.projectId === concludedOldId));
    assert.equal(
      await pendingFor(concludedOldId),
      1,
      "still exactly one request",
    );
  });
});
