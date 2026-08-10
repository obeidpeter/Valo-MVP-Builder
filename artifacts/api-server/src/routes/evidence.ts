import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, desc, ne, sql } from "drizzle-orm";
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
  getOrganisationId,
  hasRequestPermission,
  requirePermissionOrLegacy,
} from "../middlewares/tenancy";
import { serializeEvidence } from "../lib/serializers";
import { writeAuditTx } from "../lib/audit";
import { mapEvidence } from "../lib/llm";
import {
  evidencePatchRequiresApproval,
  isApprovedEvidence,
} from "../lib/reviewIntegrityPolicy";
import { holdTenantDatabaseUntilComplete } from "../middlewares/databaseTenancy";
import { sendAiGatewayError } from "../lib/aiHttp";
import {
  groundedEvidenceStatus,
  ModelInputTooLargeError,
} from "../lib/sourceGrounding";

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
    const releaseTenantWork = holdTenantDatabaseUntilComplete(req);
    const disconnectController = new AbortController();
    const abortOnDisconnect = () => disconnectController.abort();
    res.once("close", abortOnDisconnect);
    let workflowError: unknown;
    try {
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
          { signal: disconnectController.signal },
        );
        const validDocIds = new Set(bidDocs.map((d) => d.id));
        const sourceTextByDocId = new Map(
          bidDocs.map((document) => [document.id, document.contentText ?? ""]),
        );
        const groundedItems = items.map((item) => ({
          ...item,
          evidenceStatus: groundedEvidenceStatus(
            item.evidenceStatus,
            sourceTextByDocId,
            item.documentId,
            item.excerpt,
          ),
        }));
        const downgraded = items.filter(
          (item, index) =>
            (item.evidenceStatus === "present" ||
              item.evidenceStatus === "expired") &&
            groundedItems[index]?.evidenceStatus === "unclear",
        ).length;
        const inserted = await db.transaction(
          async (tx) => {
            const created = groundedItems.length
              ? await tx
                  .insert(evidenceItems)
                  .values(
                    groundedItems.map((i) => ({
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
            await writeAuditTx(tx, {
              user: getLocalUser(req),
              organisationId,
              projectId: project.id,
              eventType: "evidence.mapped",
              objectType: "project",
              objectId: project.id,
              details: `${created.length} suggested; ${downgraded} unsupported positive assertion(s) downgraded to unclear`,
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
        if (error instanceof ModelInputTooLargeError) {
          if (!disconnectController.signal.aborted && !res.headersSent) {
            res.status(422).json({
              error: error.message,
              code: error.code,
              actualChars: error.actualChars,
              maxChars: error.maxChars,
            });
          }
          return;
        }
        workflowError = error;
        req.log.error({ err: error }, "evidence mapping failed");
        if (
          !disconnectController.signal.aborted &&
          !res.headersSent &&
          !sendAiGatewayError(res, error)
        )
          res.status(502).json({ error: "AI evidence mapping failed" });
      }
    } catch (error) {
      workflowError = error;
      throw error;
    } finally {
      res.off("close", abortOnDisconnect);
      releaseTenantWork(workflowError);
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
    const selectedSources = parsed.data.documentId
      ? await db
          .select({ id: documents.id, contentText: documents.contentText })
          .from(documents)
          .where(
            and(
              eq(documents.id, parsed.data.documentId),
              eq(documents.projectId, parsed.data.projectId),
              ne(documents.redactionStatus, "excluded"),
            ),
          )
      : [];
    const sourceTextByDocId = new Map(
      selectedSources.map((document) => [
        document.id,
        document.contentText ?? "",
      ]),
    );
    const groundedStatus = groundedEvidenceStatus(
      parsed.data.evidenceStatus,
      sourceTextByDocId,
      parsed.data.documentId,
      parsed.data.excerpt,
    );
    const groundingDowngraded = groundedStatus !== parsed.data.evidenceStatus;
    const isApproval = groundedStatus !== "pending";
    if (isApproval && !hasRequestPermission(req, "evidence:approve")) {
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
            evidenceStatus: groundedStatus,
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
          details: groundingDowngraded
            ? "Unsupported positive evidence assertion downgraded to unclear."
            : undefined,
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
    const user = getLocalUser(req);
    const canApprove = hasRequestPermission(req, "evidence:approve");
    const result = await db.transaction(
      async (tx) => {
        const [existing] = await tx
          .select()
          .from(evidenceItems)
          .where(eq(evidenceItems.id, String(req.params.id)))
          .for("update");
        if (!existing) return { kind: "not_found" } as const;
        const requiresApproval = evidencePatchRequiresApproval(
          existing,
          parsed.data,
        );
        if (requiresApproval && !canApprove) return { kind: "denied" } as const;
        // Preserve omission, but honour an explicit null. Using `??` here
        // would validate against the old source and then persist a null source,
        // allowing an apparently approved positive status to lose grounding.
        const nextDocumentId =
          parsed.data.documentId !== undefined
            ? parsed.data.documentId
            : existing.documentId;
        const nextExcerpt =
          parsed.data.excerpt !== undefined
            ? parsed.data.excerpt
            : existing.excerpt;
        const nextStatus =
          parsed.data.evidenceStatus ?? existing.evidenceStatus;
        const selectedSources = nextDocumentId
          ? await tx
              .select({ id: documents.id, contentText: documents.contentText })
              .from(documents)
              .where(
                and(
                  eq(documents.id, nextDocumentId),
                  eq(documents.projectId, existing.projectId),
                  ne(documents.redactionStatus, "excluded"),
                ),
              )
          : [];
        const sourceTextByDocId = new Map(
          selectedSources.map((document) => [
            document.id,
            document.contentText ?? "",
          ]),
        );
        const groundedStatus = groundedEvidenceStatus(
          nextStatus,
          sourceTextByDocId,
          nextDocumentId,
          nextExcerpt,
        );
        const groundingDowngraded = groundedStatus !== nextStatus;
        const establishesApproval =
          !isApprovedEvidence(existing) &&
          ((parsed.data.evidenceStatus !== undefined &&
            groundedStatus !== "pending") ||
            parsed.data.suggested === false);
        const confirmationPatch =
          groundedStatus === "pending"
            ? { confirmedBy: null }
            : establishesApproval
              ? { confirmedBy: user?.id ?? null }
              : {};

        const [evidence] = await tx
          .update(evidenceItems)
          .set({
            ...parsed.data,
            evidenceStatus: groundedStatus,
            ...confirmationPatch,
            version: sql`${evidenceItems.version} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(evidenceItems.id, String(req.params.id)))
          .returning();
        await writeAuditTx(tx, {
          user,
          organisationId: getOrganisationId(req),
          projectId: evidence.projectId,
          eventType: "evidence.updated",
          objectType: "evidence",
          objectId: evidence.id,
          details: groundingDowngraded
            ? "Unsupported positive evidence assertion downgraded to unclear."
            : undefined,
        });
        return { kind: "updated", evidence } as const;
      },
      { isolationLevel: "read committed" },
    );
    if (result.kind === "not_found") {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (result.kind === "denied") {
      res.status(403).json({ error: "Evidence approval permission required" });
      return;
    }
    res.json(serializeEvidence(result.evidence));
  },
);

router.delete(
  "/evidence/:id",
  requirePermissionOrLegacy("evidence:write"),
  async (req: Request, res: Response) => {
    const canApprove = hasRequestPermission(req, "evidence:approve");
    const result = await db.transaction(
      async (tx) => {
        const [existing] = await tx
          .select()
          .from(evidenceItems)
          .where(eq(evidenceItems.id, String(req.params.id)))
          .for("update");
        if (!existing) return { kind: "not_found" } as const;
        if (isApprovedEvidence(existing) && !canApprove)
          return { kind: "denied" } as const;
        const [evidence] = await tx
          .delete(evidenceItems)
          .where(eq(evidenceItems.id, String(req.params.id)))
          .returning();
        await writeAuditTx(tx, {
          user: getLocalUser(req),
          organisationId: getOrganisationId(req),
          projectId: evidence.projectId,
          eventType: "evidence.deleted",
          objectType: "evidence",
          objectId: evidence.id,
        });
        return { kind: "deleted", evidence } as const;
      },
      { isolationLevel: "read committed" },
    );
    if (result.kind === "not_found") {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (result.kind === "denied") {
      res.status(403).json({ error: "Evidence approval permission required" });
      return;
    }
    res.status(204).end();
  },
);

export default router;
