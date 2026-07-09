import { Router, type IRouter, type Request, type Response } from "express";
import { eq, desc, inArray } from "drizzle-orm";
import { db, requirements, documents, projects, evidenceItems, defects } from "@workspace/db";
import {
  CreateRequirementBody,
  UpdateRequirementBody,
  ExtractRequirementsBody,
  MergeRequirementsBody,
} from "@workspace/api-zod";
import { requireMember, getLocalUser } from "../middlewares/auth";
import { serializeRequirement } from "../lib/serializers";
import { writeAudit } from "../lib/audit";
import { extractRequirements } from "../lib/llm";
import { computeScorecard } from "../lib/scorecard";

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
                // Scorecard provenance (FR-EXT-04): engine-surfaced, with the
                // proposal frozen so later human edits stay diffable.
                origin: "engine",
                engineText: r.text,
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
    const user = getLocalUser(req);
    const [created] = await db
      .insert(requirements)
      .values({
        ...parsed.data,
        projectId: String(req.params.id),
        reviewStatus: "confirmed",
        isMandatory: parsed.data.isMandatory ?? true,
        // A manual addition is by definition an engine miss (FR-EXT-04); the
        // creator is the named reviewer who verified it.
        origin: "manual",
        reviewedBy: user?.id ?? null,
        reviewedByName: user?.name ?? user?.email ?? null,
        reviewedAt: new Date(),
      })
      .returning();
    await writeAudit({
      user,
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
  const user = getLocalUser(req);
  // A review action (status ruling or a content edit) stamps the acting
  // reviewer server-side (FR-EXT-03) — identity is never client-supplied.
  const isReviewAction = parsed.data.reviewStatus !== undefined || parsed.data.text !== undefined;
  const reviewerStamp = isReviewAction
    ? {
        reviewedBy: user?.id ?? null,
        reviewedByName: user?.name ?? user?.email ?? null,
        reviewedAt: new Date(),
      }
    : {};
  const [updated] = await db
    .update(requirements)
    .set({ ...parsed.data, ...reviewerStamp })
    .where(eq(requirements.id, String(req.params.id)))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  await writeAudit({
    user,
    projectId: updated.projectId,
    eventType: "requirement.updated",
    objectType: "requirement",
    objectId: updated.id,
    details: parsed.data.reviewStatus ? `status=${parsed.data.reviewStatus}` : undefined,
  });
  res.json(serializeRequirement(updated));
});

router.post(
  "/projects/:id/requirements/merge",
  requireMember,
  async (req: Request, res: Response) => {
    const projectId = String(req.params.id);
    const parsed = MergeRequirementsBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    const requestedIds = Array.from(new Set(parsed.data.requirementIds));
    const { survivorId } = parsed.data;
    if (requestedIds.length < 2) {
      res.status(400).json({ error: "Select at least two requirements to merge" });
      return;
    }
    if (!requestedIds.includes(survivorId)) {
      res.status(400).json({ error: "Survivor must be one of the selected requirements" });
      return;
    }

    const user = getLocalUser(req);
    try {
      const result = await db.transaction(async (tx) => {
        // Lock the selected rows so a concurrent edit/merge can't race us into
        // re-pointing links onto a row that's being deleted.
        const rows = await tx
          .select()
          .from(requirements)
          .where(inArray(requirements.id, requestedIds))
          .for("update");

        // Every selected row must exist and belong to this project, or the
        // merge is ambiguous and we refuse it wholesale.
        if (rows.length !== requestedIds.length || rows.some((r) => r.projectId !== projectId)) {
          return { error: "notfound" as const };
        }

        const survivor = rows.find((r) => r.id === survivorId)!;
        const mergedAway = rows.filter((r) => r.id !== survivorId);
        const mergedIds = mergedAway.map((r) => r.id);

        // Fold the merged-away rows' citations onto the survivor, keeping any
        // it already accumulated from prior merges. The survivor's own primary
        // citation stays in its native columns and is not duplicated here.
        const docNames = await tx
          .select({ id: documents.id, filename: documents.filename })
          .from(documents)
          .where(eq(documents.projectId, projectId));
        const nameById = new Map(docNames.map((d) => [d.id, d.filename]));

        const existing = serializeRequirement(survivor).mergedCitations;
        // Fold in each merged-away row's own native citation AND any citations
        // it had already absorbed from prior merges, so provenance survives
        // repeated merges (no historical citation is ever dropped).
        const foldedIn = mergedAway.flatMap((r) => [
          {
            sourceDocId: r.sourceDocId ?? null,
            sourceDocName: r.sourceDocId ? (nameById.get(r.sourceDocId) ?? null) : null,
            pageRef: r.pageRef ?? null,
            clauseRef: r.clauseRef ?? null,
            text: r.text,
          },
          ...serializeRequirement(r).mergedCitations,
        ]);
        const combined = [...existing, ...foldedIn];

        // Re-point links BEFORE deleting the merged rows: evidence cascades on
        // requirement delete and defects null out, so both must move first.
        await tx
          .update(evidenceItems)
          .set({ requirementId: survivorId })
          .where(inArray(evidenceItems.requirementId, mergedIds));
        await tx
          .update(defects)
          .set({ requirementId: survivorId })
          .where(inArray(defects.requirementId, mergedIds));

        await tx.delete(requirements).where(inArray(requirements.id, mergedIds));

        const [updated] = await tx
          .update(requirements)
          .set({ mergedCitations: JSON.stringify(combined) })
          .where(eq(requirements.id, survivorId))
          .returning();

        return { updated, mergedCount: mergedIds.length };
      });

      if ("error" in result) {
        res.status(404).json({ error: "One or more requirements not found in this project" });
        return;
      }

      await writeAudit({
        user,
        projectId,
        eventType: "requirement.merged",
        objectType: "requirement",
        objectId: survivorId,
        details: `${result.mergedCount} merged into survivor`,
      });

      const sourceDocName = result.updated.sourceDocId
        ? (
            await db
              .select({ filename: documents.filename })
              .from(documents)
              .where(eq(documents.id, result.updated.sourceDocId))
          )[0]?.filename ?? null
        : null;
      res.json(serializeRequirement(result.updated, sourceDocName));
    } catch (error) {
      req.log.error({ err: error }, "requirement merge failed");
      res.status(500).json({ error: "Merge failed" });
    }
  },
);

router.get(
  "/projects/:id/scorecard",
  requireMember,
  async (req: Request, res: Response) => {
    const projectId = String(req.params.id);
    const rows = await db
      .select({
        sourceDocId: requirements.sourceDocId,
        origin: requirements.origin,
        isMandatory: requirements.isMandatory,
        reviewStatus: requirements.reviewStatus,
      })
      .from(requirements)
      .where(eq(requirements.projectId, projectId));
    const scorecard = computeScorecard(rows);

    // Attach filenames so the per-document breakdown is readable.
    const docs = await db
      .select({ id: documents.id, filename: documents.filename })
      .from(documents)
      .where(eq(documents.projectId, projectId));
    const names = new Map(docs.map((d) => [d.id, d.filename]));
    res.json({
      ...scorecard,
      perDocument: scorecard.perDocument.map((d) => ({
        ...d,
        documentName: d.documentId ? (names.get(d.documentId) ?? null) : null,
      })),
    });
  },
);

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
