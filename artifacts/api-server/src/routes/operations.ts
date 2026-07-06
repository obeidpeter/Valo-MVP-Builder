import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  db,
  boqChecks,
  clients,
  defects,
  documents,
  evidenceItems,
  llmRuns,
  notificationEvents,
  projects,
  reports,
  requirements,
  retentionRequests,
  vaultItems,
} from "@workspace/db";
import { CreateProjectNotificationBody, CreateRetentionRequestBody } from "@workspace/api-zod";
import { requireMember, requireRoles, getLocalUser } from "../middlewares/auth";
import { writeAudit } from "../lib/audit";
import { serializeNotification, serializeRetention } from "../lib/serializers";
import {
  computeExpiry,
  computeRedTeamDueAt,
  computeSlaDueAt,
  validateProjectTransition,
  type ConflictStatus,
  type PaymentStatus,
  type ProjectStatus,
  type SlaClass,
} from "../lib/deterministic";
import { ObjectStorageService } from "../lib/objectStorage";
import { planProjectBlobPurge, purgeBlobs } from "../lib/purge";

const router: IRouter = Router();
const objectStorage = new ObjectStorageService();

const ACTIVE_STATUSES = ["intake", "extraction", "review", "defects", "reporting"];

router.get("/workflow/alerts", requireMember, async (_req: Request, res: Response) => {
  const now = new Date();
  const projectRows = await db
    .select()
    .from(projects)
    .where(inArray(projects.status, ACTIVE_STATUSES))
    .orderBy(desc(projects.createdAt));
  const vaultRows = await db
    .select({ item: vaultItems, clientName: clients.name })
    .from(vaultItems)
    .leftJoin(clients, eq(vaultItems.clientId, clients.id));

  const slaBreaches = projectRows
    .map((p) => {
      const dueAt = computeSlaDueAt(
        p.createdAt instanceof Date ? p.createdAt : new Date(p.createdAt),
        (p.slaClass ?? "standard") as SlaClass,
      );
      return { projectId: p.id, tenderTitle: p.tenderTitle, dueAt, breached: now > dueAt };
    })
    .filter((a) => a.breached)
    .map((a) => ({ ...a, dueAt: a.dueAt.toISOString() }));

  // The red-team window opens 72h before the tender deadline and closes at
  // the deadline itself — a red-team prompt after submission is dead noise.
  const redTeamDue = projectRows.flatMap((p) => {
    const dueAt = computeRedTeamDueAt(p.deadline);
    if (!dueAt || now < dueAt) return [];
    const deadlineMs = p.deadline ? Date.parse(p.deadline) : Number.NaN;
    if (!Number.isNaN(deadlineMs) && now.getTime() > deadlineMs) return [];
    return [{ projectId: p.id, tenderTitle: p.tenderTitle, dueAt: dueAt.toISOString() }];
  });

  const vaultExpiring = vaultRows
    .map(({ item, clientName }) => ({
      vaultItemId: item.id,
      clientId: item.clientId,
      clientName: clientName ?? null,
      artefactType: item.artefactType,
      expiry: computeExpiry(item.expiryDate, now, item.renewalLeadDays),
    }))
    .filter((v) => ["expired", "critical", "warning", "upcoming"].includes(v.expiry.band));

  res.json({ slaBreaches, redTeamDue, vaultExpiring });
});

router.get("/projects/:id/notifications", requireMember, async (req: Request, res: Response) => {
  const rows = await db
    .select()
    .from(notificationEvents)
    .where(eq(notificationEvents.projectId, String(req.params.id)))
    .orderBy(desc(notificationEvents.createdAt));
  res.json(rows.map(serializeNotification));
});

router.post("/projects/:id/notifications", requireMember, async (req: Request, res: Response) => {
  const parsed = CreateProjectNotificationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const projectId = String(req.params.id);
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const user = getLocalUser(req);
  const [created] = await db
    .insert(notificationEvents)
    .values({
      projectId,
      clientId: project.clientId,
      channel: parsed.data.channel ?? "manual",
      template: parsed.data.template,
      recipient: parsed.data.recipient ?? null,
      payload: parsed.data.payload == null ? null : JSON.stringify(parsed.data.payload),
      status: parsed.data.status ?? "queued",
      createdBy: user?.id ?? null,
    })
    .returning();
  await writeAudit({
    user,
    projectId,
    eventType: "notification.queued",
    objectType: "notification",
    objectId: created.id,
    details: `${created.channel}:${created.template}`,
  });
  res.status(201).json(serializeNotification(created));
});

router.post("/projects/:id/retention-requests", requireMember, async (req: Request, res: Response) => {
  const parsed = CreateRetentionRequestBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const projectId = String(req.params.id);
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const now = Date.now();
  let dueAt = new Date(now + 14 * 24 * 60 * 60 * 1000);
  if (parsed.data.dueAt !== undefined) {
    const requested = Date.parse(parsed.data.dueAt);
    if (Number.isNaN(requested)) {
      res.status(400).json({ error: "dueAt must be a valid date" });
      return;
    }
    if (requested < now) {
      res.status(400).json({ error: "dueAt cannot be in the past" });
      return;
    }
    dueAt = new Date(requested);
  }
  const [openRequest] = await db
    .select({ id: retentionRequests.id })
    .from(retentionRequests)
    .where(and(eq(retentionRequests.projectId, projectId), eq(retentionRequests.status, "pending")));
  if (openRequest) {
    res.status(409).json({
      error: `A retention request (${openRequest.id}) is already open for this engagement.`,
    });
    return;
  }
  const user = getLocalUser(req);
  const [created] = await db
    .insert(retentionRequests)
    .values({
      projectId,
      requestedBy: user?.id ?? null,
      reason: parsed.data.reason ?? null,
      dueAt,
    })
    .returning();
  await writeAudit({
    user,
    projectId,
    eventType: "retention.requested",
    objectType: "retention_request",
    objectId: created.id,
    details: `due ${dueAt.toISOString()}`,
  });
  res.status(201).json(serializeRetention(created));
});

router.get("/retention-requests", requireRoles("admin"), async (_req: Request, res: Response) => {
  const rows = await db.select().from(retentionRequests).orderBy(desc(retentionRequests.createdAt));
  res.json(rows.map(serializeRetention));
});

/**
 * Completing a retention request is the digital half of NDPR-style deletion:
 * the certificate it issues is a formal representation to the client, so it
 * must only be written once every class of stored engagement content is
 * actually gone — source blobs, extracted requirement text, evidence
 * excerpts, defect snapshots, BOQ lines and LLM run summaries. The
 * tamper-evident audit chain is deliberately retained (and the certificate
 * says so): deleting audit history would break the accountability the
 * doctrine depends on.
 */
router.post(
  "/retention-requests/:id/complete",
  requireRoles("admin"),
  async (req: Request, res: Response) => {
    const [requestRow] = await db
      .select()
      .from(retentionRequests)
      .where(eq(retentionRequests.id, String(req.params.id)));
    if (!requestRow) {
      res.status(404).json({ error: "Retention request not found" });
      return;
    }
    if (requestRow.status === "completed") {
      res.json(serializeRetention(requestRow));
      return;
    }

    const projectId = requestRow.projectId;
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    // Archiving through retention goes through the same deterministic gate as
    // a manual status edit — most importantly the physical-archive
    // return/destroy instruction, which is the whole point of the archive gate.
    if (project.status !== "archived") {
      const gate = validateProjectTransition({
        fromStatus: project.status as ProjectStatus,
        toStatus: "archived",
        reviewerId: project.reviewerId,
        paymentStatus: project.paymentStatus as PaymentStatus,
        paymentConfirmedByFounder: project.paymentConfirmedByFounder,
        paymentConfirmedByAdvisor: project.paymentConfirmedByAdvisor,
        paymentFounderConfirmedBy: project.paymentFounderConfirmedBy,
        paymentAdvisorConfirmedBy: project.paymentAdvisorConfirmedBy,
        conflictStatus: project.conflictStatus as ConflictStatus,
        physicalArchiveInstruction: project.physicalArchiveInstruction,
      });
      if (!gate.ok) {
        await writeAudit({
          user: getLocalUser(req),
          projectId,
          eventType: "project.transition_denied",
          objectType: "project",
          objectId: projectId,
          details: gate.reason,
        });
        res.status(409).json({ error: gate.reason ?? "Project cannot be archived yet" });
        return;
      }
    }

    // Blob purge first (external side effect). Vault-owned blobs are the
    // client's long-lived artefacts and are excluded; if any deletable blob
    // fails, the request stays pending and no certificate is issued.
    const plan = await planProjectBlobPurge(projectId);
    const blobResult = await purgeBlobs(objectStorage, plan.paths, (objectPath, error) => {
      req.log.error({ err: error, objectPath }, "failed to purge retained blob");
    });
    if (blobResult.failed.length > 0) {
      await writeAudit({
        user: getLocalUser(req),
        projectId,
        eventType: "retention.purge_failed",
        objectType: "retention_request",
        objectId: requestRow.id,
        details: `${blobResult.failed.length} stored file(s) could not be purged; certificate withheld.`,
      });
      res.status(502).json({
        error: `${blobResult.failed.length} stored file(s) could not be purged. The request stays pending — retry once storage is reachable.`,
      });
      return;
    }

    // Row purge + archive + certificate in one transaction so a crash can
    // never leave a half-purged project with a still-pending request.
    const completedAt = new Date();
    const updated = await db.transaction(async (tx) => {
      const purgedEvidence = await tx
        .delete(evidenceItems)
        .where(eq(evidenceItems.projectId, projectId))
        .returning({ id: evidenceItems.id });
      const purgedDefects = await tx
        .delete(defects)
        .where(eq(defects.projectId, projectId))
        .returning({ id: defects.id });
      const purgedBoq = await tx
        .delete(boqChecks)
        .where(eq(boqChecks.projectId, projectId))
        .returning({ id: boqChecks.id });
      const purgedRequirements = await tx
        .delete(requirements)
        .where(eq(requirements.projectId, projectId))
        .returning({ id: requirements.id });
      const purgedLlmRuns = await tx
        .delete(llmRuns)
        .where(eq(llmRuns.projectId, projectId))
        .returning({ id: llmRuns.id });
      const purgedDocs = await tx
        .delete(documents)
        .where(eq(documents.projectId, projectId))
        .returning({ id: documents.id });
      const purgedReports = await tx
        .delete(reports)
        .where(eq(reports.projectId, projectId))
        .returning({ id: reports.id });
      await tx
        .update(projects)
        .set({
          status: "archived",
          scope: null,
          limitations: null,
          responsivenessReview: null,
          riskOverrideNote: null,
        })
        .where(eq(projects.id, projectId));

      const certificateText =
        `Retention deletion certificate: project ${projectId}. ` +
        `Purged ${blobResult.purged}/${plan.paths.length} stored file(s)` +
        (plan.vaultRetained.length > 0
          ? ` (${plan.vaultRetained.length} file(s) retained as client Certificate Vault artefacts)`
          : "") +
        `; deleted rows: documents=${purgedDocs.length}, reports=${purgedReports.length}, ` +
        `requirements=${purgedRequirements.length}, evidence=${purgedEvidence.length}, ` +
        `defects=${purgedDefects.length}, boq_checks=${purgedBoq.length}, llm_runs=${purgedLlmRuns.length}; ` +
        `project narrative fields cleared. Retained: project metadata, this retention record, ` +
        `and the tamper-evident audit chain. Completed ${completedAt.toISOString()}.`;

      const [row] = await tx
        .update(retentionRequests)
        .set({ status: "completed", completedAt, certificateText })
        .where(eq(retentionRequests.id, requestRow.id))
        .returning();
      return row;
    });

    await writeAudit({
      user: getLocalUser(req),
      projectId,
      eventType: "retention.completed",
      objectType: "retention_request",
      objectId: updated.id,
      details: updated.certificateText ?? undefined,
    });
    res.json(serializeRetention(updated));
  },
);

export default router;
