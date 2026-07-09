// MUST be first: the requirements router transitively imports the LLM client,
// which throws at load time without its env vars (absent in CI).
import "../test-env";
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express, { type Request, type Response, type NextFunction } from "express";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  users,
  clients,
  projects,
  documents,
  requirements,
  evidenceItems,
  defects,
  auditEvents,
} from "@workspace/db";
import requirementsRouter from "./requirements";
import type { LocalUser } from "../middlewares/auth";

/**
 * Proves requirement merge in the review queue: the survivor keeps its own
 * citation and absorbs the merged-away rows' citations, linked evidence and
 * defects re-point to the survivor (nothing cascade-deleted), the redundant
 * rows are removed, the action is audited, and malformed requests are rejected.
 */

let server: Server;
let baseUrl: string;
let currentUser: LocalUser | null = null;

let adminId: string;
let clientId: string;
let projectId: string;
let docAId: string;
let docBId: string;

interface RequirementBody {
  id: string;
  mergedCitations: Array<{
    sourceDocId: string | null;
    sourceDocName: string | null;
    pageRef: string | null;
    clauseRef: string | null;
    text: string | null;
  }>;
  pageRef: string | null;
  error?: string;
}

before(async () => {
  const stamp = new Date().toISOString();
  const [admin] = await db
    .insert(users)
    .values({
      clerkUserId: `__merge_it_admin__${stamp}`,
      email: `admin-${stamp}@merge-it.local`,
      name: "Merge Admin",
      role: "admin",
      status: "active",
    })
    .returning();
  adminId = admin.id;

  const [client] = await db.insert(clients).values({ name: `__MERGE_IT__ ${stamp}` }).returning();
  clientId = client.id;
  const [project] = await db
    .insert(projects)
    .values({ clientId, tenderTitle: `Merge Project ${stamp}`, status: "extraction" })
    .returning();
  projectId = project.id;

  const [docA] = await db
    .insert(documents)
    .values({ projectId, filename: "tender-A.pdf", type: "tender", objectPath: `merge-it/${stamp}/a.pdf` })
    .returning();
  docAId = docA.id;
  const [docB] = await db
    .insert(documents)
    .values({ projectId, filename: "tender-B.pdf", type: "tender", objectPath: `merge-it/${stamp}/b.pdf` })
    .returning();
  docBId = docB.id;

  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as { localUser: LocalUser | null }).localUser = currentUser;
    next();
  });
  app.use(requirementsRouter);

  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  currentUser = { id: adminId, role: "admin", name: "Merge Admin" } as LocalUser;
});

after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  await db.delete(auditEvents).where(eq(auditEvents.projectId, projectId));
  await db.delete(projects).where(eq(projects.id, projectId));
  await db.delete(clients).where(eq(clients.id, clientId));
  await db.delete(users).where(eq(users.id, adminId));
});

async function seedThreeRequirements() {
  const [a, b, c] = await db
    .insert(requirements)
    .values([
      { projectId, sourceDocId: docAId, pageRef: "p.3", clauseRef: "4.1", text: "Tax clearance A", reviewStatus: "confirmed", origin: "engine" },
      { projectId, sourceDocId: docBId, pageRef: "p.9", clauseRef: "7.2", text: "Tax clearance B", reviewStatus: "suggested", origin: "engine" },
      { projectId, sourceDocId: docAId, pageRef: "p.12", clauseRef: "9.0", text: "Tax clearance C", reviewStatus: "suggested", origin: "engine" },
    ])
    .returning();
  return { a, b, c };
}

describe("requirement merge", () => {
  test("folds citations onto survivor and re-points evidence + defects", async () => {
    const { a, b, c } = await seedThreeRequirements();

    // Link an evidence item to a merged-away row and a defect to another.
    const [ev] = await db
      .insert(evidenceItems)
      .values({ projectId, requirementId: b.id, evidenceStatus: "confirmed", excerpt: "cert on file" })
      .returning();
    const [df] = await db
      .insert(defects)
      .values({ projectId, requirementId: c.id, type: "missing_document", severity: "fatal", description: "no cert" })
      .returning();

    const res = await fetch(`${baseUrl}/projects/${projectId}/requirements/merge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requirementIds: [a.id, b.id, c.id], survivorId: a.id }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as RequirementBody;
    assert.equal(body.id, a.id);
    // Survivor keeps its own native citation.
    assert.equal(body.pageRef, "p.3");
    // Both merged-away citations are preserved on the survivor.
    assert.equal(body.mergedCitations.length, 2);
    const refs = body.mergedCitations.map((c) => c.pageRef).sort();
    assert.deepEqual(refs, ["p.12", "p.9"]);
    assert.ok(body.mergedCitations.some((c) => c.sourceDocName === "tender-B.pdf"));

    // Merged-away rows are gone; survivor remains.
    const remaining = await db
      .select({ id: requirements.id })
      .from(requirements)
      .where(inArray(requirements.id, [a.id, b.id, c.id]));
    assert.deepEqual(remaining.map((r) => r.id), [a.id]);

    // Evidence and defect now point at the survivor (not cascade-deleted / nulled).
    const [evAfter] = await db.select().from(evidenceItems).where(eq(evidenceItems.id, ev.id));
    assert.equal(evAfter.requirementId, a.id);
    const [dfAfter] = await db.select().from(defects).where(eq(defects.id, df.id));
    assert.equal(dfAfter.requirementId, a.id);

    // Merge is audited.
    const audit = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.eventType, "requirement.merged"));
    assert.ok(audit.some((e) => e.objectId === a.id));

    await db.delete(requirements).where(eq(requirements.id, a.id));
  });

  test("preserves prior merged citations when a survivor is merged again", async () => {
    const { a, b, c } = await seedThreeRequirements();

    // First merge: b folds into a. a now carries b's citation (p.9).
    const first = await fetch(`${baseUrl}/projects/${projectId}/requirements/merge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requirementIds: [a.id, b.id], survivorId: a.id }),
    });
    assert.equal(first.status, 200);

    // Second merge: c folds into a. a must retain BOTH b's (p.9) and c's (p.12).
    const second = await fetch(`${baseUrl}/projects/${projectId}/requirements/merge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requirementIds: [a.id, c.id], survivorId: a.id }),
    });
    assert.equal(second.status, 200);
    const body = (await second.json()) as RequirementBody;
    const refs = body.mergedCitations.map((x) => x.pageRef).sort();
    assert.deepEqual(refs, ["p.12", "p.9"]);

    await db.delete(requirements).where(eq(requirements.projectId, projectId));
  });

  test("rejects fewer than two ids", async () => {
    const { a } = await seedThreeRequirements();
    const res = await fetch(`${baseUrl}/projects/${projectId}/requirements/merge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requirementIds: [a.id], survivorId: a.id }),
    });
    assert.equal(res.status, 400);
    await db.delete(requirements).where(eq(requirements.projectId, projectId));
  });

  test("rejects a survivor outside the selected set", async () => {
    const { a, b } = await seedThreeRequirements();
    const res = await fetch(`${baseUrl}/projects/${projectId}/requirements/merge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requirementIds: [a.id, b.id], survivorId: "00000000-0000-0000-0000-000000000000" }),
    });
    assert.equal(res.status, 400);
    await db.delete(requirements).where(eq(requirements.projectId, projectId));
  });

  test("refuses when a selected row belongs to another project", async () => {
    const { a, b } = await seedThreeRequirements();
    const [otherProject] = await db
      .insert(projects)
      .values({ clientId, tenderTitle: "Other", status: "extraction" })
      .returning();
    const [foreign] = await db
      .insert(requirements)
      .values({ projectId: otherProject.id, text: "Foreign req", reviewStatus: "suggested" })
      .returning();

    const res = await fetch(`${baseUrl}/projects/${projectId}/requirements/merge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requirementIds: [a.id, foreign.id], survivorId: a.id }),
    });
    assert.equal(res.status, 404);
    // Nothing was deleted.
    const survivors = await db
      .select({ id: requirements.id })
      .from(requirements)
      .where(inArray(requirements.id, [a.id, b.id, foreign.id]));
    assert.equal(survivors.length, 3);

    await db.delete(requirements).where(eq(requirements.projectId, projectId));
    await db.delete(requirements).where(eq(requirements.projectId, otherProject.id));
    await db.delete(projects).where(eq(projects.id, otherProject.id));
  });
});
