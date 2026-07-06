import { Router, type IRouter, type Request, type Response } from "express";
import { eq, desc } from "drizzle-orm";
import { db, boqChecks, defects } from "@workspace/db";
import { RunBoqChecksBody } from "@workspace/api-zod";
import { requireMember, getLocalUser } from "../middlewares/auth";
import { serializeBoqCheck, serializeDefect } from "../lib/serializers";
import { writeAudit } from "../lib/audit";
import { runBoqChecks } from "../lib/deterministic";

const router: IRouter = Router();

router.get(
  "/projects/:id/boq-checks",
  requireMember,
  async (req: Request, res: Response) => {
    const rows = await db
      .select()
      .from(boqChecks)
      .where(eq(boqChecks.projectId, String(req.params.id)))
      .orderBy(desc(boqChecks.createdAt));
    res.json(rows.map(serializeBoqCheck));
  },
);

router.post(
  "/projects/:id/run-boq-checks",
  requireMember,
  async (req: Request, res: Response) => {
    const parsed = RunBoqChecksBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    const { rows, grandTotal, tolerance, sourceDocId } = parsed.data;
    // Zero tolerance by default (FR-BOQ-01): one kobo of drift is a finding
    // unless the operator explicitly grants slack.
    const { findings, computedGrandTotal } = runBoqChecks(rows, grandTotal, tolerance ?? 0);

    const inserted = findings.length
      ? await db
          .insert(boqChecks)
          .values(
            findings.map((f) => ({
              projectId: String(req.params.id),
              sourceDocId: sourceDocId ?? null,
              lineRef: f.lineRef,
              description: f.description,
              quantity: f.quantity,
              unitRate: f.unitRate,
              extension: f.extension,
              computedExtension: f.computedExtension,
              quantityRaw: f.quantityRaw,
              unitRateKobo: f.unitRateKobo,
              extensionKobo: f.extensionKobo,
              computedExtensionKobo: f.computedExtensionKobo,
              checkType: f.checkType,
              finding: f.finding,
              severity: f.severity,
              status: f.status,
            })),
          )
          .returning()
      : [];

    await writeAudit({
      user: getLocalUser(req),
      projectId: String(req.params.id),
      eventType: "boq.checks_run",
      objectType: "project",
      objectId: String(req.params.id),
      details: `${rows.length} rows, ${findings.length} flagged`,
    });

    res.json({
      total: rows.length,
      flagged: findings.length,
      computedGrandTotal,
      checks: inserted.map(serializeBoqCheck),
    });
  },
);

router.post(
  "/boq-checks/:id/to-defect",
  requireMember,
  async (req: Request, res: Response) => {
    const [check] = await db.select().from(boqChecks).where(eq(boqChecks.id, String(req.params.id)));
    if (!check) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const [created] = await db
      .insert(defects)
      .values({
        projectId: check.projectId,
        type: "arithmetic",
        severity: check.severity,
        description: `BOQ ${check.checkType}${check.lineRef ? ` (line ${check.lineRef})` : ""}: ${check.finding}`,
        evidenceSnapshot: JSON.stringify({
          lineRef: check.lineRef,
          quantity: check.quantity,
          unitRate: check.unitRate,
          extension: check.extension,
          computedExtension: check.computedExtension,
          quantityRaw: check.quantityRaw,
          unitRateKobo: check.unitRateKobo,
          extensionKobo: check.extensionKobo,
          computedExtensionKobo: check.computedExtensionKobo,
        }),
        status: "open",
        suggested: false,
      })
      .returning();
    await db.update(boqChecks).set({ status: "pushed_to_defect" }).where(eq(boqChecks.id, check.id));
    await writeAudit({
      user: getLocalUser(req),
      projectId: check.projectId,
      eventType: "boq.pushed_to_defect",
      objectType: "defect",
      objectId: created.id,
    });
    res.status(201).json(serializeDefect(created));
  },
);

export default router;
