import { Router, type IRouter, type Request, type Response } from "express";
import { createRequire } from "node:module";
import type { Archiver, ArchiverError, ArchiverOptions } from "archiver";
import { and, eq, desc, sql } from "drizzle-orm";
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
  legacyAuditEvents,
  documents,
  drafts,
  draftVersions,
  draftClaims,
  claimEvidenceLinks,
  redTeamRuns,
  redTeamFindings,
  packages,
  packageVersions,
} from "@workspace/db";
import { SignOffReportBody } from "@workspace/api-zod";
import { getLocalUser } from "../middlewares/auth";
import {
  getOrganisationId,
  getAccessContext,
  requirePermissionOrLegacy,
} from "../middlewares/tenancy";
import { serializeReport } from "../lib/serializers";
import { writeAudit, writeAuditTx } from "../lib/audit";
import { buildReportDocx, DOCX_MIME, type ReportData } from "../lib/docx";
import { buildReportPdf, PDF_MIME } from "../lib/pdf";
import {
  ENGINE_VERSION,
  PROMPT_PACK_VERSION,
  MODEL_ID,
  TAXONOMY_VERSION,
} from "../lib/provenance";
import { computeRisk, type Severity } from "../lib/deterministic";
import { evaluateSubmissionReadiness } from "../lib/submissionReadiness";
import { getActiveConfig } from "../lib/appConfig";
import { computeScorecard } from "../lib/scorecard";
import { ObjectStorageService } from "../lib/objectStorage";
import { lockStagedUploadObject } from "../lib/stagedUploadLock";
import {
  canGenerateReportForProjectStatus,
  isLatestReportVersion,
  packageExportDenial,
  reportExportDenial,
  reportSignerDenial,
} from "../lib/reportPolicy";
import {
  buildCanonicalProjectExportManifest,
  includeAuditEventInProjectExport,
  persistCanonicalProjectExportPackage,
  PROJECT_EXPORT_AUDIT_POLICY,
  PROJECT_EXPORT_PACKAGE_LIST_LIMIT,
  PROJECT_EXPORT_PACKAGE_TYPE,
  soleCanonicalProjectExportPackageId,
  type ProjectExportArchiveEntry,
} from "../lib/projectExportPackage";

const router: IRouter = Router();
const objectStorage = new ObjectStorageService();
import {
  SHA256_HEX_PATTERN as SHA256_PATTERN,
  UUID_V1_5_PATTERN as UUID_PATTERN,
} from "../lib/identifierPatterns";

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

  const reqs = await db
    .select()
    .from(requirements)
    .where(eq(requirements.projectId, projectId));
  const ev = await db
    .select()
    .from(evidenceItems)
    .where(eq(evidenceItems.projectId, projectId));
  const defs = await db
    .select()
    .from(defects)
    .where(eq(defects.projectId, projectId));
  const boqs = await db
    .select()
    .from(boqChecks)
    .where(eq(boqChecks.projectId, projectId));

  const config = await getActiveConfig();
  const risk = computeRisk(
    {
      defects: defs.map((d) => ({
        severity: d.severity as Severity,
        status: d.status,
      })),
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
    },
    config.risk,
  );

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
    template: config.template,
    version: 1,
    generatedByName: null,
  };
}

async function latestReportForProject(projectId: string) {
  const [latest] = await db
    .select()
    .from(reports)
    .where(eq(reports.projectId, projectId))
    .orderBy(desc(reports.version))
    .limit(1);
  return latest;
}

async function gatherSupplementalReleaseGates(projectId: string): Promise<{
  unsupportedClaimIds: string[];
  requiresRedTeam: true;
  redTeamApproved: boolean;
}> {
  const claimRows = await db
    .select({
      id: draftClaims.id,
      claimKind: draftClaims.claimKind,
      groundingStatus: draftClaims.groundingStatus,
      evidenceLinkId: claimEvidenceLinks.id,
    })
    .from(draftClaims)
    .innerJoin(draftVersions, eq(draftClaims.draftVersionId, draftVersions.id))
    .innerJoin(drafts, eq(draftVersions.draftId, drafts.id))
    .leftJoin(
      claimEvidenceLinks,
      eq(claimEvidenceLinks.draftClaimId, draftClaims.id),
    )
    .where(eq(drafts.projectId, projectId));
  const evidenceLinkedClaimIds = new Set(
    claimRows.filter((row) => row.evidenceLinkId).map((row) => row.id),
  );
  const unsupportedClaimIds = [
    ...new Set(
      claimRows
        .filter(
          (row) =>
            row.claimKind.toLowerCase().includes("fact") &&
            (row.groundingStatus !== "approved" ||
              !evidenceLinkedClaimIds.has(row.id)),
        )
        .map((row) => row.id),
    ),
  ];

  const [latestRedTeamRun] = await db
    .select()
    .from(redTeamRuns)
    .where(eq(redTeamRuns.projectId, projectId))
    .orderBy(desc(redTeamRuns.createdAt))
    .limit(1);
  let redTeamApproved = false;
  if (
    latestRedTeamRun?.status === "approved" &&
    latestRedTeamRun.approvedByUserId &&
    latestRedTeamRun.approvedAt &&
    latestRedTeamRun.approvedByUserId !== latestRedTeamRun.initiatedByUserId
  ) {
    const findings = await db
      .select({ status: redTeamFindings.status })
      .from(redTeamFindings)
      .where(eq(redTeamFindings.redTeamRunId, latestRedTeamRun.id));
    redTeamApproved = findings.every(
      (finding) => finding.status === "resolved",
    );
  }
  return { unsupportedClaimIds, requiresRedTeam: true, redTeamApproved };
}

router.get(
  "/projects/:id/reports",
  requirePermissionOrLegacy("report:read"),
  async (req: Request, res: Response) => {
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
  },
);

router.post(
  "/projects/:id/generate-report",
  requirePermissionOrLegacy("report:generate"),
  async (req: Request, res: Response) => {
    const projectId = String(req.params.id);
    // Serialise project-local max(version)+1 allocation inside the request's
    // tenant transaction. The unique index is the final concurrency backstop.
    await db.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${projectId}, 0))`,
    );
    const data = await gatherReportData(projectId);
    if (!data) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (!canGenerateReportForProjectStatus(data.project.status)) {
      res.status(409).json({
        error:
          "Report generation is only available during review, defects, or reporting.",
      });
      return;
    }
    const user = getLocalUser(req);
    const organisationId = getOrganisationId(req);
    const [{ maxVersion }] = await db
      .select({
        maxVersion: sql<number>`coalesce(max(${reports.version}), 0)::int`,
      })
      .from(reports)
      .where(eq(reports.projectId, projectId));
    const version = Number(maxVersion) + 1;
    data.version = version;
    data.generatedByName = user?.name ?? null;

    const uploadRendered = async (
      buffer: Buffer,
      mime: string,
    ): Promise<string> => {
      const uploadURL =
        await objectStorage.getObjectEntityUploadURL(organisationId);
      const putRes = await fetch(uploadURL, {
        method: "PUT",
        headers: { "Content-Type": mime },
        body: buffer,
      });
      if (!putRes.ok) throw new Error(`Upload failed: ${putRes.status}`);
      return objectStorage.normalizeObjectEntityPath(uploadURL);
    };

    let docxPath: string | null = null;
    let pdfPath: string | null = null;
    try {
      const [docxBuffer, pdfBuffer] = await Promise.all([
        buildReportDocx(data),
        buildReportPdf(data),
      ]);
      // Render both formats from the same report model so the DOCX and PDF are
      // content-identical; a failure in either aborts the whole generation.
      [docxPath, pdfPath] = await Promise.all([
        uploadRendered(docxBuffer, DOCX_MIME),
        uploadRendered(pdfBuffer, PDF_MIME),
      ]);
    } catch (error) {
      req.log.error({ err: error }, "report generation failed");
      res.status(500).json({ error: "Report generation failed" });
      return;
    }

    // The renderer currently persists into the tenant upload namespace. Hold
    // the same path locks as authenticated discard until both report
    // references commit, so cleanup cannot delete between upload and insert.
    for (const path of [docxPath, pdfPath]
      .filter((value): value is string => Boolean(value))
      .sort()) {
      await lockStagedUploadObject(path);
    }

    const created = await db.transaction(
      async (tx) => {
        const [report] = await tx
          .insert(reports)
          .values({
            organisationId,
            projectId,
            version,
            status: "draft",
            docxPath,
            pdfPath,
            engineVersion: ENGINE_VERSION,
            promptPackVersion: PROMPT_PACK_VERSION,
            modelId: MODEL_ID,
            taxonomyVersion: TAXONOMY_VERSION,
            generatedBy: user?.id ?? null,
          })
          .returning();

        if (
          data.project.status === "defects" ||
          data.project.status === "review"
        ) {
          await tx
            .update(projects)
            .set({
              status: "reporting",
              version: sql`${projects.version} + 1`,
              updatedAt: new Date(),
            })
            .where(eq(projects.id, projectId));
        }
        await writeAuditTx(tx, {
          user,
          organisationId,
          projectId,
          eventType: "report.generated",
          objectType: "report",
          objectId: report.id,
          details: `v${version}`,
        });
        return report;
      },
      { isolationLevel: "read committed" },
    );
    res.status(201).json(serializeReport(created, user?.name));
  },
);

router.post(
  "/reports/:id/sign-off",
  requirePermissionOrLegacy("report:sign_off"),
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
    if (report.status !== "draft") {
      res.status(409).json({
        error: `Only a draft report can be signed off (current: ${report.status}).`,
      });
      return;
    }
    const latestReport = await latestReportForProject(report.projectId);
    if (!isLatestReportVersion(report, latestReport)) {
      await writeAudit({
        user,
        organisationId: getOrganisationId(req),
        projectId: report.projectId,
        eventType: "report.sign_off_denied",
        objectType: "report",
        objectId: report.id,
        details:
          "A newer report version exists; stale versions cannot be signed off.",
      });
      res
        .status(409)
        .json({ error: "Only the latest report version can be signed off." });
      return;
    }

    const [governance] = await db
      .select({ project: projects, ndaStatus: clients.ndaStatus })
      .from(projects)
      .leftJoin(clients, eq(projects.clientId, clients.id))
      .where(eq(projects.id, report.projectId));
    if (!governance) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    const signerDenial = reportSignerDenial({
      assignedReviewerId: governance.project.reviewerId,
      signerId: user?.id,
      accessSource: getAccessContext(req)?.source,
      membershipId: getAccessContext(req)?.membershipId,
    });
    if (signerDenial) {
      await writeAudit({
        user,
        organisationId: getOrganisationId(req),
        projectId: report.projectId,
        eventType: "report.sign_off_denied",
        objectType: "report",
        objectId: report.id,
        details: `Signer authority denied: ${signerDenial}.`,
      });
      res.status(403).json({
        error:
          "Only the assigned reviewer acting through an active direct grant may sign off.",
      });
      return;
    }
    if (governance.project.status !== "reporting") {
      await writeAudit({
        user,
        organisationId: getOrganisationId(req),
        projectId: report.projectId,
        eventType: "report.sign_off_denied",
        objectType: "report",
        objectId: report.id,
        details: `Project is ${governance.project.status}; expected reporting.`,
      });
      res
        .status(409)
        .json({ error: "Project must be in reporting state before sign-off." });
      return;
    }

    const [
      projectDocuments,
      projectRequirements,
      projectEvidence,
      projectDefects,
      projectBoqChecks,
      supplementalGates,
    ] = await Promise.all([
      db
        .select()
        .from(documents)
        .where(eq(documents.projectId, report.projectId)),
      db
        .select()
        .from(requirements)
        .where(eq(requirements.projectId, report.projectId)),
      db
        .select()
        .from(evidenceItems)
        .where(eq(evidenceItems.projectId, report.projectId)),
      db.select().from(defects).where(eq(defects.projectId, report.projectId)),
      db
        .select()
        .from(boqChecks)
        .where(eq(boqChecks.projectId, report.projectId)),
      gatherSupplementalReleaseGates(report.projectId),
    ]);

    const readiness = evaluateSubmissionReadiness({
      project: {
        ndaStatus: governance.ndaStatus,
        reviewerId: governance.project.reviewerId,
        conflictStatus: governance.project.conflictStatus,
        paymentStatus: governance.project.paymentStatus,
        paymentConfirmedByFounder: governance.project.paymentConfirmedByFounder,
        paymentConfirmedByAdvisor: governance.project.paymentConfirmedByAdvisor,
        paymentFounderConfirmedBy: governance.project.paymentFounderConfirmedBy,
        paymentAdvisorConfirmedBy: governance.project.paymentAdvisorConfirmedBy,
        responsivenessSuggested: governance.project.responsivenessSuggested,
      },
      report: {
        generatedBy: report.generatedBy,
        engineVersion: report.engineVersion,
        promptPackVersion: report.promptPackVersion,
        modelId: report.modelId,
        taxonomyVersion: report.taxonomyVersion,
      },
      signerId: user?.id,
      documents: projectDocuments,
      requirements: projectRequirements,
      evidence: projectEvidence,
      defects: projectDefects,
      boqChecks: projectBoqChecks,
      ...supplementalGates,
      requireIndependentSignOff: true,
    });
    if (!readiness.ready) {
      await writeAudit({
        user,
        projectId: report.projectId,
        eventType: "report.sign_off_denied",
        objectType: "report",
        objectId: report.id,
        details: JSON.stringify({
          blockerCodes: readiness.blockers.map((blocker) => blocker.code),
        }),
      });
      res.status(409).json({
        error:
          "Report cannot be signed off until every submission-readiness invariant passes.",
        blockers: readiness.blockers,
      });
      return;
    }

    const reviewerName = user?.name || user?.email || "Unknown reviewer";
    const updated = await db.transaction(
      async (tx) => {
        const clock = await tx.execute(
          sql`SELECT pg_catalog.clock_timestamp() AS now`,
        );
        const signedOffAt = new Date(
          String((clock.rows[0] as { now?: unknown } | undefined)?.now ?? ""),
        );
        if (!Number.isFinite(signedOffAt.valueOf())) {
          throw new Error("Database clock is unavailable during sign-off");
        }
        const [signed] = await tx
          .update(reports)
          .set({
            status: "signed_off",
            reviewerName,
            attestation: parsed.data.attestation,
            reviewerId: user?.id ?? null,
            signedOffAt,
            optimisticLockVersion: sql`${reports.optimisticLockVersion} + 1`,
            updatedAt: signedOffAt,
          })
          .where(and(eq(reports.id, report.id), eq(reports.status, "draft")))
          .returning();
        if (!signed) return undefined;

        const [signedProject] = await tx
          .update(projects)
          .set({
            status: "signed_off",
            concludedAt: signed.signedOffAt,
            version: sql`${projects.version} + 1`,
            updatedAt: signedOffAt,
          })
          .where(
            and(
              eq(projects.id, signed.projectId),
              eq(projects.status, "reporting"),
            ),
          )
          .returning({ id: projects.id });
        if (!signedProject) {
          throw new Error("Project state changed during report sign-off");
        }
        await writeAuditTx(tx, {
          user,
          projectId: signed.projectId,
          eventType: "report.signed_off",
          objectType: "report",
          objectId: signed.id,
          details: `by ${reviewerName}`,
          createdAt: signedOffAt,
        });
        return signed;
      },
      { isolationLevel: "read committed" },
    );
    if (!updated) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(serializeReport(updated, user?.name));
  },
);

router.get(
  "/reports/:id/download",
  requirePermissionOrLegacy("report:export"),
  async (req: Request, res: Response) => {
    const user = getLocalUser(req);
    const [report] = await db
      .select()
      .from(reports)
      .where(eq(reports.id, String(req.params.id)));
    if (!report || !report.docxPath) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const exportDenial = reportExportDenial(
      report,
      await latestReportForProject(report.projectId),
    );
    if (exportDenial) {
      await writeAudit({
        user,
        organisationId: getOrganisationId(req),
        projectId: report.projectId,
        eventType: "report.export_denied",
        objectType: "report",
        objectId: report.id,
        details: `Export blocked: ${exportDenial}.`,
      });
      res.status(exportDenial === "stale_version" ? 409 : 403).json({
        error:
          exportDenial === "stale_version"
            ? "Only the latest signed report version can be exported"
            : "Report must be signed off before it can be exported",
      });
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
  },
);

router.get(
  "/reports/:id/download-pdf",
  requirePermissionOrLegacy("report:export"),
  async (req: Request, res: Response) => {
    const user = getLocalUser(req);
    const [report] = await db
      .select()
      .from(reports)
      .where(eq(reports.id, String(req.params.id)));
    if (!report || !report.pdfPath) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const exportDenial = reportExportDenial(
      report,
      await latestReportForProject(report.projectId),
    );
    if (exportDenial) {
      await writeAudit({
        user,
        organisationId: getOrganisationId(req),
        projectId: report.projectId,
        eventType: "report.export_denied",
        objectType: "report",
        objectId: report.id,
        details: `PDF export blocked: ${exportDenial}.`,
      });
      res.status(exportDenial === "stale_version" ? 409 : 403).json({
        error:
          exportDenial === "stale_version"
            ? "Only the latest signed report version can be exported"
            : "Report must be signed off before it can be exported",
      });
      return;
    }
    try {
      const file = await objectStorage.getObjectEntityFile(report.pdfPath);
      const [buffer] = await file.download();
      res.setHeader("Content-Type", PDF_MIME);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="bid-autopsy-report-v${report.version}.pdf"`,
      );
      await writeAudit({
        user,
        projectId: report.projectId,
        eventType: "report.exported",
        objectType: "report",
        objectId: report.id,
        details: `Exported signed-off report v${report.version} (PDF).`,
      });
      res.send(buffer);
    } catch (error) {
      req.log.error({ err: error }, "report pdf download failed");
      res.status(404).json({ error: "Report file not found" });
    }
  },
);

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
  return [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => escape(r[h])).join(",")),
  ].join("\n");
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
export function requirementReviewState(row: {
  reviewStatus: string;
}): ReviewState {
  return row.reviewStatus === "suggested" ? "suggested" : "confirmed";
}

export function suggestedFlagReviewState(row: {
  suggested: boolean;
}): ReviewState {
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
  "/projects/:id/package-versions",
  requirePermissionOrLegacy("package:read"),
  async (req: Request, res: Response) => {
    const projectId = String(req.params.id);
    const organisationId = getOrganisationId(req);
    if (!organisationId || !UUID_PATTERN.test(projectId)) {
      res.status(403).json({ error: "Organisation access denied" });
      return;
    }
    await db.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${projectId}, 0))`,
    );
    const canonicalPackages = await db
      .select({ id: packages.id })
      .from(packages)
      .where(
        and(
          eq(packages.organisationId, organisationId),
          eq(packages.projectId, projectId),
          eq(packages.packageType, PROJECT_EXPORT_PACKAGE_TYPE),
        ),
      )
      .limit(2)
      .for("share");
    const canonicalPackageId =
      soleCanonicalProjectExportPackageId(canonicalPackages);
    const rows = canonicalPackageId
      ? await db
          .select({
            packageId: packages.id,
            packageVersionId: packageVersions.id,
            packageType: packages.packageType,
            versionNumber: packageVersions.versionNumber,
            manifestSha256: packageVersions.manifestHash,
            renderQaStatus: packageVersions.renderQaStatus,
            createdAt: packageVersions.createdAt,
          })
          .from(packages)
          .innerJoin(
            packageVersions,
            and(
              eq(packageVersions.organisationId, packages.organisationId),
              eq(packageVersions.packageId, packages.id),
              eq(packageVersions.versionNumber, packages.currentVersionNumber),
            ),
          )
          .where(
            and(
              eq(packages.id, canonicalPackageId),
              eq(packages.organisationId, organisationId),
              eq(packages.projectId, projectId),
              eq(packages.packageType, PROJECT_EXPORT_PACKAGE_TYPE),
            ),
          )
          .orderBy(desc(packageVersions.createdAt), desc(packageVersions.id))
          .limit(PROJECT_EXPORT_PACKAGE_LIST_LIMIT + 1)
      : [];
    if (canonicalPackageId && rows.length !== 1) {
      throw new Error("Canonical package current version failed validation");
    }
    const truncated = rows.length > PROJECT_EXPORT_PACKAGE_LIST_LIMIT;
    const items = rows
      .slice(0, PROJECT_EXPORT_PACKAGE_LIST_LIMIT)
      .map((row) => {
        if (
          row.packageType !== PROJECT_EXPORT_PACKAGE_TYPE ||
          !["pending", "passed", "failed"].includes(row.renderQaStatus) ||
          !UUID_PATTERN.test(row.packageId) ||
          !UUID_PATTERN.test(row.packageVersionId) ||
          !Number.isSafeInteger(row.versionNumber) ||
          row.versionNumber < 1 ||
          !SHA256_PATTERN.test(row.manifestSha256) ||
          !(row.createdAt instanceof Date) ||
          Number.isNaN(row.createdAt.getTime())
        ) {
          throw new Error("Canonical package version failed validation");
        }
        return {
          packageId: row.packageId,
          packageVersionId: row.packageVersionId,
          packageType: PROJECT_EXPORT_PACKAGE_TYPE,
          versionNumber: row.versionNumber,
          manifestSha256: row.manifestSha256,
          renderQaStatus: row.renderQaStatus as "pending" | "passed" | "failed",
          createdAt: row.createdAt.toISOString(),
        };
      });
    await writeAudit({
      user: getLocalUser(req),
      organisationId,
      projectId,
      eventType: "package.versions_viewed",
      objectType: "project",
      objectId: projectId,
      details: JSON.stringify({ count: items.length, truncated }),
    });
    res.setHeader("Cache-Control", "private, no-store");
    res.json({
      items,
      limit: PROJECT_EXPORT_PACKAGE_LIST_LIMIT,
      truncated,
    });
  },
);

router.get(
  "/projects/:id/export",
  requirePermissionOrLegacy("report:export"),
  async (req: Request, res: Response) => {
    const projectId = String(req.params.id);
    const [governance] = await db
      .select({ project: projects, ndaStatus: clients.ndaStatus })
      .from(projects)
      .leftJoin(clients, eq(projects.clientId, clients.id))
      .where(eq(projects.id, projectId));
    if (!governance) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const project = governance.project;
    const projectReports = await db
      .select()
      .from(reports)
      .where(eq(reports.projectId, projectId))
      .orderBy(desc(reports.version));
    const latestReport = projectReports[0];
    const packageDenial = packageExportDenial({
      projectStatus: project.status,
      physicalArchiveInstruction: project.physicalArchiveInstruction,
      latestReport,
    });
    if (packageDenial) {
      await writeAudit({
        user: getLocalUser(req),
        organisationId: getOrganisationId(req),
        projectId,
        eventType: "project.export_denied",
        objectType: "project",
        objectId: projectId,
        details: `Package export blocked: ${packageDenial}.`,
      });
      res.status(409).json({
        error:
          "Package export requires the latest signed report and archive handling instruction.",
      });
      return;
    }
    const [
      reqs,
      ev,
      defs,
      boqs,
      activeAudits,
      archivedAudits,
      projectDocuments,
      supplementalGates,
    ] = await Promise.all([
      db
        .select()
        .from(requirements)
        .where(eq(requirements.projectId, projectId)),
      db
        .select()
        .from(evidenceItems)
        .where(eq(evidenceItems.projectId, projectId)),
      db.select().from(defects).where(eq(defects.projectId, projectId)),
      db.select().from(boqChecks).where(eq(boqChecks.projectId, projectId)),
      db.select().from(auditEvents).where(eq(auditEvents.projectId, projectId)),
      db
        .select()
        .from(legacyAuditEvents)
        .where(eq(legacyAuditEvents.projectId, projectId)),
      db.select().from(documents).where(eq(documents.projectId, projectId)),
      gatherSupplementalReleaseGates(projectId),
    ]);
    const readiness = evaluateSubmissionReadiness({
      project: {
        ndaStatus: governance.ndaStatus,
        reviewerId: project.reviewerId,
        conflictStatus: project.conflictStatus,
        paymentStatus: project.paymentStatus,
        paymentConfirmedByFounder: project.paymentConfirmedByFounder,
        paymentConfirmedByAdvisor: project.paymentConfirmedByAdvisor,
        paymentFounderConfirmedBy: project.paymentFounderConfirmedBy,
        paymentAdvisorConfirmedBy: project.paymentAdvisorConfirmedBy,
        responsivenessSuggested: project.responsivenessSuggested,
      },
      report: {
        generatedBy: latestReport!.generatedBy,
        engineVersion: latestReport!.engineVersion,
        promptPackVersion: latestReport!.promptPackVersion,
        modelId: latestReport!.modelId,
        taxonomyVersion: latestReport!.taxonomyVersion,
      },
      signerId: latestReport!.reviewerId,
      documents: projectDocuments,
      requirements: reqs,
      evidence: ev,
      defects: defs,
      boqChecks: boqs,
      ...supplementalGates,
      requireIndependentSignOff: true,
    });
    if (!readiness.ready) {
      await writeAudit({
        user: getLocalUser(req),
        organisationId: getOrganisationId(req),
        projectId,
        eventType: "project.export_denied",
        objectType: "project",
        objectId: projectId,
        details: JSON.stringify({
          blockerCodes: readiness.blockers.map((blocker) => blocker.code),
        }),
      });
      res.status(409).json({
        error: "Package export readiness changed or is incomplete.",
        blockers: readiness.blockers,
      });
      return;
    }
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
    // Fetch the signed DOCX *before* committing to the response stream. This is
    // the only fallible, mid-stream I/O in the export, and once we've flushed
    // 200 + zip headers we can no longer turn a failure into a real error
    // status. Downloading it up front means a fatal fetch failure produces a
    // clean non-200, and the archive is only ever streamed from in-memory data.
    // The package is not valid without the governed report artefact.
    let reportDocx: { name: string; buffer: Buffer };
    try {
      const file = await objectStorage.getObjectEntityFile(
        latestReport!.docxPath!,
      );
      const [buffer] = await file.download();
      reportDocx = {
        name: `bid-autopsy-report-v${latestReport!.version}.docx`,
        buffer,
      };
    } catch (error) {
      req.log.error({ err: error }, "could not attach signed report to export");
      await writeAudit({
        user: getLocalUser(req),
        organisationId: getOrganisationId(req),
        projectId,
        eventType: "project.export_denied",
        objectType: "project",
        objectId: projectId,
        details: "Latest signed report artefact could not be loaded.",
      });
      res
        .status(502)
        .json({ error: "Latest signed report artefact is unavailable." });
      return;
    }

    // Flag review state so recipients can tell reviewer-confirmed findings from
    // raw AI suggestions, mirroring how the signed DOCX report segregates them.
    const byId = <T extends { id: string }>(rows: readonly T[]): T[] =>
      [...rows].sort((left, right) => left.id.localeCompare(right.id));
    const orderedRequirements = byId(reqs);
    const reqsCsv = withReviewState(
      orderedRequirements,
      requirementReviewState,
    );
    const evCsv = withReviewState(byId(ev), suggestedFlagReviewState);
    const defsCsv = withReviewState(byId(defs), suggestedFlagReviewState);
    const exportTransitionAt =
      project.status === "signed_off" ? new Date() : project.updatedAt;
    const canonicalProject =
      project.status === "signed_off"
        ? {
            ...project,
            status: "exported" as const,
            version: project.version + 1,
            updatedAt: exportTransitionAt,
          }
        : project;
    const auditRows = [
      ...[...activeAudits]
        .filter(includeAuditEventInProjectExport)
        .sort((left, right) => left.seq - right.seq)
        .map((event) => ({
          ...event,
          auditSource: "active_v2",
          integrityStatus: "active_v2_record",
        })),
      ...byId(archivedAudits).map((event) => ({
        ...event,
        auditSource: "legacy_v1_archive",
      })),
    ];
    const scorecard = computeScorecard(
      orderedRequirements.map((requirement) => ({
        sourceDocId: requirement.sourceDocId,
        origin: requirement.origin,
        isMandatory: requirement.isMandatory,
        reviewStatus: requirement.reviewStatus,
      })),
    );
    const aggregateSource = {
      sourceObjectId: projectId,
      sourceVersion: canonicalProject.version,
    } as const;
    const archiveEntries: ProjectExportArchiveEntry[] = [
      {
        itemType: "project_snapshot",
        ...aggregateSource,
        filename: "project.json",
        bytes: Buffer.from(JSON.stringify(canonicalProject, null, 2), "utf8"),
      },
      {
        itemType: "requirement_register",
        ...aggregateSource,
        filename: "requirements.csv",
        bytes: Buffer.from(toCsv(reqsCsv), "utf8"),
      },
      {
        itemType: "evidence_register",
        ...aggregateSource,
        filename: "evidence.csv",
        bytes: Buffer.from(toCsv(evCsv), "utf8"),
      },
      {
        itemType: "defect_register",
        ...aggregateSource,
        filename: "defects.csv",
        bytes: Buffer.from(toCsv(defsCsv), "utf8"),
      },
      {
        itemType: "boq_register",
        ...aggregateSource,
        filename: "boq_checks.csv",
        bytes: Buffer.from(toCsv(byId(boqs)), "utf8"),
      },
      {
        itemType: "audit_register",
        ...aggregateSource,
        filename: "audit_events.csv",
        bytes: Buffer.from(toCsv(auditRows), "utf8"),
      },
      {
        itemType: "audit_export_policy",
        ...aggregateSource,
        filename: "audit_export_policy.json",
        bytes: Buffer.from(
          JSON.stringify(PROJECT_EXPORT_AUDIT_POLICY, null, 2),
          "utf8",
        ),
      },
      {
        itemType: "document_manifest",
        ...aggregateSource,
        filename: "documents_manifest.csv",
        bytes: Buffer.from(toCsv(byId(docManifest)), "utf8"),
      },
      {
        itemType: "technical_scorecard",
        ...aggregateSource,
        filename: "scorecard.json",
        bytes: Buffer.from(JSON.stringify(scorecard, null, 2), "utf8"),
      },
      {
        itemType: "signed_report",
        sourceObjectId: latestReport!.id,
        sourceVersion: latestReport!.version,
        filename: reportDocx.name,
        bytes: reportDocx.buffer,
      },
    ];
    const packageManifest = buildCanonicalProjectExportManifest(
      {
        organisationId: getOrganisationId(req)!,
        projectId,
        projectVersion: canonicalProject.version,
        reportId: latestReport!.id,
        reportVersion: latestReport!.version,
      },
      archiveEntries,
    );

    await db.transaction(
      async (tx) => {
        const packageVersion = await persistCanonicalProjectExportPackage(tx, {
          identity: {
            organisationId: getOrganisationId(req)!,
            projectId,
            projectVersion: canonicalProject.version,
            reportId: latestReport!.id,
            reportVersion: latestReport!.version,
          },
          manifest: packageManifest,
          generatedByUserId: getLocalUser(req)?.id ?? null,
        });
        if (project.status === "signed_off") {
          const transitioned = await tx
            .update(projects)
            .set({
              status: "exported",
              version: sql`${projects.version} + 1`,
              updatedAt: exportTransitionAt,
            })
            .where(
              and(
                eq(projects.id, projectId),
                eq(projects.organisationId, getOrganisationId(req)!),
                eq(projects.status, "signed_off"),
                eq(projects.version, project.version),
              ),
            )
            .returning({ id: projects.id });
          if (transitioned.length !== 1) {
            throw new Error("Project export status CAS failed");
          }
        }
        await writeAuditTx(tx, {
          user: getLocalUser(req),
          organisationId: getOrganisationId(req),
          projectId,
          eventType: packageVersion.created
            ? "package.project_export_version_created"
            : "package.project_export_version_reused",
          objectType: "package_version",
          objectId: packageVersion.packageVersionId,
          details: JSON.stringify({
            packageId: packageVersion.packageId,
            versionNumber: packageVersion.versionNumber,
            sourceSnapshotHash: packageVersion.sourceSnapshotHash,
            manifestHash: packageVersion.manifestHash,
            entryCount: packageManifest.items.length,
            renderQaStatus: packageVersion.renderQaStatus,
          }),
        });
        await writeAuditTx(tx, {
          user: getLocalUser(req),
          organisationId: getOrganisationId(req),
          projectId,
          eventType: "project.exported",
          objectType: "project",
          objectId: projectId,
        });
      },
      { isolationLevel: "read committed" },
    );

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

    for (const entry of archiveEntries) {
      archive.append(entry.bytes, { name: entry.filename });
    }

    await archive.finalize();
  },
);

export default router;
