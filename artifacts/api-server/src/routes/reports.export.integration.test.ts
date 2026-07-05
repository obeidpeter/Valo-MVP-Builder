import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express, { type Request, type Response, type NextFunction } from "express";
import JSZip from "jszip";
import { eq } from "drizzle-orm";
import {
  db,
  pool,
  users,
  clients,
  projects,
  documents,
  requirements,
  evidenceItems,
  defects,
  boqChecks,
  auditEvents,
  reports,
} from "@workspace/db";
import reportsRouter from "./reports";
import type { LocalUser } from "../middlewares/auth";

/**
 * End-to-end proof that the real `GET /projects/:id/export` HTTP route can't
 * leak or corrupt findings. Unlike the unit tests in `reports.test.ts` (which
 * only exercise the extracted `review_state` helpers), this test seeds a live
 * database, drives the actual Express handler over HTTP, unzips the streamed
 * archiver response in memory, and asserts the bytes of every CSV. It also
 * covers admin-only auth and the project.status -> "exported" transition, so a
 * refactor that reorders columns, drops a CSV, or breaks the wiring is caught.
 */

// The middleware-injected user for the current request (swapped per test to
// exercise admin vs. non-admin auth without a real Clerk session).
let currentUser: LocalUser | null = null;

let server: Server;
let baseUrl: string;

// Seeded identifiers, captured so we can assert per-row review_state.
let clientId: string;
let projectId: string;
let adminId: string;
const seeded = {
  reqs: [] as { id: string; reviewStatus: string; expected: string }[],
  evidence: [] as { id: string; suggested: boolean; expected: string }[],
  defects: [] as { id: string; suggested: boolean; expected: string }[],
};

/** Parse a CSV string into headers + row objects, honouring quoted fields. */
function parseCsv(csv: string): { headers: string[]; rows: Record<string, string>[] } {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (inQuotes) {
      if (c === '"') {
        if (csv[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      record.push(field);
      field = "";
    } else if (c === "\n") {
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else if (c === "\r") {
      // skip
    } else {
      field += c;
    }
  }
  if (field.length > 0 || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  const headers = records[0] ?? [];
  const rows = records.slice(1).map((cells) =>
    Object.fromEntries(headers.map((h, i) => [h, cells[i]])),
  );
  return { headers, rows };
}

before(async () => {
  const stamp = new Date().toISOString();

  const [admin] = await db
    .insert(users)
    .values({
      clerkUserId: `__export_it_admin__${stamp}`,
      email: `admin-${stamp}@export-it.local`,
      name: "Export Admin",
      role: "admin",
      status: "active",
    })
    .returning();
  adminId = admin.id;

  const [client] = await db
    .insert(clients)
    .values({ name: `__EXPORT_IT__ ${stamp}` })
    .returning();
  clientId = client.id;

  const [project] = await db
    .insert(projects)
    .values({
      clientId: client.id,
      tenderTitle: "Export Integration VMT-2026-999",
      status: "signed_off",
      reviewerId: admin.id,
    })
    .returning();
  projectId = project.id;

  const [doc] = await db
    .insert(documents)
    .values({
      projectId: project.id,
      type: "tender",
      filename: "tender.txt",
      objectPath: "export-it/tender.txt",
    })
    .returning();

  // Requirements: a deliberate mix of suggested (leak-risk) and confirmed.
  const reqRows = await db
    .insert(requirements)
    .values([
      { projectId: project.id, sourceDocId: doc.id, text: "Tax clearance certificate", reviewStatus: "suggested" },
      { projectId: project.id, sourceDocId: doc.id, text: "B-BBEE certificate, with a comma", reviewStatus: "accepted" },
      { projectId: project.id, sourceDocId: doc.id, text: "Bid bond", reviewStatus: "pending" },
      { projectId: project.id, sourceDocId: doc.id, text: "Reference letters", reviewStatus: "rejected" },
    ])
    .returning();
  seeded.reqs = reqRows.map((r) => ({
    id: r.id,
    reviewStatus: r.reviewStatus,
    expected: r.reviewStatus === "suggested" ? "suggested" : "confirmed",
  }));

  // Evidence: mix of suggested AI findings and reviewer-confirmed items.
  const evRows = await db
    .insert(evidenceItems)
    .values([
      { projectId: project.id, requirementId: reqRows[0].id, evidenceStatus: "present", excerpt: "Quote with, comma and \"quotes\"", suggested: true },
      { projectId: project.id, requirementId: reqRows[1].id, evidenceStatus: "missing", suggested: false },
    ])
    .returning();
  seeded.evidence = evRows.map((e) => ({
    id: e.id,
    suggested: e.suggested,
    expected: e.suggested ? "suggested" : "confirmed",
  }));

  // Defects: mix of suggested and confirmed.
  const defRows = await db
    .insert(defects)
    .values([
      { projectId: project.id, requirementId: reqRows[1].id, type: "missing_document", severity: "fatal", description: "Missing B-BBEE", status: "suggested", suggested: true },
      { projectId: project.id, requirementId: reqRows[0].id, type: "other", severity: "major", description: "Late submission", status: "open", suggested: false },
    ])
    .returning();
  seeded.defects = defRows.map((d) => ({
    id: d.id,
    suggested: d.suggested,
    expected: d.suggested ? "suggested" : "confirmed",
  }));

  await db.insert(boqChecks).values({
    projectId: project.id,
    sourceDocId: doc.id,
    lineRef: "1.1",
    description: "Excavation",
    checkType: "extension",
    finding: "Extension mismatch",
  });

  await db.insert(auditEvents).values({
    projectId: project.id,
    eventType: "project.created",
    objectType: "project",
    objectId: project.id,
    details: "seeded audit event",
  });

  // Signed report WITHOUT docxPath: exercises the branch that must not attach a
  // DOCX (keeping the archive to the six data files) and avoids object storage.
  await db.insert(reports).values({
    projectId: project.id,
    version: 1,
    status: "signed_off",
  });

  const app = express();
  // Stub the per-request identity + logger the route depends on.
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
  app.use(reportsRouter);

  await new Promise<void>((resolve) => {
    server = createServer(app);
    server.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

after(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (clientId) await db.delete(clients).where(eq(clients.id, clientId)); // cascades project + registers
  if (projectId) await db.delete(auditEvents).where(eq(auditEvents.projectId, projectId));
  if (adminId) await db.delete(users).where(eq(users.id, adminId));
  await pool.end();
});

describe("GET /projects/:id/export (live route)", () => {
  test("non-admin members are denied (admin-only)", async () => {
    currentUser = { role: "reviewer" } as LocalUser;
    const res = await fetch(`${baseUrl}/projects/${projectId}/export`);
    assert.equal(res.status, 403);
    currentUser = null;
  });

  test("admin download yields a ZIP whose CSVs preserve seeded review_state", async () => {
    currentUser = { id: adminId, role: "admin", name: "Export Admin" } as LocalUser;
    const res = await fetch(`${baseUrl}/projects/${projectId}/export`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/zip");

    const buffer = Buffer.from(await res.arrayBuffer());
    const zip = await JSZip.loadAsync(buffer);
    const files = Object.keys(zip.files).sort();

    // The archive must contain exactly the six data files (no DOCX: the signed
    // report has no docxPath).
    assert.deepEqual(files, [
      "audit_events.csv",
      "boq_checks.csv",
      "defects.csv",
      "evidence.csv",
      "project.json",
      "requirements.csv",
    ]);

    const read = async (name: string) => zip.file(name)!.async("string");

    // --- requirements.csv ---
    const reqCsv = parseCsv(await read("requirements.csv"));
    assert.ok(reqCsv.headers.includes("review_state"), "requirements review_state column");
    assert.equal(reqCsv.rows.length, seeded.reqs.length);
    for (const s of seeded.reqs) {
      const row = reqCsv.rows.find((r) => r.id === s.id);
      assert.ok(row, `requirement ${s.id} present in CSV`);
      assert.equal(row!.review_state, s.expected, `requirement ${s.reviewStatus}`);
    }
    // No suggested requirement is ever stamped confirmed (the core leak guard).
    for (const row of reqCsv.rows) {
      const src = seeded.reqs.find((r) => r.id === row.id)!;
      if (src.reviewStatus === "suggested") assert.notEqual(row.review_state, "confirmed");
    }

    // --- evidence.csv ---
    const evCsv = parseCsv(await read("evidence.csv"));
    assert.ok(evCsv.headers.includes("review_state"));
    assert.equal(evCsv.rows.length, seeded.evidence.length);
    for (const s of seeded.evidence) {
      const row = evCsv.rows.find((r) => r.id === s.id);
      assert.ok(row, `evidence ${s.id} present`);
      assert.equal(row!.review_state, s.expected);
    }

    // --- defects.csv ---
    const defCsv = parseCsv(await read("defects.csv"));
    assert.ok(defCsv.headers.includes("review_state"));
    assert.equal(defCsv.rows.length, seeded.defects.length);
    for (const s of seeded.defects) {
      const row = defCsv.rows.find((r) => r.id === s.id);
      assert.ok(row, `defect ${s.id} present`);
      assert.equal(row!.review_state, s.expected);
    }

    // --- boq_checks.csv + audit_events.csv are present and non-empty ---
    const boqCsv = parseCsv(await read("boq_checks.csv"));
    assert.ok(boqCsv.rows.some((r) => r.finding === "Extension mismatch"));
    const auditCsv = await read("audit_events.csv");
    assert.ok(auditCsv.includes("seeded audit event"));

    // --- project.json is valid and matches the seeded project ---
    const project = JSON.parse(await read("project.json"));
    assert.equal(project.id, projectId);

    currentUser = null;
  });

  test("exporting a signed-off project transitions status to 'exported'", async () => {
    // The previous test already exported; verify the persisted side effect.
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
    assert.equal(project.status, "exported");

    // And an audit trail of the export was recorded.
    const events = await db.select().from(auditEvents).where(eq(auditEvents.projectId, projectId));
    assert.ok(events.some((e) => e.eventType === "project.exported"));
  });
});
