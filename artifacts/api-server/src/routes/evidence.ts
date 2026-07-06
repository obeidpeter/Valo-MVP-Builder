import { Router, type IRouter, type Request, type Response } from "express";
import { eq, desc } from "drizzle-orm";
import { db, evidenceItems, requirements, documents, projects } from "@workspace/db";
import { CreateEvidenceBody, UpdateEvidenceBody } from "@workspace/api-zod";
import { requireMember, getLocalUser } from "../middlewares/auth";
import { serializeEvidence } from "../lib/serializers";
import { writeAudit } from "../lib/audit";
import { mapEvidence } from "../lib/llm";

const router: IRouter = Router();

router.get(
  "/projects/:id/evidence",
  requireMember,
  async (req: Request, res: Response) => {
    const rows = await db
      .select({ ev: evidenceItems, requirementText: requirements.text, documentName: documents.filename })
      .from(evidenceItems)
      .leftJoin(requirements, eq(evidenceItems.requirementId, requirements.id))
      .leftJoin(documents, eq(evidenceItems.documentId, documents.id))
      .where(eq(evidenceItems.projectId, String(req.params.id)))
      .orderBy(desc(evidenceItems.createdAt));
    res.json(
      rows.map((r) =>
        serializeEvidence(r.ev, { requirementText: r.requirementText, documentName: r.documentName }),
      ),
    );
  },
);

router.post(
  "/projects/:id/map-evidence",
  requireMember,
  async (req: Request, res: Response) => {
    const [project] = await db.select().from(projects).where(eq(projects.id, String(req.params.id)));
    if (!project) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const confirmedReqs = await db
      .select()
      .from(requirements)
      .where(eq(requirements.projectId, project.id));
    const usable = confirmedReqs.filter((r) => ["confirmed", "edited"].includes(r.reviewStatus));
    if (usable.length === 0) {
      res.status(400).json({ error: "No confirmed requirements to map evidence against" });
      return;
    }
    const bidDocs = (
      await db.select().from(documents).where(eq(documents.projectId, project.id))
    ).filter((d) => d.contentText && d.redactionStatus !== "excluded" && d.type !== "tender");
    const docsForLlm = bidDocs.length > 0 ? bidDocs : [];

    try {
      const { items, model } = await mapEvidence(
        project.id,
        usable.map((r) => ({ id: r.id, text: r.text, expectedEvidence: r.expectedEvidence })),
        docsForLlm.map((d) => ({ id: d.id, filename: d.filename, type: d.type, contentText: d.contentText })),
      );
      const validDocIds = new Set(bidDocs.map((d) => d.id));
      const inserted = items.length
        ? await db
            .insert(evidenceItems)
            .values(
              items.map((i) => ({
                projectId: project.id,
                requirementId: i.requirementId,
                documentId: i.documentId && validDocIds.has(i.documentId) ? i.documentId : null,
                evidenceStatus: i.evidenceStatus ?? "pending",
                excerpt: i.excerpt ?? null,
                notes: i.notes ?? null,
                suggested: true,
              })),
            )
            .returning()
        : [];
      if (project.status === "extraction") {
        await db.update(projects).set({ status: "review" }).where(eq(projects.id, project.id));
      }
      await writeAudit({
        user: getLocalUser(req),
        projectId: project.id,
        eventType: "evidence.mapped",
        objectType: "project",
        objectId: project.id,
        details: `${inserted.length} suggested`,
      });
      res.json({ created: inserted.length, model, items: inserted.map((e) => serializeEvidence(e)) });
    } catch (error) {
      req.log.error({ err: error }, "evidence mapping failed");
      res.status(502).json({ error: "LLM evidence mapping failed" });
    }
  },
);

router.post("/evidence", requireMember, async (req: Request, res: Response) => {
  const parsed = CreateEvidenceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const user = getLocalUser(req);
  const [created] = await db
    .insert(evidenceItems)
    .values({ ...parsed.data, suggested: false, confirmedBy: user?.id ?? null })
    .returning();
  await writeAudit({
    user,
    projectId: created.projectId,
    eventType: "evidence.created",
    objectType: "evidence",
    objectId: created.id,
  });
  res.status(201).json(serializeEvidence(created));
});

router.patch("/evidence/:id", requireMember, async (req: Request, res: Response) => {
  const parsed = UpdateEvidenceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const user = getLocalUser(req);
  const [updated] = await db
    .update(evidenceItems)
    .set({ ...parsed.data, confirmedBy: user?.id ?? null })
    .where(eq(evidenceItems.id, String(req.params.id)))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  await writeAudit({
    user,
    projectId: updated.projectId,
    eventType: "evidence.updated",
    objectType: "evidence",
    objectId: updated.id,
  });
  res.json(serializeEvidence(updated));
});

router.delete("/evidence/:id", requireMember, async (req: Request, res: Response) => {
  const [deleted] = await db
    .delete(evidenceItems)
    .where(eq(evidenceItems.id, String(req.params.id)))
    .returning();
  if (!deleted) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  await writeAudit({
    user: getLocalUser(req),
    projectId: deleted.projectId,
    eventType: "evidence.deleted",
    objectType: "evidence",
    objectId: deleted.id,
  });
  res.status(204).end();
});

export default router;
