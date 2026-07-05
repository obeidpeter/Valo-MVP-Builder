import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import {
  db,
  projects,
  clients,
  users,
  defects,
  requirements,
  documents,
  reports,
} from "@workspace/db";
import { CreateProjectBody, UpdateProjectBody } from "@workspace/api-zod";
import { requireMember, requireRoles, getLocalUser } from "../middlewares/auth";
import { serializeProject } from "../lib/serializers";
import { writeAudit } from "../lib/audit";
import { responsivenessReview } from "../lib/llm";
import { ObjectStorageService } from "../lib/objectStorage";

const objectStorage = new ObjectStorageService();

const router: IRouter = Router();

function nextActionFor(status: string): string {
  switch (status) {
    case "intake":
      return "Upload tender and bid documents";
    case "extraction":
      return "Extract and confirm requirements";
    case "review":
      return "Map evidence to requirements";
    case "defects":
      return "Review defect register";
    case "reporting":
      return "Generate and sign off report";
    case "signed_off":
      return "Export package";
    case "exported":
      return "Record engagement outcome";
    default:
      return "Review project";
  }
}

// GET /projects — dashboard summaries with aggregates.
router.get("/projects", requireMember, async (req: Request, res: Response) => {
  const clientId = (req.query.clientId as string | undefined) || undefined;
  const rows = await db
    .select({
      project: projects,
      clientName: clients.name,
      reviewerName: users.name,
    })
    .from(projects)
    .leftJoin(clients, eq(projects.clientId, clients.id))
    .leftJoin(users, eq(projects.reviewerId, users.id))
    .where(clientId ? eq(projects.clientId, clientId) : undefined)
    .orderBy(desc(projects.createdAt));

  const ids = rows.map((r) => r.project.id);
  const defectCounts = new Map<string, { total: number; fatal: number }>();
  const reqCounts = new Map<string, number>();
  if (ids.length > 0) {
    const dc = await db
      .select({
        projectId: defects.projectId,
        total: sql<number>`count(*)::int`,
        fatal: sql<number>`count(*) filter (where ${defects.severity} in ('fatal','likely_fatal'))::int`,
      })
      .from(defects)
      .where(inArray(defects.projectId, ids))
      .groupBy(defects.projectId);
    for (const r of dc) defectCounts.set(r.projectId, { total: Number(r.total), fatal: Number(r.fatal) });
    const rc = await db
      .select({ projectId: requirements.projectId, total: sql<number>`count(*)::int` })
      .from(requirements)
      .where(inArray(requirements.projectId, ids))
      .groupBy(requirements.projectId);
    for (const r of rc) reqCounts.set(r.projectId, Number(r.total));
  }

  res.json(
    rows.map((r) => {
      const p = r.project;
      const dc = defectCounts.get(p.id) ?? { total: 0, fatal: 0 };
      return {
        id: p.id,
        clientId: p.clientId,
        clientName: r.clientName ?? null,
        tenderTitle: p.tenderTitle,
        issuingEntity: p.issuingEntity ?? null,
        deadline: p.deadline ?? null,
        segment: p.segment ?? null,
        status: p.status,
        reviewerName: r.reviewerName ?? null,
        riskScore: p.riskScore ?? null,
        riskBand: p.riskBand ?? null,
        outcome: p.outcome,
        nextAction: nextActionFor(p.status),
        defectCount: dc.total,
        fatalDefectCount: dc.fatal,
        requirementCount: reqCounts.get(p.id) ?? 0,
        createdAt: (p.createdAt instanceof Date ? p.createdAt : new Date(p.createdAt)).toISOString(),
      };
    }),
  );
});

router.post("/projects", requireMember, async (req: Request, res: Response) => {
  const parsed = CreateProjectBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const [created] = await db.insert(projects).values({ ...parsed.data }).returning();
  await writeAudit({
    user: getLocalUser(req),
    projectId: created.id,
    eventType: "project.created",
    objectType: "project",
    objectId: created.id,
    details: created.tenderTitle,
  });
  res.status(201).json(serializeProject(created));
});

async function loadProjectWithJoins(id: string) {
  const [row] = await db
    .select({
      project: projects,
      clientName: clients.name,
      ndaStatus: clients.ndaStatus,
      reviewerName: users.name,
    })
    .from(projects)
    .leftJoin(clients, eq(projects.clientId, clients.id))
    .leftJoin(users, eq(projects.reviewerId, users.id))
    .where(eq(projects.id, id));
  return row;
}

router.get("/projects/:id", requireMember, async (req: Request, res: Response) => {
  const row = await loadProjectWithJoins(String(req.params.id));
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(
    serializeProject(row.project, {
      clientName: row.clientName,
      ndaStatus: row.ndaStatus,
      reviewerName: row.reviewerName,
    }),
  );
});

router.patch("/projects/:id", requireMember, async (req: Request, res: Response) => {
  const parsed = UpdateProjectBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const [updated] = await db
    .update(projects)
    .set({ ...parsed.data })
    .where(eq(projects.id, String(req.params.id)))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  await writeAudit({
    user: getLocalUser(req),
    projectId: updated.id,
    eventType: "project.updated",
    objectType: "project",
    objectId: updated.id,
    details: JSON.stringify(parsed.data),
  });
  const row = await loadProjectWithJoins(updated.id);
  res.json(
    serializeProject(row!.project, {
      clientName: row!.clientName,
      ndaStatus: row!.ndaStatus,
      reviewerName: row!.reviewerName,
    }),
  );
});

router.delete(
  "/projects/:id",
  requireRoles("admin"),
  async (req: Request, res: Response) => {
    const projectId = String(req.params.id);
    const user = getLocalUser(req);

    const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
    if (!project) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    // Collect every stored blob for this project before removing DB rows.
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
        req.log.error({ err: error, objectPath: path }, "failed to purge project blob");
      }
    }

    // Cascade-deletes documents/reports/requirements/etc. via FK onDelete.
    const [deleted] = await db
      .delete(projects)
      .where(eq(projects.id, projectId))
      .returning();

    await writeAudit({
      user,
      eventType: "project.deleted",
      objectType: "project",
      objectId: projectId,
      details: `${deleted.tenderTitle} — purged ${purged}/${blobPaths.length} stored file(s).`,
    });
    res.status(204).end();
  },
);

router.post(
  "/projects/:id/responsiveness-review",
  requireMember,
  async (req: Request, res: Response) => {
    const [project] = await db.select().from(projects).where(eq(projects.id, String(req.params.id)));
    if (!project) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const reqs = await db
      .select({ text: requirements.text, isMandatory: requirements.isMandatory })
      .from(requirements)
      .where(eq(requirements.projectId, project.id));
    const defs = await db
      .select({ type: defects.type, severity: defects.severity, description: defects.description })
      .from(defects)
      .where(eq(defects.projectId, project.id));

    try {
      const { review, model } = await responsivenessReview(project.id, {
        tenderTitle: project.tenderTitle,
        requirements: reqs,
        defects: defs,
      });
      await db
        .update(projects)
        .set({ responsivenessReview: review, responsivenessSuggested: true })
        .where(eq(projects.id, project.id));
      await writeAudit({
        user: getLocalUser(req),
        projectId: project.id,
        eventType: "project.responsiveness_suggested",
        objectType: "project",
        objectId: project.id,
      });
      res.json({ review, model });
    } catch (error) {
      req.log.error({ err: error }, "responsiveness review failed");
      res.status(502).json({ error: "LLM responsiveness review failed" });
    }
  },
);

export default router;
