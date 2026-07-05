import { Router, type IRouter, type Request, type Response } from "express";
import { eq, desc } from "drizzle-orm";
import { db, defects, requirements, evidenceItems, projects } from "@workspace/db";
import { CreateDefectBody, UpdateDefectBody } from "@workspace/api-zod";
import { requireMember, getLocalUser } from "../middlewares/auth";
import { serializeDefect } from "../lib/serializers";
import { writeAudit } from "../lib/audit";
import { suggestDefects } from "../lib/llm";

const router: IRouter = Router();

router.get(
  "/projects/:id/defects",
  requireMember,
  async (req: Request, res: Response) => {
    const rows = await db
      .select({ def: defects, requirementText: requirements.text })
      .from(defects)
      .leftJoin(requirements, eq(defects.requirementId, requirements.id))
      .where(eq(defects.projectId, String(req.params.id)))
      .orderBy(desc(defects.createdAt));
    res.json(rows.map((r) => serializeDefect(r.def, r.requirementText)));
  },
);

router.post(
  "/projects/:id/suggest-defects",
  requireMember,
  async (req: Request, res: Response) => {
    const [project] = await db.select().from(projects).where(eq(projects.id, String(req.params.id)));
    if (!project) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const reqs = await db.select().from(requirements).where(eq(requirements.projectId, project.id));
    const ev = await db.select().from(evidenceItems).where(eq(evidenceItems.projectId, project.id));
    if (reqs.length === 0) {
      res.status(400).json({ error: "No requirements available to analyse" });
      return;
    }
    try {
      const { defects: suggested, model } = await suggestDefects(
        project.id,
        reqs.map((r) => ({ id: r.id, text: r.text, isMandatory: r.isMandatory })),
        ev.map((e) => ({ requirementId: e.requirementId, evidenceStatus: e.evidenceStatus, notes: e.notes })),
      );
      const validReqIds = new Set(reqs.map((r) => r.id));
      const inserted = suggested.length
        ? await db
            .insert(defects)
            .values(
              suggested.map((d) => ({
                projectId: project.id,
                requirementId: d.requirementId && validReqIds.has(d.requirementId) ? d.requirementId : null,
                type: d.type,
                severity: d.severity,
                description: d.description,
                remediation: d.remediation ?? null,
                status: "suggested",
                suggested: true,
              })),
            )
            .returning()
        : [];
      if (project.status === "review") {
        await db.update(projects).set({ status: "defects" }).where(eq(projects.id, project.id));
      }
      await writeAudit({
        user: getLocalUser(req),
        projectId: project.id,
        eventType: "defects.suggested",
        objectType: "project",
        objectId: project.id,
        details: `${inserted.length} suggested`,
      });
      res.json({ created: inserted.length, model, defects: inserted.map((d) => serializeDefect(d)) });
    } catch (error) {
      req.log.error({ err: error }, "defect suggestion failed");
      res.status(502).json({ error: "LLM defect suggestion failed" });
    }
  },
);

router.post("/defects", requireMember, async (req: Request, res: Response) => {
  const parsed = CreateDefectBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const [created] = await db
    .insert(defects)
    .values({ ...parsed.data, suggested: false, status: parsed.data.status ?? "open" })
    .returning();
  await writeAudit({
    user: getLocalUser(req),
    projectId: created.projectId,
    eventType: "defect.created",
    objectType: "defect",
    objectId: created.id,
  });
  res.status(201).json(serializeDefect(created));
});

router.patch("/defects/:id", requireMember, async (req: Request, res: Response) => {
  const parsed = UpdateDefectBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const [updated] = await db
    .update(defects)
    .set({ ...parsed.data })
    .where(eq(defects.id, String(req.params.id)))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  await writeAudit({
    user: getLocalUser(req),
    projectId: updated.projectId,
    eventType: "defect.updated",
    objectType: "defect",
    objectId: updated.id,
    details: parsed.data.status ? `status=${parsed.data.status}` : undefined,
  });
  res.json(serializeDefect(updated));
});

router.delete("/defects/:id", requireMember, async (req: Request, res: Response) => {
  const [deleted] = await db.delete(defects).where(eq(defects.id, String(req.params.id))).returning();
  if (!deleted) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  await writeAudit({
    user: getLocalUser(req),
    projectId: deleted.projectId,
    eventType: "defect.deleted",
    objectType: "defect",
    objectId: deleted.id,
  });
  res.status(204).end();
});

export default router;
