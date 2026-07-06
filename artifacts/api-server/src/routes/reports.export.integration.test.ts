import { test, describe, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createRequire } from "node:module";
import type { Archiver, ArchiverOptions } from "archiver";
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
import { ObjectStorageService } from "../lib/objectStorage";
import { DOCX_MIME } from "../lib/docx";
import { PDF_MIME } from "../lib/pdf";

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

// The bytes an object-storage download() is faked to return for the signed
// report's .docx, so we can assert the exact payload lands in the ZIP / stream
// without touching real object storage.
const FAKE_DOCX_BYTES = Buffer.from("PK\u0003\u0004 valo signed report .docx payload", "utf8");
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
      physicalArchiveInstruction: "Return all hard copies to client within 7 days",
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
  // DOCX (keeping the archive to the data files only) and avoids object storage.
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

  test("a signed-off project without a physical-archive instruction is denied export (409)", async () => {
    const stamp = new Date().toISOString();
    const [gated] = await db
      .insert(projects)
      .values({
        clientId,
        tenderTitle: `Export archive-gate ${stamp}`,
        status: "signed_off",
        reviewerId: adminId,
      })
      .returning();
    try {
      currentUser = { id: adminId, role: "admin", name: "Export Admin" } as LocalUser;
      const res = await fetch(`${baseUrl}/projects/${gated.id}/export`);
      assert.equal(res.status, 409);
    } finally {
      await db.delete(projects).where(eq(projects.id, gated.id));
      currentUser = null;
    }
  });

  test("admin download yields a ZIP whose CSVs preserve seeded review_state", async () => {
    currentUser = { id: adminId, role: "admin", name: "Export Admin" } as LocalUser;
    const res = await fetch(`${baseUrl}/projects/${projectId}/export`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/zip");

    const buffer = Buffer.from(await res.arrayBuffer());
    const zip = await JSZip.loadAsync(buffer);
    const files = Object.keys(zip.files).sort();

    // The archive must contain exactly the eight data files (no DOCX: the
    // signed report has no docxPath).
    assert.deepEqual(files, [
      "audit_events.csv",
      "boq_checks.csv",
      "defects.csv",
      "documents_manifest.csv",
      "evidence.csv",
      "project.json",
      "requirements.csv",
      "scorecard.json",
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

  // Regression guard for the export corruption bug: the signed DOCX is fetched
  // from object storage *before* the response is committed to streaming, so a
  // storage failure while attaching it can never surface as a truncated,
  // corrupt-but-"successful" ZIP. A missing/failed DOCX stays non-fatal, so the
  // client must still receive a complete, valid archive of the data files.
  test("a storage failure attaching the signed report yields a complete, valid ZIP (never a corrupt 200)", async () => {
    const stamp = new Date().toISOString();
    const [proj] = await db
      .insert(projects)
      .values({
        clientId,
        tenderTitle: `Export storage-failure ${stamp}`,
        status: "signed_off",
        reviewerId: adminId,
        physicalArchiveInstruction: "Return all hard copies to client within 7 days",
      })
      .returning();

    // A signed report whose docxPath points at an object that cannot be
    // downloaded (it does not exist), forcing the object-storage fetch to throw.
    await db.insert(reports).values({
      projectId: proj.id,
      version: 1,
      status: "signed_off",
      docxPath: `/objects/does-not-exist-${stamp}`,
    });

    try {
      currentUser = { id: adminId, role: "admin", name: "Export Admin" } as LocalUser;
      const res = await fetch(`${baseUrl}/projects/${proj.id}/export`);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("content-type"), "application/zip");

      // The body must be a *complete, parseable* ZIP — not a truncated stream.
      const buffer = Buffer.from(await res.arrayBuffer());
      const zip = await JSZip.loadAsync(buffer);
      const files = Object.keys(zip.files).sort();

      // Exactly the data files, and crucially no partial/failed DOCX entry.
      assert.deepEqual(files, [
        "audit_events.csv",
        "boq_checks.csv",
        "defects.csv",
        "documents_manifest.csv",
        "evidence.csv",
        "project.json",
        "requirements.csv",
        "scorecard.json",
      ]);
      assert.ok(!files.some((f) => f.endsWith(".docx")), "no DOCX attached on storage failure");
      currentUser = null;
    } finally {
      await db.delete(auditEvents).where(eq(auditEvents.projectId, proj.id));
      await db.delete(projects).where(eq(projects.id, proj.id)); // cascades reports
    }
  });
});

/**
 * The export streams the archive to the client with a 200 + zip headers already
 * flushed. If the archiver fails mid-stream, the status code can no longer be
 * changed — ending the response cleanly would hand the client a 200 with a
 * truncated, corrupt ZIP that *looks* successful. This test reproduces the
 * route's exact streaming/error wiring (`archive.pipe(res)` +
 * `archive.on("error", err => res.destroy(err))`) and forces a mid-stream
 * archive error, asserting the client detects the truncation (its body read
 * fails) rather than receiving a clean-but-corrupt download.
 */
describe("mid-stream archive failure aborts the download", () => {
  const nodeRequire = createRequire(import.meta.url);
  const { ZipArchive } = nodeRequire("archiver") as {
    ZipArchive: new (options?: ArchiverOptions) => Archiver;
  };

  test("client cannot read a complete body when the archive errors after headers are sent", async () => {
    const srv = createServer((_req, res) => {
      res.setHeader("Content-Type", "application/zip");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="project-export-abort.zip"`,
      );
      const archive = new ZipArchive({ zlib: { level: 9 } });
      // Same failure handling as the real route: abort the connection so the
      // client sees an incomplete download instead of a clean, corrupt 200.
      archive.on("error", (err) => {
        res.destroy(err as Error);
      });
      archive.pipe(res);
      // Enough data to flush headers + partial body before we fail.
      archive.append(Buffer.alloc(300_000, 65), { name: "data.bin" });
      void archive.finalize();
      setTimeout(() => archive.emit("error", new Error("simulated mid-stream failure")), 2);
    });

    await new Promise<void>((resolve) => srv.listen(0, () => resolve()));
    const { port } = srv.address() as AddressInfo;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/`);
      // Headers were already flushed, so the status looks like a success...
      let bodyReadSucceeded = false;
      let validZip = false;
      try {
        const buffer = Buffer.from(await res.arrayBuffer());
        bodyReadSucceeded = true;
        try {
          await JSZip.loadAsync(buffer);
          validZip = true;
        } catch {
          validZip = false;
        }
      } catch {
        bodyReadSucceeded = false;
      }

      // ...but the client must NOT be able to read a complete body: the aborted
      // connection surfaces as a read failure, so the truncation is detectable.
      assert.equal(bodyReadSucceeded, false, "client body read must fail on a mid-stream abort");
      // And it certainly must never be handed a valid-looking, complete ZIP.
      assert.equal(validZip, false, "a mid-stream failure must never produce a valid ZIP");
    } finally {
      await new Promise<void>((resolve) => srv.close(() => resolve()));
    }
  });
});

/**
 * Pins the object-storage-backed branches that the CSV-only test above
 * deliberately skips: attaching the latest signed-off report's .docx into the
 * project export ZIP, and the `GET /reports/:id/download` endpoint. Both go
 * through `ObjectStorageService.getObjectEntityFile(...).download()`, which we
 * fake so a refactor that silently drops the signed report (recipients get CSVs
 * but no report) or breaks the download route is caught.
 *
 * These run AFTER the CSV-only describe above so its "exactly six files, no
 * DOCX" assertion sees the report-without-docxPath state; here we introduce
 * reports WITH a docxPath.
 */
describe("object-storage-backed report attach & download", () => {
  // Signed-off report v2 WITH a docxPath -> should be attached to the export and
  // be downloadable. Draft report v3 WITH a docxPath -> download must be denied.
  let signedReportId: string;
  let draftReportId: string;

  before(async () => {
    // Fake the storage download so no real object storage is touched.
    mock.method(
      ObjectStorageService.prototype,
      "getObjectEntityFile",
      async (_objectPath: string) => {
        return {
          download: async () => [FAKE_DOCX_BYTES],
        } as unknown as Awaited<
          ReturnType<ObjectStorageService["getObjectEntityFile"]>
        >;
      },
    );

    const [signed] = await db
      .insert(reports)
      .values({
        projectId,
        version: 2,
        status: "signed_off",
        docxPath: "/objects/uploads/signed-report-v2",
        pdfPath: "/objects/uploads/signed-report-v2-pdf",
      })
      .returning();
    signedReportId = signed.id;

    const [draft] = await db
      .insert(reports)
      .values({
        projectId,
        version: 3,
        status: "draft",
        docxPath: "/objects/uploads/draft-report-v3",
        pdfPath: "/objects/uploads/draft-report-v3-pdf",
      })
      .returning();
    draftReportId = draft.id;
  });

  after(() => {
    mock.restoreAll();
  });

  test("export ZIP attaches the latest signed-off report's .docx with its bytes", async () => {
    currentUser = { id: adminId, role: "admin", name: "Export Admin" } as LocalUser;
    const res = await fetch(`${baseUrl}/projects/${projectId}/export`);
    assert.equal(res.status, 200);

    const buffer = Buffer.from(await res.arrayBuffer());
    const zip = await JSZip.loadAsync(buffer);
    const files = Object.keys(zip.files).sort();

    // The data files (CSV registers, documents manifest, scorecard, project
    // JSON) PLUS the signed report .docx (versioned filename from the latest
    // signed-off report that has a docxPath, i.e. v2 not the draft v3).
    assert.deepEqual(files, [
      "audit_events.csv",
      "bid-autopsy-report-v2.docx",
      "boq_checks.csv",
      "defects.csv",
      "documents_manifest.csv",
      "evidence.csv",
      "project.json",
      "requirements.csv",
      "scorecard.json",
    ]);

    // The attached .docx must be the exact bytes returned by object storage.
    const docxBytes = await zip.file("bid-autopsy-report-v2.docx")!.async("nodebuffer");
    assert.ok(docxBytes.equals(FAKE_DOCX_BYTES), "attached .docx bytes match storage payload");

    currentUser = null;
  });

  test("download of a signed-off report streams the .docx bytes + filename", async () => {
    currentUser = { id: adminId, role: "admin", name: "Export Admin" } as LocalUser;
    const res = await fetch(`${baseUrl}/reports/${signedReportId}/download`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), DOCX_MIME);
    assert.equal(
      res.headers.get("content-disposition"),
      'attachment; filename="bid-autopsy-report-v2.docx"',
    );

    const body = Buffer.from(await res.arrayBuffer());
    assert.ok(body.equals(FAKE_DOCX_BYTES), "downloaded bytes match storage payload");

    // The successful export is audited.
    const events = await db.select().from(auditEvents).where(eq(auditEvents.projectId, projectId));
    assert.ok(
      events.some(
        (e) => e.eventType === "report.exported" && e.objectId === signedReportId,
      ),
      "report.exported audit event written",
    );

    currentUser = null;
  });

  test("download of a not-signed-off report is denied (403) and audited", async () => {
    currentUser = { id: adminId, role: "admin", name: "Export Admin" } as LocalUser;
    const res = await fetch(`${baseUrl}/reports/${draftReportId}/download`);
    assert.equal(res.status, 403);

    const events = await db.select().from(auditEvents).where(eq(auditEvents.projectId, projectId));
    assert.ok(
      events.some(
        (e) => e.eventType === "report.export_denied" && e.objectId === draftReportId,
      ),
      "report.export_denied audit event written",
    );

    currentUser = null;
  });

  test("download-pdf of a signed-off report streams the .pdf bytes + filename", async () => {
    currentUser = { id: adminId, role: "admin", name: "Export Admin" } as LocalUser;
    const res = await fetch(`${baseUrl}/reports/${signedReportId}/download-pdf`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), PDF_MIME);
    assert.equal(
      res.headers.get("content-disposition"),
      'attachment; filename="bid-autopsy-report-v2.pdf"',
    );

    const body = Buffer.from(await res.arrayBuffer());
    assert.ok(body.equals(FAKE_DOCX_BYTES), "downloaded bytes match storage payload");

    // The successful PDF export is audited with report.exported, mirroring DOCX.
    const events = await db.select().from(auditEvents).where(eq(auditEvents.projectId, projectId));
    assert.ok(
      events.some(
        (e) => e.eventType === "report.exported" && e.objectId === signedReportId,
      ),
      "report.exported audit event written for PDF",
    );

    currentUser = null;
  });

  test("download-pdf of a not-signed-off report is denied (403) and audited", async () => {
    currentUser = { id: adminId, role: "admin", name: "Export Admin" } as LocalUser;
    const res = await fetch(`${baseUrl}/reports/${draftReportId}/download-pdf`);
    assert.equal(res.status, 403);

    const events = await db.select().from(auditEvents).where(eq(auditEvents.projectId, projectId));
    assert.ok(
      events.some(
        (e) => e.eventType === "report.export_denied" && e.objectId === draftReportId,
      ),
      "report.export_denied audit event written for PDF",
    );

    currentUser = null;
  });
});
