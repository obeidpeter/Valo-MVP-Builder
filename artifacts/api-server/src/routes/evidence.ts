import { Router, type IRouter, type Request, type Response } from "express";
import { eq, desc, sql } from "drizzle-orm";
import {
  db,
  evidenceItems,
  requirements,
  documents,
  projects,
} from "@workspace/db";
import { CreateEvidenceBody, UpdateEvidenceBody } from "@workspace/api-zod";
import { getLocalUser } from "../middlewares/auth";
import {
  getAccessContext,
  getOrganisationId,
  requirePermissionOrLegacy,
} from "../middlewares/tenancy";
import { serializeEvidence } from "../lib/serializers";
import { writeAuditTx } from "../lib/audit";
import { mapEvidence } from "../lib/llm";

const router: IRouter = Router();

router.get(
  "/projects/:id/evidence",
  requirePermissionOrLegacy("evidence:read"),
  async (req: Request, res: Response) => {
    const rows = await db
      .select({
        ev: evidenceItems,
        requirementText: requirements.text,
        documentName: documents.filename,
      })
      .from(evidenceItems)
      .leftJoin(requirements, eq(evidenceItems.requirementId, requirements.id))
      .leftJoin(documents, eq(evidenceItems.documentId, documents.id))
      .where(eq(evidenceItems.projectId, String(req.params.id)))
      .orderBy(desc(evidenceItems.createdAt));
    res.json(
      rows.map((r) =>
        serializeEvidence(r.ev, {
          requirementText: r.requirementText,
          documentName: r.documentName,
        }),
      ),
    );
  },
);

router.post(
  "/projects/:id/map-evidence",
  requirePermissionOrLegacy("evidence:write"),
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
    const confirmedReqs = await db
      .select()
      .from(requirements)
      .where(eq(requirements.projectId, project.id));
    const usable = confirmedReqs.filter((r) =>
      ["confirmed", "edited"].includes(r.reviewStatus),
    );
    if (usable.length === 0) {
      res
        .status(400)
        .json({ error: "No confirmed requirements to map evidence against" });
      return;
    }
    const bidDocs = (
      await db
        .select()
        .from(documents)
        .where(eq(documents.projectId, project.id))
    ).filter(
      (d) =>
        d.contentText &&
        d.redactionStatus !== "excluded" &&
        d.type !== "tender",
    );
    const docsForLlm = bidDocs.length > 0 ? bidDocs : [];

    try {
      const { items, model } = await mapEvidence(
        project.id,
        usable.map((r) => ({
          id: r.id,
          text: r.text,
          expectedEvidence: r.expectedEvidence,
        })),
        docsForLlm.map((d) => ({
          id: d.id,
          filename: d.filename,
          type: d.type,
          contentText: d.contentText,
        })),
      );
      const validDocIds = new Set(bidDocs.map((d) => d.id));
      const inserted = await db.transaction(
        async (tx) => {
          const created = items.length
            ? await tx
                .insert(evidenceItems)
                .values(
                  items.map((i) => ({
                    organisationId,
                    projectId: project.id,
                    requirementId: i.requirementId,
                    documentId:
                      i.documentId && validDocIds.has(i.documentId)
                        ? i.documentId
                        : null,
                    evidenceStatus: i.evidenceStatus ?? "pending",
                    excerpt: i.excerpt ?? null,
                    notes: i.notes ?? null,
                    suggested: true,
                  })),
                )
                .returning()
            : [];
          if (project.status === "extraction") {
            await tx
              .update(projects)
              .set({
                status: "review",
                version: sql`${projects.version} + 1`,
                updatedAt: new Date(),
              })
              .where(eq(projects.id, project.id));
          }
          await writeAuditTx(tx, {
            user: getLocalUser(req),
            organisationId,
            projectId: project.id,
            eventType: "evidence.mapped",
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
        items: inserted.map((e) => serializeEvidence(e)),
      });
    } catch (error) {
      req.log.error({ err: error }, "evidence mapping failed");
      res.status(502).json({ error: "LLM evidence mapping failed" });
    }
  },
);

router.post(
  "/evidence",
  requirePermissionOrLegacy("evidence:write"),
  async (req: Request, res: Response) => {
    const parsed = CreateEvidenceBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    const context = getAccessContext(req);
    const isApproval = parsed.data.evidenceStatus !== "pending";
    if (isApproval && context && !context.permissions.has("evidence:approve")) {
      res.status(403).json({ error: "Evidence approval permission required" });
      return;
    }
    const user = getLocalUser(req);
    const organisationId = getOrganisationId(req);
    const created = await db.transaction(
      async (tx) => {
        const [evidence] = await tx
          .insert(evidenceItems)
          .values({
            ...parsed.data,
            organisationId,
            suggested: false,
            confirmedBy: isApproval ? (user?.id ?? null) : null,
          })
          .returning();
        await writeAuditTx(tx, {
          user,
          organisationId,
          projectId: evidence.projectId,
          eventType: "evidence.created",
          objectType: "evidence",
          objectId: evidence.id,
        });
        return evidence;
      },
      { isolationLevel: "read committed" },
    );
    res.status(201).json(serializeEvidence(created));
  },
);

router.patch(
  "/evidence/:id",
  requirePermissionOrLegacy("evidence:write"),
  async (req: Request, res: Response) => {
    const parsed = UpdateEvidenceBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    const context = getAccessContext(req);
    const isApproval =
      parsed.data.evidenceStatus !== undefined &&
      parsed.data.evidenceStatus !== "pending";
    if (isApproval && context && !context.permissions.has("evidence:approve")) {
      res.status(403).json({ error: "Evidence approval permission required" });
      return;
    }
    const user = getLocalUser(req);
    const updated = await db.transaction(
      async (tx) => {
        const [evidence] = await tx
          .update(evidenceItems)
          .set({
            ...parsed.data,
            ...(isApproval ? { confirmedBy: user?.id ?? null } : {}),
            version: sql`${evidenceItems.version} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(evidenceItems.id, String(req.params.id)))
          .returning();
        if (!evidence) return undefined;
        await writeAuditTx(tx, {
          user,
          organisationId: getOrganisationId(req),
          projectId: evidence.projectId,
          eventType: "evidence.updated",
          objectType: "evidence",
          objectId: evidence.id,
        });
        return evidence;
      },
      { isolationLevel: "read committed" },
    );
    if (!updated) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(serializeEvidence(updated));
  },
);

router.delete(
  "/evidence/:id",
  requirePermissionOrLegacy("evidence:write"),
  async (req: Request, res: Response) => {
    const deleted = await db.transaction(
      async (tx) => {
        const [evidence] = await tx
          .delete(evidenceItems)
          .where(eq(evidenceItems.id, String(req.params.id)))
          .returning();
        if (!evidence) return undefined;
        await writeAuditTx(tx, {
          user: getLocalUser(req),
          organisationId: getOrganisationId(req),
          projectId: evidence.projectId,
          eventType: "evidence.deleted",
          objectType: "evidence",
          objectId: evidence.id,
        });
        return evidence;
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
