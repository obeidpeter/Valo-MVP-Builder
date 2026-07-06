// MUST be first: route modules transitively import the OpenAI client, which
// throws at load time without its env vars (absent in CI).
import "../test-env";
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express, { type Request, type Response, type NextFunction } from "express";
import { eq } from "drizzle-orm";
import {
  db,
  users,
  clients,
  projects,
  conflictRecords,
  auditEvents,
} from "@workspace/db";
import projectsRouter from "./projects";
import type { LocalUser } from "../middlewares/auth";

/**
 * End-to-end proof of the two governance invariants hardened in the sweep:
 *
 *  1. Dual payment confirmation requires two DISTINCT people — the same user
 *     cannot stamp both legs (409), and two different users satisfy the gate
 *     with identities and paymentConfirmedAt recorded.
 *
 *  2. Conflict consent is scoped to the tender identity it was granted for —
 *     an unrelated PATCH keeps the consent (no re-block, no duplicate
 *     conflict record), while changing tenderRef onto a DIFFERENT active
 *     tender re-blocks and opens a fresh conflict record.
 */

let server: Server;
let baseUrl: string;
let currentUser: LocalUser | null = null;

let founderId: string;
let advisorId: string;
let clientId: string;

const projectIds: string[] = [];

interface ProjectBody {
  id: string;
  status: string;
  conflictStatus: string;
  paymentConfirmedByFounder: boolean;
  paymentConfirmedByAdvisor: boolean;
  paymentFounderConfirmedByName: string | null;
  paymentAdvisorConfirmedByName: string | null;
  paymentConfirmedAt: string | null;
  error: string;
}

async function json(res: globalThis.Response): Promise<ProjectBody> {
  return (await res.json()) as ProjectBody;
}

before(async () => {
  const stamp = new Date().toISOString();

  const [founder] = await db
    .insert(users)
    .values({
      clerkUserId: `__gov_it_founder__${stamp}`,
      email: `founder-${stamp}@gov-it.local`,
      name: "Founder One",
      role: "admin",
      status: "active",
    })
    .returning();
  founderId = founder.id;
  const [advisor] = await db
    .insert(users)
    .values({
      clerkUserId: `__gov_it_advisor__${stamp}`,
      email: `advisor-${stamp}@gov-it.local`,
      name: "Advisor Two",
      role: "reviewer",
      status: "active",
    })
    .returning();
  advisorId = advisor.id;

  const [client] = await db
    .insert(clients)
    .values({ name: `__GOV_IT__ ${stamp}` })
    .returning();
  clientId = client.id;

  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as { localUser: LocalUser | null }).localUser = currentUser;
    (req as unknown as { log: unknown }).log = {
      error() {},
      warn() {},
      info() {},
      debug() {},
    };
    next();
  });
  app.use(projectsRouter);

  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  for (const id of projectIds) {
    await db.delete(auditEvents).where(eq(auditEvents.projectId, id));
  }
  await db.delete(clients).where(eq(clients.id, clientId)); // cascades projects + conflict records
  await db.delete(users).where(eq(users.id, founderId));
  await db.delete(users).where(eq(users.id, advisorId));
});

async function createProject(body: Record<string, unknown>): Promise<ProjectBody> {
  const res = await fetch(`${baseUrl}/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId, reviewerId: founderId, ...body }),
  });
  assert.equal(res.status, 201);
  const created = await json(res);
  projectIds.push(created.id);
  return created;
}

async function patchProject(id: string, body: Record<string, unknown>): Promise<globalThis.Response> {
  return fetch(`${baseUrl}/projects/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function confirmPayment(id: string, role: "founder" | "advisor"): Promise<globalThis.Response> {
  return fetch(`${baseUrl}/projects/${id}/payment-confirmations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
  });
}

async function conflictRecordCount(projectId: string): Promise<number> {
  const rows = await db
    .select()
    .from(conflictRecords)
    .where(eq(conflictRecords.projectId, projectId));
  return rows.length;
}

describe("dual payment confirmation identities", () => {
  let projectId: string;

  test("first leg records the confirming identity", async () => {
    currentUser = { id: founderId, role: "admin", name: "Founder One" } as LocalUser;
    const project = await createProject({ tenderTitle: "Payment identity proof" });
    projectId = project.id;

    const res = await confirmPayment(projectId, "founder");
    assert.equal(res.status, 200);
    const body = await json(res);
    assert.equal(body.paymentConfirmedByFounder, true);
    assert.equal(body.paymentFounderConfirmedByName, "Founder One");
  });

  test("the same person cannot confirm the second leg", async () => {
    currentUser = { id: founderId, role: "admin", name: "Founder One" } as LocalUser;
    const res = await confirmPayment(projectId, "advisor");
    assert.equal(res.status, 409);
    const body = await json(res);
    assert.match(body.error, /distinct/i);
  });

  test("a different person completes the dual confirmation", async () => {
    currentUser = { id: advisorId, role: "reviewer", name: "Advisor Two" } as LocalUser;
    const res = await confirmPayment(projectId, "advisor");
    assert.equal(res.status, 200);
    const body = await json(res);
    assert.equal(body.paymentConfirmedByAdvisor, true);
    assert.equal(body.paymentAdvisorConfirmedByName, "Advisor Two");

    const [row] = await db.select().from(projects).where(eq(projects.id, projectId));
    assert.ok(row.paymentConfirmedAt, "dual-completion timestamp stamped");
    assert.notEqual(row.paymentFounderConfirmedBy, row.paymentAdvisorConfirmedBy);
  });
});

describe("conflict consent is scoped to the tender it was granted for", () => {
  let blockedId: string;

  test("a same-tender/lot project is created blocked with a conflict record", async () => {
    currentUser = { id: founderId, role: "admin", name: "Founder One" } as LocalUser;
    await createProject({ tenderTitle: "Original holder", tenderRef: "TX-100", lot: "L1" });
    const blocked = await createProject({ tenderTitle: "Challenger", tenderRef: "TX-100", lot: "L1" });
    blockedId = blocked.id;
    assert.equal(blocked.conflictStatus, "blocked");
    assert.equal(await conflictRecordCount(blockedId), 1);
  });

  test("consent decision stamps the open conflict record", async () => {
    const res = await patchProject(blockedId, {
      conflictStatus: "consented",
      conflictDecision: "Client consented in writing",
    });
    assert.equal(res.status, 200);
    assert.equal((await json(res)).conflictStatus, "consented");

    const [record] = await db
      .select()
      .from(conflictRecords)
      .where(eq(conflictRecords.projectId, blockedId));
    assert.equal(record.status, "consented");
    assert.equal(record.decidedBy, founderId);
    assert.ok(record.decidedAt);
  });

  test("an unrelated PATCH keeps the consent and adds no duplicate record", async () => {
    const res = await patchProject(blockedId, { deadline: "2026-12-31" });
    assert.equal(res.status, 200);
    assert.equal((await json(res)).conflictStatus, "consented");
    assert.equal(await conflictRecordCount(blockedId), 1);
  });

  test("moving the project onto a DIFFERENT conflicting tender re-blocks it", async () => {
    // A third project holds tender TZ-200 — the old consent cannot cover it.
    await createProject({ tenderTitle: "Other tender holder", tenderRef: "TZ-200", lot: "L1" });

    const res = await patchProject(blockedId, { tenderRef: "TZ-200" });
    assert.equal(res.status, 200);
    const body = await json(res);
    assert.equal(body.conflictStatus, "blocked");
    assert.equal(await conflictRecordCount(blockedId), 2);
  });
});
