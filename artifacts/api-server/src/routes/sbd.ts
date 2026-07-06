import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, sql, desc, asc } from "drizzle-orm";
import { db, sbdTemplates, sbdAnnotations } from "@workspace/db";
import {
  CreateSbdTemplateBody,
  UpdateSbdTemplateBody,
  CreateSbdAnnotationBody,
} from "@workspace/api-zod";
import { requireMember, getLocalUser } from "../middlewares/auth";
import { serializeSbdTemplate, serializeSbdAnnotation } from "../lib/serializers";
import { writeAudit } from "../lib/audit";

const router: IRouter = Router();

router.get("/sbd-templates", requireMember, async (_req: Request, res: Response) => {
  const rows = await db
    .select({
      template: sbdTemplates,
      annotationCount: sql<number>`count(${sbdAnnotations.id})::int`,
    })
    .from(sbdTemplates)
    .leftJoin(sbdAnnotations, eq(sbdAnnotations.templateId, sbdTemplates.id))
    .groupBy(sbdTemplates.id)
    .orderBy(asc(sbdTemplates.code), desc(sbdTemplates.version));
  res.json(
    rows.map((r) => serializeSbdTemplate(r.template, { annotationCount: Number(r.annotationCount) })),
  );
});

router.post("/sbd-templates", requireMember, async (req: Request, res: Response) => {
  const parsed = CreateSbdTemplateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const [created] = await db.insert(sbdTemplates).values({ ...parsed.data }).returning();
  await writeAudit({
    user: getLocalUser(req),
    eventType: "sbd.template_created",
    objectType: "sbd_template",
    objectId: created.id,
    details: `${created.code} v${created.version} — ${created.title}`,
  });
  res.status(201).json(serializeSbdTemplate(created, { annotationCount: 0 }));
});

router.get("/sbd-templates/:id", requireMember, async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const [template] = await db.select().from(sbdTemplates).where(eq(sbdTemplates.id, id));
  if (!template) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const annotations = await db
    .select()
    .from(sbdAnnotations)
    .where(eq(sbdAnnotations.templateId, id))
    .orderBy(desc(sbdAnnotations.createdAt));
  res.json({
    ...serializeSbdTemplate(template, { annotationCount: annotations.length }),
    annotations: annotations.map(serializeSbdAnnotation),
  });
});

router.patch("/sbd-templates/:id", requireMember, async (req: Request, res: Response) => {
  const parsed = UpdateSbdTemplateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  if (Object.keys(parsed.data).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }
  const [existing] = await db
    .select()
    .from(sbdTemplates)
    .where(eq(sbdTemplates.id, String(req.params.id)));
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  // Single-lineage invariant: at most one active version per template code.
  // Activating a version supersedes whichever version was active before, in
  // the same transaction, so two actives can never coexist.
  const activating = parsed.data.status === "active" && existing.status !== "active";
  const updated = await db.transaction(async (tx) => {
    if (activating) {
      await tx
        .update(sbdTemplates)
        .set({ status: "superseded" })
        .where(and(eq(sbdTemplates.code, existing.code), eq(sbdTemplates.status, "active")));
    }
    const [row] = await tx
      .update(sbdTemplates)
      .set({ ...parsed.data })
      .where(eq(sbdTemplates.id, existing.id))
      .returning();
    return row;
  });
  await writeAudit({
    user: getLocalUser(req),
    eventType: "sbd.template_updated",
    objectType: "sbd_template",
    objectId: updated.id,
    details: `${updated.code} v${updated.version} → ${updated.status}`,
  });
  res.json(serializeSbdTemplate(updated));
});

router.delete("/sbd-templates/:id", requireMember, async (req: Request, res: Response) => {
  const [deleted] = await db
    .delete(sbdTemplates)
    .where(eq(sbdTemplates.id, String(req.params.id)))
    .returning();
  if (!deleted) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  await writeAudit({
    user: getLocalUser(req),
    eventType: "sbd.template_deleted",
    objectType: "sbd_template",
    objectId: deleted.id,
    details: `${deleted.code} v${deleted.version}`,
  });
  res.status(204).end();
});

// Clone a template as the next draft version. The source, if active, is
// superseded so the corpus keeps exactly one lineage of published versions.
router.post("/sbd-templates/:id/versions", requireMember, async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const [source] = await db.select().from(sbdTemplates).where(eq(sbdTemplates.id, id));
  if (!source) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const [{ maxVersion }] = await db
    .select({ maxVersion: sql<number>`coalesce(max(${sbdTemplates.version}), 0)::int` })
    .from(sbdTemplates)
    .where(eq(sbdTemplates.code, source.code));
  const [created] = await db
    .insert(sbdTemplates)
    .values({
      code: source.code,
      title: source.title,
      category: source.category,
      version: Number(maxVersion) + 1,
      status: "draft",
      issuingCircular: source.issuingCircular,
      summary: source.summary,
    })
    .returning();
  if (source.status === "active") {
    await db
      .update(sbdTemplates)
      .set({ status: "superseded" })
      .where(eq(sbdTemplates.id, source.id));
  }
  await writeAudit({
    user: getLocalUser(req),
    eventType: "sbd.version_created",
    objectType: "sbd_template",
    objectId: created.id,
    details: `${created.code} v${created.version} (from v${source.version})`,
  });
  res.status(201).json(serializeSbdTemplate(created, { annotationCount: 0 }));
});

router.post("/sbd-templates/:id/annotations", requireMember, async (req: Request, res: Response) => {
  const parsed = CreateSbdAnnotationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const templateId = String(req.params.id);
  const [template] = await db
    .select({ id: sbdTemplates.id })
    .from(sbdTemplates)
    .where(eq(sbdTemplates.id, templateId));
  if (!template) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const [created] = await db
    .insert(sbdAnnotations)
    .values({ ...parsed.data, templateId })
    .returning();
  await writeAudit({
    user: getLocalUser(req),
    eventType: "sbd.annotation_created",
    objectType: "sbd_annotation",
    objectId: created.id,
    details: `${created.agency ?? "—"} ${created.section ?? ""}`.trim(),
  });
  res.status(201).json(serializeSbdAnnotation(created));
});

router.delete("/sbd-annotations/:id", requireMember, async (req: Request, res: Response) => {
  const [deleted] = await db
    .delete(sbdAnnotations)
    .where(eq(sbdAnnotations.id, String(req.params.id)))
    .returning();
  if (!deleted) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  await writeAudit({
    user: getLocalUser(req),
    eventType: "sbd.annotation_deleted",
    objectType: "sbd_annotation",
    objectId: deleted.id,
  });
  res.status(204).end();
});

export default router;
