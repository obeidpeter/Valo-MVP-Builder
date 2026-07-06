import { Router, type IRouter, type Request, type Response } from "express";
import { desc, eq } from "drizzle-orm";
import {
  db,
  clients,
  documents,
  notificationEvents,
  projects,
  reports,
  retentionRequests,
  vaultItems,
} from "@workspace/db";
import { requireMember, requireRoles, getLocalUser } from "../middlewares/auth";
import { writeAudit } from "../lib/audit";
import { computeExpiry, computeRedTeamDueAt, computeSlaDueAt, type SlaClass } from "../lib/deterministic";
import { ObjectStorageService } from "../lib/objectStorage";

const router: IRouter = Router();
const objectStorage = new ObjectStorageService();

const iso = (d: Date | string | null | undefined): string | null =>
  d ? (d instanceof Date ? d.toISOString() : String(d)) : null;

function serializeNotification(n: typeof notificationEvents.$inferSelect) {
  return {
    id: n.id,
    projectId: n.projectId ?? null,
    clientId: n.clientId ?? null,
    vaultItemId: n.vaultItemId ?? null,
    channel: n.channel,
    template: n.template,
    recipient: n.recipient ?? null,
    payload: n.payload ?? null,
    status: n.status,
    createdAt: iso(n.createdAt) ?? new Date(0).toISOString(),
  };
}

function serializeRetention(r: typeof retentionRequests.$inferSelect) {
  return {
    id: r.id,
    projectId: r.projectId,
    reason: r.reason ?? null,
    dueAt: iso(r.dueAt) ?? new Date(0).toISOString(),
    completedAt: iso(r.completedAt),
    certificateText: r.certificateText ?? null,
    status: r.status,
    createdAt: iso(r.createdAt) ?? new Date(0).toISOString(),
  };
}

router.get("/workflow/alerts", requireMember, async (_req: Request, res: Response) => {
  const now = new Date();
  const projectRows = await db.select().from(projects).orderBy(desc(projects.createdAt));
  const vaultRows = await db
    .select({ item: vaultItems, clientName: clients.name })
    .from(vaultItems)
    .leftJoin(clients, eq(vaultItems.clientId, clients.id));

  const activeProjects = projectRows.filter((p) =>
    ["intake", "extraction", "review", "defects", "reporting"].includes(p.status),
  );
  const slaBreaches = activeProjects
    .map((p) => {
      const dueAt = computeSlaDueAt(
        p.createdAt instanceof Date ? p.createdAt : new Date(p.createdAt),
        (p.slaClass ?? "standard") as SlaClass,
      );
      return { projectId: p.id, tenderTitle: p.tenderTitle, dueAt, breached: now > dueAt };
    })
    .filter((a) => a.breached)
    .map((a) => ({ ...a, dueAt: a.dueAt.toISOString() }));

  const redTeamDue = activeProjects
    .map((p) => ({ projectId: p.id, tenderTitle: p.tenderTitle, dueAt: computeRedTeamDueAt(p.deadline) }))
    .filter((a): a is { projectId: string; tenderTitle: string; dueAt: Date } => !!a.dueAt && now >= a.dueAt)
    .map((a) => ({ ...a, dueAt: a.dueAt.toISOString() }));

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
  const projectId = String(req.params.id);
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const body = req.body ?? {};
  if (!body.template || typeof body.template !== "string") {
    res.status(400).json({ error: "template is required" });
    return;
  }
  const user = getLocalUser(req);
  const [created] = await db
    .insert(notificationEvents)
    .values({
      projectId,
      clientId: project.clientId,
      channel: typeof body.channel === "string" ? body.channel : "manual",
      template: body.template,
      recipient: typeof body.recipient === "string" ? body.recipient : null,
      payload: body.payload == null ? null : JSON.stringify(body.payload),
      status: typeof body.status === "string" ? body.status : "queued",
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
  const projectId = String(req.params.id);
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const dueAt =
    typeof req.body?.dueAt === "string" && !Number.isNaN(Date.parse(req.body.dueAt))
      ? new Date(req.body.dueAt)
      : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  const user = getLocalUser(req);
  const [created] = await db
    .insert(retentionRequests)
    .values({
      projectId,
      requestedBy: user?.id ?? null,
      reason: typeof req.body?.reason === "string" ? req.body.reason : null,
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
    const docs = await db.select().from(documents).where(eq(documents.projectId, projectId));
    const reps = await db.select().from(reports).where(eq(reports.projectId, projectId));
    const blobPaths = [
      ...docs.map((d) => d.objectPath),
      ...reps.map((r) => r.docxPath).filter((p): p is string => !!p),
    ];

    let purged = 0;
    for (const path of blobPaths) {
      try {
        if (await objectStorage.deleteObjectEntity(path)) purged++;
      } catch (error) {
        req.log.error({ err: error, objectPath: path }, "failed to purge retained blob");
      }
    }

    await db.delete(documents).where(eq(documents.projectId, projectId));
    await db.delete(reports).where(eq(reports.projectId, projectId));
    await db.update(projects).set({ status: "archived" }).where(eq(projects.id, projectId));

    const certificateText = `Retention deletion certificate: project ${projectId}; purged ${purged}/${blobPaths.length} stored file(s); completed ${new Date().toISOString()}.`;
    const [updated] = await db
      .update(retentionRequests)
      .set({ status: "completed", completedAt: new Date(), certificateText })
      .where(eq(retentionRequests.id, requestRow.id))
      .returning();

    await writeAudit({
      user: getLocalUser(req),
      projectId,
      eventType: "retention.completed",
      objectType: "retention_request",
      objectId: updated.id,
      details: certificateText,
    });
    res.json(serializeRetention(updated));
  },
);

export default router;
