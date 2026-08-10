import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, desc, sql } from "drizzle-orm";
import {
  db,
  defects,
  requirements,
  evidenceItems,
  projects,
} from "@workspace/db";
import { CreateDefectBody, UpdateDefectBody } from "@workspace/api-zod";
import { getLocalUser } from "../middlewares/auth";
import {
  getOrganisationId,
  hasRequestPermission,
  parseExpectedVersion,
  requirePermissionOrLegacy,
} from "../middlewares/tenancy";
import { serializeDefect } from "../lib/serializers";
import { writeAuditTx } from "../lib/audit";
import { suggestDefects } from "../lib/llm";
import { isDirectDefectMutationAllowed } from "../lib/defectGovernance";
import type { Severity } from "../lib/deterministic";
import { isApprovedEvidence } from "../lib/reviewIntegrityPolicy";
import { holdTenantDatabaseUntilComplete } from "../middlewares/databaseTenancy";
import { sendAiGatewayError } from "../lib/aiHttp";

const router: IRouter = Router();

router.get(
  "/projects/:id/defects",
  requirePermissionOrLegacy("defect:read"),
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
  requirePermissionOrLegacy("defect:write"),
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
      const allRequirements = await db
        .select()
        .from(requirements)
        .where(eq(requirements.projectId, project.id));
      const reviewedRequirements = allRequirements.filter((requirement) =>
        ["confirmed", "edited"].includes(requirement.reviewStatus),
      );
      const reviewedRequirementIds = new Set(
        reviewedRequirements.map((requirement) => requirement.id),
      );
      const confirmedEvidence = (
        await db
          .select()
          .from(evidenceItems)
          .where(eq(evidenceItems.projectId, project.id))
      ).filter(
        (evidence) =>
          reviewedRequirementIds.has(evidence.requirementId) &&
          isApprovedEvidence(evidence),
      );
      if (reviewedRequirements.length === 0) {
        res
          .status(400)
          .json({ error: "No reviewed requirements available to analyse" });
        return;
      }
      try {
        const { defects: suggested, model } = await suggestDefects(
          project.id,
          reviewedRequirements.map((requirement) => ({
            id: requirement.id,
            text: requirement.text,
            isMandatory: requirement.isMandatory,
          })),
          confirmedEvidence.map((evidence) => ({
            requirementId: evidence.requirementId,
            evidenceStatus: evidence.evidenceStatus,
            notes: evidence.notes,
          })),
          { signal: disconnectController.signal },
        );
        const inserted = await db.transaction(
          async (tx) => {
            const created = suggested.length
              ? await tx
                  .insert(defects)
                  .values(
                    suggested.map((defect) => ({
                      organisationId,
                      projectId: project.id,
                      requirementId:
                        defect.requirementId &&
                        reviewedRequirementIds.has(defect.requirementId)
                          ? defect.requirementId
                          : null,
                      type: defect.type,
                      severity: defect.severity,
                      description: defect.description,
                      remediation: defect.remediation ?? null,
                      status: "suggested",
                      suggested: true,
                    })),
                  )
                  .returning()
              : [];
            await writeAuditTx(tx, {
              user: getLocalUser(req),
              organisationId,
              projectId: project.id,
              eventType: "defects.suggested",
              objectType: "project",
              objectId: project.id,
              details: `${created.length} suggested from ${reviewedRequirements.length} reviewed requirement(s) and ${confirmedEvidence.length} confirmed evidence item(s)`,
            });
            return created;
          },
          { isolationLevel: "read committed" },
        );
        res.json({
          created: inserted.length,
          model,
          defects: inserted.map((defect) => serializeDefect(defect)),
        });
      } catch (error) {
        workflowError = error;
        req.log.error({ err: error }, "defect suggestion failed");
        if (
          !disconnectController.signal.aborted &&
          !res.headersSent &&
          !sendAiGatewayError(res, error)
        ) {
          res.status(502).json({ error: "AI defect suggestion failed" });
        }
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
  "/defects",
  requirePermissionOrLegacy("defect:review"),
  async (req: Request, res: Response) => {
    const parsed = CreateDefectBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    if (parsed.data.status !== undefined && parsed.data.status !== "open") {
      res.status(409).json({
        error:
          "New defects must start open; dispositions require a governed defect decision.",
      });
      return;
    }
    const organisationId = getOrganisationId(req);
    const created = await db.transaction(
      async (tx) => {
        const [defect] = await tx
          .insert(defects)
          .values({
            ...parsed.data,
            organisationId,
            suggested: false,
            status: parsed.data.status ?? "open",
          })
          .returning();
        await writeAuditTx(tx, {
          user: getLocalUser(req),
          organisationId,
          projectId: defect.projectId,
          eventType: "defect.created",
          objectType: "defect",
          objectId: defect.id,
        });
        return defect;
      },
      { isolationLevel: "read committed" },
    );
    res.status(201).json(serializeDefect(created));
  },
);

router.patch(
  "/defects/:id",
  requirePermissionOrLegacy("defect:write"),
  async (req: Request, res: Response) => {
    const parsed = UpdateDefectBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    const [existing] = await db
      .select()
      .from(defects)
      .where(eq(defects.id, String(req.params.id)));
    if (!existing) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const expectedVersion = parseExpectedVersion(req.header("if-match"));
    if (expectedVersion === null) {
      res.status(428).json({ error: "A valid If-Match version is required" });
      return;
    }
    if (
      !isDirectDefectMutationAllowed({
        currentStatus: existing.status,
        proposedStatus: parsed.data.status,
        currentSeverity: existing.severity as Severity,
        proposedSeverity: parsed.data.severity as Severity | undefined,
      })
    ) {
      res.status(409).json({
        error:
          "Disposition and severity downgrades require a governed defect decision with evidence and independent approval.",
      });
      return;
    }
    const isReviewDecision =
      parsed.data.status !== undefined ||
      (parsed.data.severity !== undefined &&
        parsed.data.severity !== existing.severity);
    if (isReviewDecision && !hasRequestPermission(req, "defect:review")) {
      res.status(403).json({ error: "Defect review permission required" });
      return;
    }
    const updated = await db.transaction(
      async (tx) => {
        const [defect] = await tx
          .update(defects)
          .set({
            ...parsed.data,
            version: sql`${defects.version} + 1`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(defects.id, String(req.params.id)),
              eq(defects.version, expectedVersion),
            ),
          )
          .returning();
        if (!defect) return undefined;
        await writeAuditTx(tx, {
          user: getLocalUser(req),
          organisationId: getOrganisationId(req),
          projectId: defect.projectId,
          eventType: "defect.updated",
          objectType: "defect",
          objectId: defect.id,
          details: parsed.data.status
            ? `status=${parsed.data.status}`
            : undefined,
        });
        return defect;
      },
      { isolationLevel: "read committed" },
    );
    if (!updated) {
      res.status(409).json({ error: "Defect changed; reload before retrying" });
      return;
    }
    res.json(serializeDefect(updated));
  },
);

router.delete(
  "/defects/:id",
  requirePermissionOrLegacy("defect:review"),
  async (req: Request, res: Response) => {
    void req;
    res.status(409).json({
      error:
        "Defects are immutable; supersede them through a governed defect decision.",
    });
  },
);

export default router;
