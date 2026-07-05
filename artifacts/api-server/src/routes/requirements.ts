import { Router, type IRouter, type Request, type Response } from "express";
import { eq, desc } from "drizzle-orm";
import { db, requirements, documents, projects } from "@workspace/db";
import {
  CreateRequirementBody,
  UpdateRequirementBody,
  ExtractRequirementsBody,
} from "@workspace/api-zod";
import { requireMember, getLocalUser } from "../middlewares/auth";
import { serializeRequirement } from "../lib/serializers";
import { writeAudit } from "../lib/audit";
import { extractRequirements } from "../lib/llm";

const router: IRouter = Router();

router.post(
  "/projects/:id/extract-requirements",
  requireMember,
  async (req: Request, res: Response) => {
    const [project] = await db.select().from(projects).where(eq(projects.id, String(req.params.id)));
    if (!project) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const parsed = ExtractRequirementsBody.safeParse(req.body ?? {});
    const docIds = parsed.success ? parsed.data?.documentIds : undefined;

    let docs = await db
      .select()
      .from(documents)
      .where(eq(documents.projectId, project.id));
    if (docIds && docIds.length > 0) {
      docs = docs.filter((d) => docIds.includes(d.id));
    } else {
      // Default to tender-type documents for requirement extraction.
      const tenderDocs = docs.filter((d) => d.type === "tender");
      if (tenderDocs.length > 0) docs = tenderDocs;
    }
    docs = docs.filter((d) => d.contentText && d.redactionStatus !== "excluded");

    if (docs.length === 0) {
      res.status(400).json({ error: "No documents with extracted text available for extraction" });
      return;
    }

    try {
      const { requirements: extracted, model } = await extractRequirements(
        project.id,
        docs.map((d) => ({ id: d.id, filename: d.filename, type: d.type, contentText: d.contentText })),
      );
      const validDocIds = new Set(docs.map((d) => d.id));
      const inserted = extracted.length
        ? await db
            .insert(requirements)
            .values(
              extracted.map((r) => ({
                projectId: project.id,
                sourceDocId: r.sourceDocId && validDocIds.has(r.sourceDocId) ? r.sourceDocId : null,
                pageRef: r.pageRef ?? null,
                clauseRef: r.clauseRef ?? null,
                text: r.text,
                category: r.category ?? "other",
                expectedEvidence: r.expectedEvidence ?? null,
                isMandatory: r.isMandatory ?? true,
                confidence: r.confidence ?? null,
                reviewStatus: "suggested",
              })),
            )
            .returning()
        : [];

      if (project.status === "intake") {
        await db.update(projects).set({ status: "extraction" }).where(eq(projects.id, project.id));
      }
      await writeAudit({
        user: getLocalUser(req),
        projectId: project.id,
        eventType: "requirements.extracted",
        objectType: "project",
        objectId: project.id,
        details: `${inserted.length} suggested`,
      });
      res.json({ created: inserted.length, model, requirements: inserted.map((r) => serializeRequirement(r)) });
    } catch (error) {
      req.log.error({ err: error }, "requirement extraction failed");
      res.status(502).json({ error: "LLM requirement extraction failed" });
    }
  },
);

router.get(
  "/projects/:id/requirements",
  requireMember,
  async (req: Request, res: Response) => {
    const rows = await db
      .select({ req: requirements, sourceDocName: documents.filename })
      .from(requirements)
      .leftJoin(documents, eq(requirements.sourceDocId, documents.id))
      .where(eq(requirements.projectId, String(req.params.id)))
      .orderBy(desc(requirements.createdAt));
    res.json(rows.map((r) => serializeRequirement(r.req, r.sourceDocName)));
  },
);

router.post(
  "/projects/:id/requirements",
  requireMember,
  async (req: Request, res: Response) => {
    const parsed = CreateRequirementBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    const [created] = await db
      .insert(requirements)
      .values({
        ...parsed.data,
        projectId: String(req.params.id),
        reviewStatus: "confirmed",
        isMandatory: parsed.data.isMandatory ?? true,
      })
      .returning();
    await writeAudit({
      user: getLocalUser(req),
      projectId: String(req.params.id),
      eventType: "requirement.created",
      objectType: "requirement",
      objectId: created.id,
    });
    res.status(201).json(serializeRequirement(created));
  },
);

router.patch("/requirements/:id", requireMember, async (req: Request, res: Response) => {
  const parsed = UpdateRequirementBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const [updated] = await db
    .update(requirements)
    .set({ ...parsed.data })
    .where(eq(requirements.id, String(req.params.id)))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  await writeAudit({
    user: getLocalUser(req),
    projectId: updated.projectId,
    eventType: "requirement.updated",
    objectType: "requirement",
    objectId: updated.id,
    details: parsed.data.reviewStatus ? `status=${parsed.data.reviewStatus}` : undefined,
  });
  res.json(serializeRequirement(updated));
});

router.delete("/requirements/:id", requireMember, async (req: Request, res: Response) => {
  const [deleted] = await db
    .delete(requirements)
    .where(eq(requirements.id, String(req.params.id)))
    .returning();
  if (!deleted) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  await writeAudit({
    user: getLocalUser(req),
    projectId: deleted.projectId,
    eventType: "requirement.deleted",
    objectType: "requirement",
    objectId: deleted.id,
  });
  res.status(204).end();
});

export default router;
