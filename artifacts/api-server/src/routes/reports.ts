import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "node:stream";
import { createRequire } from "node:module";
import type { Archiver, ArchiverError, ArchiverOptions } from "archiver";
import { eq, desc, sql } from "drizzle-orm";
import {
  db,
  reports,
  projects,
  clients,
  users,
  requirements,
  evidenceItems,
  defects,
  boqChecks,
  auditEvents,
  documents,
} from "@workspace/db";
import { SignOffReportBody } from "@workspace/api-zod";
import { requireMember, requireRoles, getLocalUser } from "../middlewares/auth";
import { serializeReport } from "../lib/serializers";
import { writeAudit } from "../lib/audit";
import { buildReportDocx, DOCX_MIME, type ReportData } from "../lib/docx";
import { ENGINE_VERSION, PROMPT_PACK_VERSION, MODEL_ID } from "../lib/provenance";
import { computeRisk, blockingSignOffDefects, type Severity } from "../lib/deterministic";
import { computeScorecard } from "../lib/scorecard";
import { ObjectStorageService } from "../lib/objectStorage";

const router: IRouter = Router();
const objectStorage = new ObjectStorageService();

// archiver@8 dropped the classic default `archiver(format, options)` factory and
// now only exports named classes, so we construct a `ZipArchive` directly.
const nodeRequire = createRequire(import.meta.url);
const { ZipArchive } = nodeRequire("archiver") as {
  ZipArchive: new (options?: ArchiverOptions) => Archiver;
};

async function gatherReportData(projectId: string): Promise<ReportData | null> {
  const [row] = await db
    .select({ project: projects, client: clients, reviewerName: users.name })
    .from(projects)
    .leftJoin(clients, eq(projects.clientId, clients.id))
    .leftJoin(users, eq(projects.reviewerId, users.id))
    .where(eq(projects.id, projectId));
  if (!row) return null;

  const reqs = await db.select().from(requirements).where(eq(requirements.projectId, projectId));
  const ev = await db.select().from(evidenceItems).where(eq(evidenceItems.projectId, projectId));
  const defs = await db.select().from(defects).where(eq(defects.projectId, projectId));
  const boqs = await db.select().from(boqChecks).where(eq(boqChecks.projectId, projectId));

  const risk = computeRisk({
    defects: defs.map((d) => ({ severity: d.severity as Severity, status: d.status })),
    requirements: reqs.map((r) => ({
      id: r.id,
      isMandatory: r.isMandatory,
      reviewStatus: r.reviewStatus,
    })),
    evidence: ev.map((e) => ({
      requirementId: e.requirementId,
      evidenceStatus: e.evidenceStatus,
      suggested: e.suggested,
    })),
  });

  return {
    project: row.project,
    client: row.client,
    reviewerName: row.reviewerName ?? null,
    requirements: reqs,
    evidence: ev,
    defects: defs,
    boqChecks: boqs,
    risk: {
      score: risk.score,
      band: row.project.riskOverrideBand || risk.band,
      explanation: risk.explanation,
      overrideBand: row.project.riskOverrideBand,
      overrideNote: row.project.riskOverrideNote,
      overrideBy: row.project.riskOverrideBy,
    },
    version: 1,
    generatedByName: null,
  };
}

router.get("/projects/:id/reports", requireMember, async (req: Request, res: Response) => {
  const projectId = String(req.params.id);
  const rows = await db
    .select({ report: reports, generatedByName: users.name })
    .from(reports)
    .leftJoin(users, eq(reports.generatedBy, users.id))
    .where(eq(reports.projectId, projectId))
    .orderBy(desc(reports.version));
  await writeAudit({
    user: getLocalUser(req),
    projectId,
    eventType: "report.viewed",
    objectType: "project",
    objectId: projectId,
    details: `${rows.length} report version(s)`,
  });
  res.json(rows.map((r) => serializeReport(r.report, r.generatedByName)));
});

router.post(
  "/projects/:id/generate-report",
  requireMember,
  async (req: Request, res: Response) => {
    const data = await gatherReportData(String(req.params.id));
    if (!data) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const user = getLocalUser(req);
    const [{ maxVersion }] = await db
      .select({ maxVersion: sql<number>`coalesce(max(${reports.version}), 0)::int` })
      .from(reports)
      .where(eq(reports.projectId, String(req.params.id)));
    const version = Number(maxVersion) + 1;
    data.version = version;
    data.generatedByName = user?.name ?? null;

    let docxPath: string | null = null;
    try {
      const buffer = await buildReportDocx(data);
      const uploadURL = await objectStorage.getObjectEntityUploadURL();
      const putRes = await fetch(uploadURL, {
        method: "PUT",
        headers: { "Content-Type": DOCX_MIME },
        body: buffer,
      });
      if (!putRes.ok) throw new Error(`Upload failed: ${putRes.status}`);
      docxPath = objectStorage.normalizeObjectEntityPath(uploadURL);
    } catch (error) {
      req.log.error({ err: error }, "report generation failed");
      res.status(500).json({ error: "Report generation failed" });
      return;
    }

    const [created] = await db
      .insert(reports)
      .values({
        projectId: String(req.params.id),
        version,
        status: "draft",
        docxPath,
        engineVersion: ENGINE_VERSION,
        promptPackVersion: PROMPT_PACK_VERSION,
        modelId: MODEL_ID,
        generatedBy: user?.id ?? null,
      })
      .returning();

    if (data.project.status === "defects" || data.project.status === "review") {
      await db.update(projects).set({ status: "reporting" }).where(eq(projects.id, String(req.params.id)));
    }
    await writeAudit({
      user,
      projectId: String(req.params.id),
      eventType: "report.generated",
      objectType: "report",
      objectId: created.id,
      details: `v${version}`,
    });
    res.status(201).json(serializeReport(created, user?.name));
  },
);

router.post(
  "/reports/:id/sign-off",
  requireRoles("admin", "reviewer"),
  async (req: Request, res: Response) => {
    const parsed = SignOffReportBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    const user = getLocalUser(req);
    const [report] = await db
      .select()
      .from(reports)
      .where(eq(reports.id, String(req.params.id)));
    if (!report) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    // Fatal-block invariant: a report cannot be signed off while any open
    // fatal or likely-fatal defect remains on the project. This is the
    // "process warranty" enforced in code — there is deliberately no override
    // path. The reviewer must resolve (remediate/waive) or downgrade the
    // defect first, which is itself an audited action.
    const projectDefects = await db
      .select()
      .from(defects)
      .where(eq(defects.projectId, report.projectId));
    const blocking = blockingSignOffDefects(
      projectDefects.map((d) => ({ ...d, severity: d.severity as Severity })),
    );
    if (blocking.length > 0) {
      await writeAudit({
        user,
        projectId: report.projectId,
        eventType: "report.sign_off_denied",
        objectType: "report",
        objectId: report.id,
        details: `Sign-off blocked: ${blocking.length} open fatal/likely-fatal defect(s) must be resolved first.`,
      });
      res.status(409).json({
        error:
          "Report cannot be signed off while fatal or likely-fatal defects remain open. Resolve or downgrade them first.",
        blockingDefects: blocking.map((d) => ({
          id: d.id,
          severity: d.severity,
          description: d.description,
        })),
      });
      return;
    }

    const reviewerName = user?.name || user?.email || "Unknown reviewer";
    const [updated] = await db
      .update(reports)
      .set({
        status: "signed_off",
        reviewerName,
        attestation: parsed.data.attestation,
        reviewerId: user?.id ?? null,
        signedOffAt: new Date(),
      })
      .where(eq(reports.id, report.id))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    await db.update(projects).set({ status: "signed_off" }).where(eq(projects.id, updated.projectId));
    await writeAudit({
      user,
      projectId: updated.projectId,
      eventType: "report.signed_off",
      objectType: "report",
      objectId: updated.id,
      details: `by ${reviewerName}`,
    });
    res.json(serializeReport(updated, user?.name));
  },
);

router.get("/reports/:id/download", requireMember, async (req: Request, res: Response) => {
  const user = getLocalUser(req);
  const [report] = await db.select().from(reports).where(eq(reports.id, String(req.params.id)));
  if (!report || !report.docxPath) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (report.status !== "signed_off") {
    await writeAudit({
      user,
      projectId: report.projectId,
      eventType: "report.export_denied",
      objectType: "report",
      objectId: report.id,
      details: `Export blocked: report is "${report.status}", not signed off.`,
    });
    res.status(403).json({ error: "Report must be signed off before it can be exported" });
    return;
  }
  try {
    const file = await objectStorage.getObjectEntityFile(report.docxPath);
    const [buffer] = await file.download();
    res.setHeader("Content-Type", DOCX_MIME);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="bid-autopsy-report-v${report.version}.docx"`,
    );
    await writeAudit({
      user,
      projectId: report.projectId,
      eventType: "report.exported",
      objectType: "report",
      objectId: report.id,
      details: `Exported signed-off report v${report.version}.`,
    });
    res.send(buffer);
  } catch (error) {
    req.log.error({ err: error }, "report download failed");
    res.status(404).json({ error: "Report file not found" });
  }
});

export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    let s = v == null ? "" : String(v);
    // CSV formula-injection defense: requirement text / evidence excerpts are
    // verbatim untrusted tender content. A leading =, +, -, @, tab or CR makes
    // a spreadsheet treat the cell as a formula on open (e.g. =IMPORTXML(...)),
    // which for confidential exports is a data-exfiltration vector. Prefix a
    // single quote so the cell is always treated as literal text.
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(","), ...rows.map((r) => headers.map((h) => escape(r[h])).join(","))].join("\n");
}

export type ReviewState = "confirmed" | "suggested";

/**
 * Derive the export `review_state` for a register row, so recipients can tell
 * reviewer-confirmed findings from raw AI suggestions. This is the single
 * source of truth for the CSV column and must stay consistent with how the
 * signed DOCX report (`lib/docx.ts`) segregates confirmed vs suggested items:
 *   - a requirement is confirmed unless its `reviewStatus` is still "suggested"
 *   - evidence and defects carry an explicit `suggested` boolean
 */
export function requirementReviewState(row: { reviewStatus: string }): ReviewState {
  return row.reviewStatus === "suggested" ? "suggested" : "confirmed";
}

export function suggestedFlagReviewState(row: { suggested: boolean }): ReviewState {
  return row.suggested ? "suggested" : "confirmed";
}

/** Prepend a `review_state` column to each row for CSV export. */
export function withReviewState<T extends Record<string, unknown>>(
  rows: T[],
  reviewState: (row: T) => ReviewState,
): (T & { review_state: ReviewState })[] {
  return rows.map((row) => ({ review_state: reviewState(row), ...row }));
}

router.get(
  "/projects/:id/export",
  requireRoles("admin"),
  async (req: Request, res: Response) => {
    const projectId = String(req.params.id);
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
    if (!project) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const reqs = await db.select().from(requirements).where(eq(requirements.projectId, projectId));
    const ev = await db.select().from(evidenceItems).where(eq(evidenceItems.projectId, projectId));
    const defs = await db.select().from(defects).where(eq(defects.projectId, projectId));
    const boqs = await db.select().from(boqChecks).where(eq(boqChecks.projectId, projectId));
    const audits = await db.select().from(auditEvents).where(eq(auditEvents.projectId, projectId));
    // Document manifest for the export: intake metadata + SHA-256 so the
    // recipient can independently verify file integrity. Deliberately excludes
    // contentText (bulky, and the files themselves are the source of truth).
    const docManifest = await db
      .select({
        id: documents.id,
        type: documents.type,
        filename: documents.filename,
        objectPath: documents.objectPath,
        contentType: documents.contentType,
        size: documents.size,
        sha256: documents.sha256,
        source: documents.source,
        dateReceived: documents.dateReceived,
        redactionStatus: documents.redactionStatus,
        extractionStatus: documents.extractionStatus,
        createdAt: documents.createdAt,
      })
      .from(documents)
      .where(eq(documents.projectId, projectId));
    const signedReports = await db
      .select()
      .from(reports)
      .where(eq(reports.projectId, projectId))
      .orderBy(desc(reports.version));

    // Fetch the signed DOCX *before* committing to the response stream. This is
    // the only fallible, mid-stream I/O in the export, and once we've flushed
    // 200 + zip headers we can no longer turn a failure into a real error
    // status. Downloading it up front means a fatal fetch failure produces a
    // clean non-200, and the archive is only ever streamed from in-memory data.
    // A missing DOCX stays non-fatal (the export is still useful without it).
    const latestSigned = signedReports.find((r) => r.status === "signed_off" && r.docxPath);
    let reportDocx: { name: string; buffer: Buffer } | null = null;
    if (latestSigned?.docxPath) {
      try {
        const file = await objectStorage.getObjectEntityFile(latestSigned.docxPath);
        const [buffer] = await file.download();
        reportDocx = { name: `bid-autopsy-report-v${latestSigned.version}.docx`, buffer };
      } catch (error) {
        req.log.warn({ err: error }, "could not attach report to export");
      }
    }

    // Flag review state so recipients can tell reviewer-confirmed findings from
    // raw AI suggestions, mirroring how the signed DOCX report segregates them.
    const reqsCsv = withReviewState(reqs, requirementReviewState);
    const evCsv = withReviewState(ev, suggestedFlagReviewState);
    const defsCsv = withReviewState(defs, suggestedFlagReviewState);

    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="project-export-${projectId}.zip"`,
    );

    const archive = new ZipArchive({ zlib: { level: 9 } });
    archive.on("error", (err: ArchiverError) => {
      req.log.error({ err }, "export archive error");
      // Headers are already flushed by the time we're streaming, so the status
      // code can no longer be changed to signal failure. Ending the response
      // cleanly would hand the client a 200 with a truncated, corrupt ZIP that
      // looks successful. Destroy the socket instead so the client sees an
      // aborted/incomplete download and can detect the truncation.
      res.destroy(err);
    });
    archive.pipe(res);

    archive.append(JSON.stringify(project, null, 2), { name: "project.json" });
    archive.append(toCsv(reqsCsv), { name: "requirements.csv" });
    archive.append(toCsv(evCsv), { name: "evidence.csv" });
    archive.append(toCsv(defsCsv), { name: "defects.csv" });
    archive.append(toCsv(boqs), { name: "boq_checks.csv" });
    archive.append(toCsv(audits), { name: "audit_events.csv" });
    archive.append(toCsv(docManifest), { name: "documents_manifest.csv" });
    // Exportable Gate 0 Technical Scorecard (FR-EXT-04): the engine-vs-human
    // diff and mandatory recall, recomputed from the stored records at export
    // time so the figures are independently reproducible.
    archive.append(
      JSON.stringify(
        computeScorecard(
          reqs.map((r) => ({
            sourceDocId: r.sourceDocId,
            origin: r.origin,
            isMandatory: r.isMandatory,
            reviewStatus: r.reviewStatus,
          })),
        ),
        null,
        2,
      ),
      { name: "scorecard.json" },
    );

    if (reportDocx) {
      archive.append(reportDocx.buffer, { name: reportDocx.name });
    }

    await writeAudit({
      user: getLocalUser(req),
      projectId,
      eventType: "project.exported",
      objectType: "project",
      objectId: projectId,
    });
    if (project.status === "signed_off") {
      await db.update(projects).set({ status: "exported" }).where(eq(projects.id, projectId));
    }

    await archive.finalize();
  },
);

export default router;
