import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express, { type Request, type Response, type NextFunction } from "express";
import { eq } from "drizzle-orm";
import { db, appConfig, users, auditEvents } from "@workspace/db";
import configRouter from "./config";
import type { LocalUser } from "../middlewares/auth";
import { APP_CONFIG_ID } from "../lib/appConfig";

/**
 * Proves the global-config endpoints: admin-only access, a read that
 * materialises the singleton with defaults, validated partial updates that
 * reject non-monotonic band cutoffs, and an audit trail for every write.
 */

let server: Server;
let baseUrl: string;
let currentUser: LocalUser | null = null;
let adminId: string;

before(async () => {
  const stamp = new Date().toISOString();
  const [admin] = await db
    .insert(users)
    .values({
      clerkUserId: `__config_it_admin__${stamp}`,
      email: `admin-${stamp}@config-it.local`,
      name: "Config Admin",
      role: "admin",
      status: "active",
    })
    .returning();
  adminId = admin.id;

  // Start from a clean singleton so default-materialisation is observable.
  await db.delete(appConfig).where(eq(appConfig.id, APP_CONFIG_ID));

  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as { localUser: LocalUser | null }).localUser = currentUser;
    next();
  });
  app.use(configRouter);

  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  await db.delete(auditEvents).where(eq(auditEvents.userId, adminId));
  await db.delete(appConfig).where(eq(appConfig.id, APP_CONFIG_ID));
  await db.delete(users).where(eq(users.id, adminId));
});

interface ConfigBody {
  severityWeights: { fatal: number; likely_fatal: number; scoring_risk: number; cosmetic: number };
  missingEvidenceWeight: number;
  bandCutoffs: { medium: number; high: number; critical: number };
  firmName: string;
  confidentialityLegend: string;
  retentionDefaultDays: number;
  updatedAt: string;
  updatedBy: string | null;
  error?: string;
}

describe("global configuration endpoints", () => {
  test("GET /config is admin-only", async () => {
    currentUser = { id: adminId, role: "analyst", name: "Nope" } as LocalUser;
    const res = await fetch(`${baseUrl}/config`);
    assert.equal(res.status, 403);
    currentUser = { id: adminId, role: "admin", name: "Config Admin" } as LocalUser;
  });

  test("GET /config materialises the singleton with defaults", async () => {
    const res = await fetch(`${baseUrl}/config`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as ConfigBody;
    assert.equal(body.severityWeights.fatal, 40);
    assert.equal(body.missingEvidenceWeight, 5);
    assert.deepEqual(body.bandCutoffs, { medium: 15, high: 40, critical: 70 });
    assert.ok(body.firmName.length > 0);
    assert.ok(body.retentionDefaultDays > 0);
  });

  test("PATCH /config rejects non-admins", async () => {
    currentUser = { id: adminId, role: "reviewer", name: "Nope" } as LocalUser;
    const res = await fetch(`${baseUrl}/config`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ missingEvidenceWeight: 9 }),
    });
    assert.equal(res.status, 403);
    currentUser = { id: adminId, role: "admin", name: "Config Admin" } as LocalUser;
  });

  test("PATCH /config rejects non-monotonic band cutoffs", async () => {
    const res = await fetch(`${baseUrl}/config`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bandCutoffs: { medium: 50, high: 40, critical: 70 } }),
    });
    assert.equal(res.status, 400);
  });

  test("PATCH /config rejects non-integer numeric values with a clean 400", async () => {
    const res = await fetch(`${baseUrl}/config`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ missingEvidenceWeight: 5.5 }),
    });
    assert.equal(res.status, 400);
  });

  test("PATCH /config applies a valid partial update and audits it", async () => {
    const res = await fetch(`${baseUrl}/config`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        severityWeights: { fatal: 45, likely_fatal: 25, scoring_risk: 12, cosmetic: 4 },
        bandCutoffs: { medium: 20, high: 50, critical: 80 },
        firmName: "Valo Forensics LLP",
        retentionDefaultDays: 365,
      }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as ConfigBody;
    assert.equal(body.severityWeights.fatal, 45);
    assert.equal(body.severityWeights.scoring_risk, 12);
    assert.deepEqual(body.bandCutoffs, { medium: 20, high: 50, critical: 80 });
    assert.equal(body.firmName, "Valo Forensics LLP");
    assert.equal(body.retentionDefaultDays, 365);
    assert.equal(body.updatedBy, adminId);

    // Untouched fields keep their previous values (partial merge).
    assert.equal(body.missingEvidenceWeight, 5);

    // Persisted, and a config.updated audit event was written.
    const [row] = await db.select().from(appConfig).where(eq(appConfig.id, APP_CONFIG_ID));
    assert.equal(row.severityWeightFatal, 45);
    assert.equal(row.bandCriticalCutoff, 80);

    const events = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.userId, adminId));
    assert.ok(
      events.some((e) => e.eventType === "config.updated"),
      "expected a config.updated audit event",
    );
  });
});
