// MUST be first: route modules transitively import the OpenAI client, which
// throws at load time without its env vars (absent in CI).
import "../test-env";
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { eq, sql } from "drizzle-orm";
import {
  db,
  users,
  organisations,
  clients,
  projects,
  conflictRecords,
  auditEvents,
} from "@workspace/db";
import projectsRouter from "./projects";
import type { LocalUser } from "../middlewares/auth";
import { type AccessContext } from "../middlewares/tenancy";
import { attachTenantDatabase } from "../middlewares/databaseTenancy";
import { normalizeLegacyRole, permissionsForRoles } from "../lib/permissions";

/**
 * End-to-end proof of the two governance invariants hardened in the sweep:
 *
 *  1. Direct payment confirmation remains disabled until founder/adviser
 *     authority is bound to server-side grants; legacy role-shaped requests
 *     cannot stamp either identity leg.
 *
 *  2. Generic PATCH cannot decide conflicts. Ordinary versioned edits preserve
 *     a block, while changing tenderRef onto a different active tender opens a
 *     fresh blocked conflict record.
 */

let server: Server;
let baseUrl: string;
let currentUser: LocalUser | null = null;

let founderId: string;
let advisorId: string;
let organisationId: string;
let clientId: string;

const projectIds: string[] = [];

interface ProjectBody {
  id: string;
  version: number;
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

  const [organisation] = await db
    .insert(organisations)
    .values({
      name: `__GOV_IT_ORG__ ${stamp}`,
      slug: `gov-it-${Date.now()}`,
      type: "valo",
    })
    .returning();
  organisationId = organisation.id;

  const [client] = await db
    .insert(clients)
    .values({ name: `__GOV_IT__ ${stamp}`, organisationId })
    .returning();
  clientId = client.id;

  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as { localUser: LocalUser | null }).localUser = currentUser;
    const role = currentUser ? normalizeLegacyRole(currentUser.role) : null;
    if (role) {
      (req as Request & { accessContext?: AccessContext }).accessContext = {
        organisationId,
        membershipId: currentUser!.id,
        membershipOrganisationId: organisationId,
        source: "membership",
        roles: [role],
        permissions: permissionsForRoles([role]),
        breakGlassSessionId: null,
        partnerRelationshipId: null,
        partnerCoSigningRequired: false,
      };
    }
    (req as unknown as { log: unknown }).log = {
      error() {},
      warn() {},
      info() {},
      debug() {},
    };
    next();
  });
  app.use(attachTenantDatabase);
  app.use(projectsRouter);

  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('valo.audit_test_cleanup', 'approved', true)`,
    );
    for (const id of projectIds) {
      await tx.delete(auditEvents).where(eq(auditEvents.projectId, id));
    }
  });
  await db.delete(clients).where(eq(clients.id, clientId)); // cascades projects + conflict records
  await db.delete(users).where(eq(users.id, founderId));
  await db.delete(users).where(eq(users.id, advisorId));
  await db.delete(organisations).where(eq(organisations.id, organisationId));
});

async function createProject(
  body: Record<string, unknown>,
): Promise<ProjectBody> {
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

async function patchProject(
  id: string,
  body: Record<string, unknown>,
  expectedVersion?: number,
): Promise<globalThis.Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (expectedVersion !== undefined) {
    headers["If-Match"] = `"${expectedVersion}"`;
  }
  return fetch(`${baseUrl}/projects/${id}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
  });
}

async function confirmPayment(
  id: string,
  role: "founder" | "advisor",
): Promise<globalThis.Response> {
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

async function waitForProjectVisibility(projectId: string): Promise<void> {
  const deadline = Date.now() + 2_000;

  while (Date.now() < deadline) {
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, projectId));
    if (project) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  assert.fail(`Expected project ${projectId} to be committed within 2 seconds`);
}

async function waitForConflictRecordCount(
  projectId: string,
  expectedCount: number,
): Promise<void> {
  const deadline = Date.now() + 2_000;

  while (Date.now() < deadline) {
    if ((await conflictRecordCount(projectId)) === expectedCount) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  assert.fail(
    `Expected ${expectedCount} conflict record(s) for ${projectId} to be committed within 2 seconds`,
  );
}

describe("payment confirmation is fail-closed until authority is bound", () => {
  let projectId: string;

  test("an operations administrator cannot stamp the founder leg", async () => {
    currentUser = {
      id: founderId,
      role: "admin",
      name: "Founder One",
    } as LocalUser;
    const project = await createProject({
      tenderTitle: "Payment identity proof",
    });
    projectId = project.id;
    await waitForProjectVisibility(projectId);

    const res = await confirmPayment(projectId, "founder");
    assert.equal(res.status, 503);
    const body = await json(res);
    assert.match(body.error, /disabled.*authority|authority.*bound/i);
  });

  test("a reviewer cannot use the legacy adviser-shaped payload", async () => {
    currentUser = {
      id: advisorId,
      role: "reviewer",
      name: "Advisor Two",
    } as LocalUser;
    const res = await confirmPayment(projectId, "advisor");
    assert.equal(res.status, 403);
  });

  test("denied attempts leave both identity legs and the audit stream untouched", async () => {
    const [row] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId));
    assert.equal(row.paymentConfirmedByFounder, false);
    assert.equal(row.paymentConfirmedByAdvisor, false);
    assert.equal(row.paymentFounderConfirmedBy, null);
    assert.equal(row.paymentAdvisorConfirmedBy, null);
    assert.equal(row.paymentConfirmedAt, null);
    const events = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.projectId, projectId));
    assert.equal(
      events.some((event) => event.eventType === "project.payment_confirmed"),
      false,
    );
  });
});

describe("conflict decisions require a dedicated authorised workflow", () => {
  let blockedId: string;
  let blockedVersion: number;

  test("a same-tender/lot project is created blocked with a conflict record", async () => {
    currentUser = {
      id: founderId,
      role: "admin",
      name: "Founder One",
    } as LocalUser;
    const original = await createProject({
      tenderTitle: "Original holder",
      tenderRef: "TX-100",
      lot: "L1",
    });
    await waitForProjectVisibility(original.id);
    const blocked = await createProject({
      tenderTitle: "Challenger",
      tenderRef: "TX-100",
      lot: "L1",
    });
    blockedId = blocked.id;
    blockedVersion = blocked.version;
    assert.equal(blocked.conflictStatus, "blocked");
    await waitForConflictRecordCount(blockedId, 1);
  });

  test("generic PATCH cannot stamp a consent decision", async () => {
    const res = await patchProject(blockedId, {
      conflictStatus: "consented",
      conflictDecision: "Client consented in writing",
    });
    assert.equal(res.status, 409);
    assert.match((await json(res)).error, /dedicated authorised workflows/i);

    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, blockedId));
    assert.equal(project.conflictStatus, "blocked");
    const [record] = await db
      .select()
      .from(conflictRecords)
      .where(eq(conflictRecords.projectId, blockedId));
    assert.equal(record.status, "blocked");
    assert.equal(record.decidedBy, null);
    assert.equal(record.decidedAt, null);
  });

  test("an unrelated versioned PATCH preserves the block and adds no duplicate", async () => {
    const res = await patchProject(
      blockedId,
      { deadline: "2026-12-31" },
      blockedVersion,
    );
    assert.equal(res.status, 200);
    const body = await json(res);
    blockedVersion = body.version;
    assert.equal(body.conflictStatus, "blocked");
    await waitForConflictRecordCount(blockedId, 1);
  });

  test("moving the project onto a different conflict creates a fresh blocked record", async () => {
    // A third project holds tender TZ-200. Changing the tender identity must
    // open a fresh record; the existing TX-100 block does not cover it.
    const otherHolder = await createProject({
      tenderTitle: "Other tender holder",
      tenderRef: "TZ-200",
      lot: "L1",
    });
    await waitForProjectVisibility(otherHolder.id);

    const res = await patchProject(
      blockedId,
      { tenderRef: "TZ-200" },
      blockedVersion,
    );
    assert.equal(res.status, 200);
    const body = await json(res);
    assert.equal(body.conflictStatus, "blocked");
    await waitForConflictRecordCount(blockedId, 2);
  });
});
