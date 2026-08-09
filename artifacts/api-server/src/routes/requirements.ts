import { Router, type IRouter, type Request, type Response } from "express";
import { eq, desc, inArray, sql } from "drizzle-orm";
import {
  db,
  requirements,
  documents,
  projects,
  evidenceItems,
  defects,
} from "@workspace/db";
import {
  CreateRequirementBody,
  UpdateRequirementBody,
  ExtractRequirementsBody,
  MergeRequirementsBody,
} from "@workspace/api-zod";
import { getLocalUser } from "../middlewares/auth";
import {
  getAccessContext,
  getOrganisationId,
  requirePermissionOrLegacy,
} from "../middlewares/tenancy";
import { serializeRequirement } from "../lib/serializers";
import { writeAuditTx } from "../lib/audit";
import { extractRequirements } from "../lib/llm";
import { computeScorecard } from "../lib/scorecard";

const router: IRouter = Router();

router.post(
  "/projects/:id/extract-requirements",
  requirePermissionOrLegacy("requirement:write"),
  async (req: Request, res: Response) => {
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, String(req.params.id)));
    if (!project) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const organisationId = getOrganisationId(req);
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
    docs = docs.filter(
      (d) => d.contentText && d.redactionStatus !== "excluded",
    );

    if (docs.length === 0) {
      res.status(400).json({
        error: "No documents with extracted text available for extraction",
      });
      return;
    }

    try {
      const { requirements: extracted, model } = await extractRequirements(
        project.id,
        docs.map((d) => ({
          id: d.id,
          filename: d.filename,
          type: d.type,
          contentText: d.contentText,
        })),
      );
      const validDocIds = new Set(docs.map((d) => d.id));
      const inserted = await db.transaction(
        async (tx) => {
          const created = extracted.length
            ? await tx
                .insert(requirements)
                .values(
                  extracted.map((r) => ({
                    organisationId,
                    projectId: project.id,
                    sourceDocId:
                      r.sourceDocId && validDocIds.has(r.sourceDocId)
                        ? r.sourceDocId
                        : null,
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
            await tx
              .update(projects)
              .set({
                status: "extraction",
                version: sql`${projects.version} + 1`,
                updatedAt: new Date(),
              })
              .where(eq(projects.id, project.id));
          }
          await writeAuditTx(tx, {
            user: getLocalUser(req),
            organisationId,
            projectId: project.id,
            eventType: "requirements.extracted",
            objectType: "project",
            objectId: project.id,
            details: `${created.length} suggested`,
          });
          return created;
        },
        { isolationLevel: "read committed" },
      );
      res.json({
        created: inserted.length,
        model,
        requirements: inserted.map((r) => serializeRequirement(r)),
      });
    } catch (error) {
      req.log.error({ err: error }, "requirement extraction failed");
      res.status(502).json({ error: "LLM requirement extraction failed" });
    }
  },
);

router.get(
  "/projects/:id/requirements",
  requirePermissionOrLegacy("requirement:read"),
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
  requirePermissionOrLegacy("requirement:review"),
  async (req: Request, res: Response) => {
    const parsed = CreateRequirementBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    const user = getLocalUser(req);
    const organisationId = getOrganisationId(req);
    const created = await db.transaction(
      async (tx) => {
        const [requirement] = await tx
          .insert(requirements)
          .values({
            ...parsed.data,
            organisationId,
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
        await writeAuditTx(tx, {
          user,
          organisationId,
          projectId: String(req.params.id),
          eventType: "requirement.created",
          objectType: "requirement",
          objectId: requirement.id,
        });
        return requirement;
      },
      { isolationLevel: "read committed" },
    );
    res.status(201).json(serializeRequirement(created));
  },
);

router.patch(
  "/requirements/:id",
  requirePermissionOrLegacy("requirement:write"),
  async (req: Request, res: Response) => {
    const parsed = UpdateRequirementBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    const user = getLocalUser(req);
    // A review action (status ruling or a content edit) stamps the acting
    // reviewer server-side (FR-EXT-03) — identity is never client-supplied.
    const isReviewAction =
      parsed.data.reviewStatus !== undefined || parsed.data.text !== undefined;
    const context = getAccessContext(req);
    if (
      isReviewAction &&
      context &&
      !context.permissions.has("requirement:review")
    ) {
      res.status(403).json({ error: "Requirement review permission required" });
      return;
    }
    const reviewerStamp = isReviewAction
      ? {
          reviewedBy: user?.id ?? null,
          reviewedByName: user?.name ?? user?.email ?? null,
          reviewedAt: new Date(),
        }
      : {};
    const updated = await db.transaction(
      async (tx) => {
        const [requirement] = await tx
          .update(requirements)
          .set({
            ...parsed.data,
            ...reviewerStamp,
            version: sql`${requirements.version} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(requirements.id, String(req.params.id)))
          .returning();
        if (!requirement) return undefined;
        await writeAuditTx(tx, {
          user,
          organisationId: getOrganisationId(req),
          projectId: requirement.projectId,
          eventType: "requirement.updated",
          objectType: "requirement",
          objectId: requirement.id,
          details: parsed.data.reviewStatus
            ? `status=${parsed.data.reviewStatus}`
            : undefined,
        });
        return requirement;
      },
      { isolationLevel: "read committed" },
    );
    if (!updated) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(serializeRequirement(updated));
  },
);

router.post(
  "/projects/:id/requirements/merge",
  requirePermissionOrLegacy("requirement:review"),
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
      res
        .status(400)
        .json({ error: "Select at least two requirements to merge" });
      return;
    }
    if (!requestedIds.includes(survivorId)) {
      res
        .status(400)
        .json({ error: "Survivor must be one of the selected requirements" });
      return;
    }

    const user = getLocalUser(req);
    try {
      const result = await db.transaction(
        async (tx) => {
          // Lock the selected rows so a concurrent edit/merge can't race us into
          // re-pointing links onto a row that's being deleted.
          const rows = await tx
            .select()
            .from(requirements)
            .where(inArray(requirements.id, requestedIds))
            .for("update");

          // Every selected row must exist and belong to this project, or the
          // merge is ambiguous and we refuse it wholesale.
          if (
            rows.length !== requestedIds.length ||
            rows.some((r) => r.projectId !== projectId)
          ) {
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
              sourceDocName: r.sourceDocId
                ? (nameById.get(r.sourceDocId) ?? null)
                : null,
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

          await tx
            .delete(requirements)
            .where(inArray(requirements.id, mergedIds));

          const [updated] = await tx
            .update(requirements)
            .set({
              mergedCitations: JSON.stringify(combined),
              version: sql`${requirements.version} + 1`,
              updatedAt: new Date(),
            })
            .where(eq(requirements.id, survivorId))
            .returning();

          await writeAuditTx(tx, {
            user,
            organisationId: getOrganisationId(req),
            projectId,
            eventType: "requirement.merged",
            objectType: "requirement",
            objectId: survivorId,
            details: `${mergedIds.length} merged into survivor`,
          });
          return { updated, mergedCount: mergedIds.length };
        },
        { isolationLevel: "read committed" },
      );

      if ("error" in result) {
        res.status(404).json({
          error: "One or more requirements not found in this project",
        });
        return;
      }

      const sourceDocName = result.updated.sourceDocId
        ? ((
            await db
              .select({ filename: documents.filename })
              .from(documents)
              .where(eq(documents.id, result.updated.sourceDocId))
          )[0]?.filename ?? null)
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
  requirePermissionOrLegacy("requirement:read"),
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

router.delete(
  "/requirements/:id",
  requirePermissionOrLegacy("requirement:write"),
  async (req: Request, res: Response) => {
    const deleted = await db.transaction(
      async (tx) => {
        const [requirement] = await tx
          .delete(requirements)
          .where(eq(requirements.id, String(req.params.id)))
          .returning();
        if (!requirement) return undefined;
        await writeAuditTx(tx, {
          user: getLocalUser(req),
          organisationId: getOrganisationId(req),
          projectId: requirement.projectId,
          eventType: "requirement.deleted",
          objectType: "requirement",
          objectId: requirement.id,
        });
        return requirement;
      },
      { isolationLevel: "read committed" },
    );
    if (!deleted) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.status(204).end();
  },
);

export default router;
