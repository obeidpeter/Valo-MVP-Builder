import { test, describe, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createRequire } from "node:module";
import type { Archiver, ArchiverOptions } from "archiver";
import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import JSZip from "jszip";
import { eq, sql } from "drizzle-orm";
import {
  db,
  pool,
  users,
  organisations,
  clients,
  projects,
  documents,
  requirements,
  evidenceItems,
  defects,
  boqChecks,
  auditEvents,
  reports,
  redTeamRuns,
} from "@workspace/db";
import reportsRouter from "./reports";
import type { LocalUser } from "../middlewares/auth";
import { type AccessContext } from "../middlewares/tenancy";
import { attachTenantDatabase } from "../middlewares/databaseTenancy";
import { normalizeLegacyRole, permissionsForRoles } from "../lib/permissions";
import { ObjectStorageService } from "../lib/objectStorage";
import { writeAudit } from "../lib/audit";
import { DOCX_MIME } from "../lib/docx";
import { PDF_MIME } from "../lib/pdf";
import {
  ENGINE_VERSION,
  MODEL_ID,
  PROMPT_PACK_VERSION,
  TAXONOMY_VERSION,
} from "../lib/provenance";

/**
 * End-to-end proof that the real `GET /projects/:id/export` HTTP route can't
 * leak or corrupt findings. Unlike the unit tests in `reports.test.ts` (which
 * only exercise the extracted `review_state` helpers), this test seeds a live
 * database, drives the actual Express handler over HTTP, unzips the streamed
 * archiver response in memory, and asserts the bytes of every CSV. It also
 * covers export-permission auth and the project.status -> "exported"
 * transition, so a refactor that reorders columns, drops a CSV, or breaks the
 * wiring is caught.
 */

// The middleware-injected user for the current request (swapped per test to
// exercise allowed and denied permissions without a real Clerk session).
let currentUser: LocalUser | null = null;

let server: Server;
let baseUrl: string;

// Seeded identifiers, captured so we can assert per-row review_state.
let clientId: string;
let projectId: string;
let adminId: string;
let generatorId: string;
let organisationId: string;
let signedReportId: string;
let draftReportId: string;

// The bytes an object-storage download() is faked to return for the signed
// report's .docx, so we can assert the exact payload lands in the ZIP / stream
// without touching real object storage.
const FAKE_DOCX_BYTES = Buffer.from(
  "PK\u0003\u0004 valo signed report .docx payload",
  "utf8",
);
const unavailableObjectPaths = new Set<string>();
const seeded = {
  reqs: [] as { id: string; reviewStatus: string; expected: string }[],
  evidence: [] as { id: string; suggested: boolean; expected: string }[],
  defects: [] as { id: string; suggested: boolean; expected: string }[],
};

/** Parse a CSV string into headers + row objects, honouring quoted fields. */
function parseCsv(csv: string): {
  headers: string[];
  rows: Record<string, string>[];
} {
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
  const rows = records
    .slice(1)
    .map((cells) => Object.fromEntries(headers.map((h, i) => [h, cells[i]])));
  return { headers, rows };
}

async function matchingAuditEventCount(
  eventType: string,
  objectId: string,
): Promise<number> {
  const events = await db
    .select({
      eventType: auditEvents.eventType,
      objectId: auditEvents.objectId,
    })
    .from(auditEvents)
    .where(eq(auditEvents.projectId, projectId));

  return events.filter(
    (event) => event.eventType === eventType && event.objectId === objectId,
  ).length;
}

async function waitForAuditEventCount(
  eventType: string,
  objectId: string,
  minimumCount: number,
): Promise<void> {
  const deadline = Date.now() + 2_000;

  while (Date.now() < deadline) {
    if ((await matchingAuditEventCount(eventType, objectId)) >= minimumCount) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  assert.fail(
    `${eventType} audit event for ${objectId} was not committed within 2 seconds`,
  );
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

  const [generator] = await db
    .insert(users)
    .values({
      clerkUserId: `__export_it_generator__${stamp}`,
      email: `generator-${stamp}@export-it.local`,
      name: "Report Generator",
      role: "analyst",
      status: "active",
    })
    .returning();
  generatorId = generator.id;

  const [organisation] = await db
    .insert(organisations)
    .values({
      name: `__EXPORT_IT_ORG__ ${stamp}`,
      slug: `export-it-${Date.now()}`,
      type: "client",
    })
    .returning();
  organisationId = organisation.id;

  const [client] = await db
    .insert(clients)
    .values({
      name: `__EXPORT_IT__ ${stamp}`,
      organisationId,
      ndaStatus: "signed",
    })
    .returning();
  clientId = client.id;

  const [project] = await db
    .insert(projects)
    .values({
      clientId: client.id,
      organisationId,
      tenderTitle: "Export Integration VMT-2026-999",
      status: "signed_off",
      reviewerId: admin.id,
      paymentStatus: "not_required",
      conflictStatus: "clear",
      physicalArchiveInstruction:
        "Return all hard copies to client within 7 days",
    })
    .returning();
  projectId = project.id;

  const [doc] = await db
    .insert(documents)
    .values({
      organisationId,
      projectId: project.id,
      type: "tender",
      filename: "tender.txt",
      objectPath: "export-it/tender.txt",
      sha256: "a".repeat(64),
      redactionStatus: "included",
      extractionStatus: "extracted",
    })
    .returning();

  await db.insert(documents).values({
    organisationId,
    projectId: project.id,
    type: "bid",
    filename: "bid.txt",
    objectPath: "export-it/bid.txt",
    sha256: "b".repeat(64),
    redactionStatus: "included",
    extractionStatus: "extracted",
  });

  // Requirements: reviewed states only; an unreviewed suggestion would block
  // the package before any bytes are streamed.
  const reqRows = await db
    .insert(requirements)
    .values([
      {
        organisationId,
        projectId: project.id,
        sourceDocId: doc.id,
        pageRef: "1",
        text: "Tax clearance certificate",
        reviewStatus: "confirmed",
      },
      {
        organisationId,
        projectId: project.id,
        sourceDocId: doc.id,
        clauseRef: "2.1",
        text: "B-BBEE certificate, with a comma",
        reviewStatus: "edited",
      },
      {
        organisationId,
        projectId: project.id,
        sourceDocId: doc.id,
        pageRef: "3",
        text: "Bid bond",
        reviewStatus: "confirmed",
      },
      {
        organisationId,
        projectId: project.id,
        sourceDocId: doc.id,
        text: "Reference letters",
        reviewStatus: "rejected",
      },
    ])
    .returning();
  seeded.reqs = reqRows.map((r) => ({
    id: r.id,
    reviewStatus: r.reviewStatus,
    expected: r.reviewStatus === "suggested" ? "suggested" : "confirmed",
  }));

  // Evidence is reviewer-confirmed and resolves every mandatory requirement.
  const evRows = await db
    .insert(evidenceItems)
    .values([
      {
        organisationId,
        projectId: project.id,
        requirementId: reqRows[0].id,
        evidenceStatus: "present",
        excerpt: 'Quote with, comma and "quotes"',
        suggested: false,
      },
      {
        organisationId,
        projectId: project.id,
        requirementId: reqRows[1].id,
        evidenceStatus: "not_applicable",
        suggested: false,
      },
      {
        organisationId,
        projectId: project.id,
        requirementId: reqRows[2].id,
        evidenceStatus: "present",
        suggested: false,
      },
    ])
    .returning();
  seeded.evidence = evRows.map((e) => ({
    id: e.id,
    suggested: e.suggested,
    expected: e.suggested ? "suggested" : "confirmed",
  }));

  // Defects are reviewer-owned; the fatal item is resolved before release.
  const defRows = await db
    .insert(defects)
    .values([
      {
        organisationId,
        projectId: project.id,
        requirementId: reqRows[1].id,
        type: "missing_document",
        severity: "fatal",
        description: "Missing B-BBEE",
        status: "resolved",
        suggested: false,
      },
      {
        organisationId,
        projectId: project.id,
        requirementId: reqRows[0].id,
        type: "other",
        severity: "scoring_risk",
        description: "Late submission",
        status: "open",
        suggested: false,
      },
    ])
    .returning();
  seeded.defects = defRows.map((d) => ({
    id: d.id,
    suggested: d.suggested,
    expected: d.suggested ? "suggested" : "confirmed",
  }));

  await db.insert(boqChecks).values({
    organisationId,
    projectId: project.id,
    sourceDocId: doc.id,
    lineRef: "1.1",
    description: "Excavation",
    checkType: "extension",
    finding: "Extension mismatch",
    status: "resolved",
  });

  await writeAudit({
    organisationId,
    projectId: project.id,
    eventType: "project.created",
    objectType: "project",
    objectId: project.id,
    details: "seeded audit event",
  });

  await db.insert(redTeamRuns).values({
    organisationId,
    projectId: project.id,
    sourceSnapshotHash: "c".repeat(64),
    policyVersion: "test-policy-v1",
    status: "approved",
    initiatedByUserId: generatorId,
    approvedByUserId: adminId,
    approvedAt: new Date(),
  });

  const [draft] = await db
    .insert(reports)
    .values({
      organisationId,
      projectId: project.id,
      version: 1,
      status: "draft",
      docxPath: "/objects/uploads/draft-report-v1",
      pdfPath: "/objects/uploads/draft-report-v1-pdf",
      generatedBy: generatorId,
      engineVersion: ENGINE_VERSION,
      promptPackVersion: PROMPT_PACK_VERSION,
      modelId: MODEL_ID,
      taxonomyVersion: TAXONOMY_VERSION,
    })
    .returning();
  draftReportId = draft.id;

  const [signed] = await db
    .insert(reports)
    .values({
      organisationId,
      projectId: project.id,
      version: 2,
      status: "signed_off",
      docxPath: "/objects/uploads/signed-report-v2",
      pdfPath: "/objects/uploads/signed-report-v2-pdf",
      generatedBy: generatorId,
      reviewerId: adminId,
      reviewerName: "Export Admin",
      signedOffAt: new Date(),
      engineVersion: ENGINE_VERSION,
      promptPackVersion: PROMPT_PACK_VERSION,
      modelId: MODEL_ID,
      taxonomyVersion: TAXONOMY_VERSION,
    })
    .returning();
  signedReportId = signed.id;

  mock.method(
    ObjectStorageService.prototype,
    "getObjectEntityFile",
    async (objectPath: string) => {
      if (unavailableObjectPaths.has(objectPath)) {
        throw new Error("simulated unavailable governed report artefact");
      }
      return {
        download: async () => [FAKE_DOCX_BYTES],
      } as unknown as Awaited<
        ReturnType<ObjectStorageService["getObjectEntityFile"]>
      >;
    },
  );

  const app = express();
  // Stub a direct tenant membership and logger around the real RLS transaction
  // middleware. Route permissions still derive from the selected role.
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
  mock.restoreAll();
  if (server)
    await new Promise<void>((resolve) => server.close(() => resolve()));
  if (projectId) {
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT set_config('valo.audit_test_cleanup', 'approved', true)`,
      );
      await tx.delete(auditEvents).where(eq(auditEvents.projectId, projectId));
    });
  }
  if (clientId) await db.delete(clients).where(eq(clients.id, clientId));
  if (adminId) await db.delete(users).where(eq(users.id, adminId));
  if (generatorId) await db.delete(users).where(eq(users.id, generatorId));
  if (organisationId)
    await db.delete(organisations).where(eq(organisations.id, organisationId));
  await pool.end();
});

describe("GET /projects/:id/export (live route)", () => {
  test("members without report:export are denied", async () => {
    currentUser = { id: generatorId, role: "reviewer" } as LocalUser;
    const res = await fetch(`${baseUrl}/projects/${projectId}/export`);
    assert.equal(res.status, 403);
    currentUser = null;
  });

  test("a signed-off project without a physical-archive instruction is denied export (409)", async () => {
    const stamp = new Date().toISOString();
    const [gated] = await db
      .insert(projects)
      .values({
        organisationId,
        clientId,
        tenderTitle: `Export archive-gate ${stamp}`,
        status: "signed_off",
        reviewerId: adminId,
        paymentStatus: "not_required",
        conflictStatus: "clear",
      })
      .returning();
    await db.insert(reports).values({
      organisationId,
      projectId: gated.id,
      version: 1,
      status: "signed_off",
      docxPath: "/objects/uploads/archive-gate-report",
      generatedBy: generatorId,
      reviewerId: adminId,
      reviewerName: "Export Admin",
      signedOffAt: new Date(),
      engineVersion: ENGINE_VERSION,
      promptPackVersion: PROMPT_PACK_VERSION,
      modelId: MODEL_ID,
      taxonomyVersion: TAXONOMY_VERSION,
    });
    try {
      currentUser = {
        id: adminId,
        role: "admin",
        name: "Export Admin",
      } as LocalUser;
      const res = await fetch(`${baseUrl}/projects/${gated.id}/export`);
      assert.equal(res.status, 409);
    } finally {
      await db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT set_config('valo.audit_test_cleanup', 'approved', true)`,
        );
        await tx.delete(auditEvents).where(eq(auditEvents.projectId, gated.id));
      });
      await db.delete(projects).where(eq(projects.id, gated.id));
      currentUser = null;
    }
  });

  test("admin download yields a ZIP whose CSVs preserve seeded review_state", async () => {
    currentUser = {
      id: adminId,
      role: "admin",
      name: "Export Admin",
    } as LocalUser;
    const res = await fetch(`${baseUrl}/projects/${projectId}/export`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/zip");

    const buffer = Buffer.from(await res.arrayBuffer());
    const zip = await JSZip.loadAsync(buffer);
    const files = Object.keys(zip.files).sort();

    // A release package is invalid without its latest governed report.
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

    const read = async (name: string) => zip.file(name)!.async("string");

    // --- requirements.csv ---
    const reqCsv = parseCsv(await read("requirements.csv"));
    assert.ok(
      reqCsv.headers.includes("review_state"),
      "requirements review_state column",
    );
    assert.equal(reqCsv.rows.length, seeded.reqs.length);
    for (const s of seeded.reqs) {
      const row = reqCsv.rows.find((r) => r.id === s.id);
      assert.ok(row, `requirement ${s.id} present in CSV`);
      assert.equal(
        row!.review_state,
        s.expected,
        `requirement ${s.reviewStatus}`,
      );
    }
    assert.ok(
      reqCsv.rows.every((row) => row.review_state === "confirmed"),
      "the release gate prevents unreviewed suggestions entering the package",
    );

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
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId));
    assert.equal(project.status, "exported");

    // And an audit trail of the export was recorded.
    const events = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.projectId, projectId));
    assert.ok(events.some((e) => e.eventType === "project.exported"));
  });

  // Fetch the mandatory report before sending ZIP headers so storage failure
  // is a clean non-200 rather than a partial or corrupt successful download.
  test("an unavailable signed artefact fails closed before ZIP streaming", async () => {
    const objectPath = "/objects/uploads/signed-report-v2";
    unavailableObjectPaths.add(objectPath);
    try {
      currentUser = {
        id: adminId,
        role: "admin",
        name: "Export Admin",
      } as LocalUser;
      const res = await fetch(`${baseUrl}/projects/${projectId}/export`);
      assert.equal(res.status, 502);
      assert.match(
        ((await res.json()) as { error: string }).error,
        /signed report artefact is unavailable/i,
      );

      const [project] = await db
        .select()
        .from(projects)
        .where(eq(projects.id, projectId));
      assert.equal(project.status, "exported");
    } finally {
      unavailableObjectPaths.delete(objectPath);
      currentUser = null;
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
      setTimeout(
        () => archive.emit("error", new Error("simulated mid-stream failure")),
        2,
      );
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
      assert.equal(
        bodyReadSucceeded,
        false,
        "client body read must fail on a mid-stream abort",
      );
      // And it certainly must never be handed a valid-looking, complete ZIP.
      assert.equal(
        validZip,
        false,
        "a mid-stream failure must never produce a valid ZIP",
      );
    } finally {
      await new Promise<void>((resolve) => srv.close(() => resolve()));
    }
  });
});

/**
 * Pins the object-storage-backed branches: attaching the latest signed-off
 * report's .docx into the project export ZIP, and the individual download
 * endpoints. The storage method is faked so a refactor that silently drops the
 * signed report (recipients get CSVs but no report) or breaks the download route
 * is caught.
 */
describe("object-storage-backed report attach & download", () => {
  test("export ZIP attaches the latest signed-off report's .docx with its bytes", async () => {
    const [releasedBefore] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId));
    assert.equal(releasedBefore.status, "exported");
    currentUser = {
      id: adminId,
      role: "admin",
      name: "Export Admin",
    } as LocalUser;
    const res = await fetch(`${baseUrl}/projects/${projectId}/export`);
    assert.equal(res.status, 200);

    const buffer = Buffer.from(await res.arrayBuffer());
    const zip = await JSZip.loadAsync(buffer);
    const files = Object.keys(zip.files).sort();

    // The data files (CSV registers, documents manifest, scorecard, project
    // JSON) PLUS the signed report .docx (versioned filename from the latest
    // signed-off report that has a docxPath, i.e. v2 after the draft v1).
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
    const docxBytes = await zip
      .file("bid-autopsy-report-v2.docx")!
      .async("nodebuffer");
    assert.ok(
      docxBytes.equals(FAKE_DOCX_BYTES),
      "attached .docx bytes match storage payload",
    );

    const [releasedAfter] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId));
    assert.equal(releasedAfter.status, "exported");
    assert.equal(
      releasedAfter.version,
      releasedBefore.version,
      "re-export does not rewrite released project content",
    );

    currentUser = null;
  });

  test("download of a signed-off report streams the .docx bytes + filename", async () => {
    const auditCountBefore = await matchingAuditEventCount(
      "report.exported",
      signedReportId,
    );
    currentUser = {
      id: adminId,
      role: "admin",
      name: "Export Admin",
    } as LocalUser;
    const res = await fetch(`${baseUrl}/reports/${signedReportId}/download`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), DOCX_MIME);
    assert.equal(
      res.headers.get("content-disposition"),
      'attachment; filename="bid-autopsy-report-v2.docx"',
    );

    const body = Buffer.from(await res.arrayBuffer());
    assert.ok(
      body.equals(FAKE_DOCX_BYTES),
      "downloaded bytes match storage payload",
    );

    // The transaction is committed from the response lifecycle, which can
    // settle just after fetch() returns. Require this request's new event.
    await waitForAuditEventCount(
      "report.exported",
      signedReportId,
      auditCountBefore + 1,
    );

    currentUser = null;
  });

  test("download of a not-signed-off report is denied (403) and audited", async () => {
    const auditCountBefore = await matchingAuditEventCount(
      "report.export_denied",
      draftReportId,
    );
    currentUser = {
      id: adminId,
      role: "admin",
      name: "Export Admin",
    } as LocalUser;
    const res = await fetch(`${baseUrl}/reports/${draftReportId}/download`);
    assert.equal(res.status, 403);

    await waitForAuditEventCount(
      "report.export_denied",
      draftReportId,
      auditCountBefore + 1,
    );

    currentUser = null;
  });

  test("download-pdf of a signed-off report streams the .pdf bytes + filename", async () => {
    const auditCountBefore = await matchingAuditEventCount(
      "report.exported",
      signedReportId,
    );
    currentUser = {
      id: adminId,
      role: "admin",
      name: "Export Admin",
    } as LocalUser;
    const res = await fetch(
      `${baseUrl}/reports/${signedReportId}/download-pdf`,
    );
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), PDF_MIME);
    assert.equal(
      res.headers.get("content-disposition"),
      'attachment; filename="bid-autopsy-report-v2.pdf"',
    );

    const body = Buffer.from(await res.arrayBuffer());
    assert.ok(
      body.equals(FAKE_DOCX_BYTES),
      "downloaded bytes match storage payload",
    );

    // The successful PDF export is audited with report.exported, mirroring DOCX.
    await waitForAuditEventCount(
      "report.exported",
      signedReportId,
      auditCountBefore + 1,
    );

    currentUser = null;
  });

  test("download-pdf of a not-signed-off report is denied (403) and audited", async () => {
    const auditCountBefore = await matchingAuditEventCount(
      "report.export_denied",
      draftReportId,
    );
    currentUser = {
      id: adminId,
      role: "admin",
      name: "Export Admin",
    } as LocalUser;
    const res = await fetch(`${baseUrl}/reports/${draftReportId}/download-pdf`);
    assert.equal(res.status, 403);

    await waitForAuditEventCount(
      "report.export_denied",
      draftReportId,
      auditCountBefore + 1,
    );

    currentUser = null;
  });
});
