import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, gte, lt } from "drizzle-orm";
import { db, llmRuns, projects } from "@workspace/db";
import {
  getOrganisationId,
  requirePermissionOrLegacy,
} from "../middlewares/tenancy";
import { summarizeUsage, UNIT_ASSUMPTION_KOBO } from "../lib/cost";

const router: IRouter = Router();

/**
 * Cost telemetry (FR-ANL-03): per-engagement model cost derived from the
 * token counts every llm_runs row now carries. Estimates are computed at
 * read time from configured rates, never stored, so a rate correction
 * retroactively fixes all figures.
 */
router.get(
  "/projects/:id/cost",
  requirePermissionOrLegacy("project:read"),
  async (req: Request, res: Response) => {
    const projectId = String(req.params.id);
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, projectId));
    if (!project) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const rows = await db
      .select({
        task: llmRuns.task,
        promptTokens: llmRuns.promptTokens,
        completionTokens: llmRuns.completionTokens,
      })
      .from(llmRuns)
      .where(eq(llmRuns.projectId, projectId));

    const byTask = new Map<
      string,
      { runs: number; promptTokens: number; completionTokens: number }
    >();
    for (const row of rows) {
      const entry = byTask.get(row.task) ?? {
        runs: 0,
        promptTokens: 0,
        completionTokens: 0,
      };
      entry.runs += 1;
      entry.promptTokens += row.promptTokens ?? 0;
      entry.completionTokens += row.completionTokens ?? 0;
      byTask.set(row.task, entry);
    }
    const total = summarizeUsage(rows);
    res.json({
      projectId,
      runs: rows.length,
      promptTokens: total.promptTokens,
      completionTokens: total.completionTokens,
      estimatedKobo: total.estimatedKobo,
      tasks: [...byTask.entries()].map(([task, t]) => ({ task, ...t })),
    });
  },
);

/**
 * Monthly variance report (FR-ANL-03 acceptance): per-engagement cost for a
 * calendar month against the BP §8.2 ₦15–30k unit assumption.
 */
router.get(
  "/analytics/cost",
  requirePermissionOrLegacy("analytics:read"),
  async (req: Request, res: Response) => {
    const month = String(req.query.month ?? "");
    if (!/^\d{4}-\d{2}$/.test(month)) {
      res.status(400).json({ error: "month must be YYYY-MM" });
      return;
    }
    const start = new Date(`${month}-01T00:00:00.000Z`);
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + 1);

    const rows = await db
      .select({
        projectId: llmRuns.projectId,
        tenderTitle: projects.tenderTitle,
        promptTokens: llmRuns.promptTokens,
        completionTokens: llmRuns.completionTokens,
      })
      .from(llmRuns)
      .leftJoin(projects, eq(llmRuns.projectId, projects.id))
      .where(
        and(
          gte(llmRuns.createdAt, start),
          lt(llmRuns.createdAt, end),
          getOrganisationId(req)
            ? eq(llmRuns.organisationId, getOrganisationId(req)!)
            : undefined,
        ),
      );

    const byProject = new Map<
      string,
      {
        projectId: string | null;
        tenderTitle: string | null;
        runs: number;
        promptTokens: number;
        completionTokens: number;
      }
    >();
    for (const row of rows) {
      const key = row.projectId ?? "(no engagement)";
      const entry = byProject.get(key) ?? {
        projectId: row.projectId,
        tenderTitle: row.tenderTitle ?? null,
        runs: 0,
        promptTokens: 0,
        completionTokens: 0,
      };
      entry.runs += 1;
      entry.promptTokens += row.promptTokens ?? 0;
      entry.completionTokens += row.completionTokens ?? 0;
      byProject.set(key, entry);
    }

    const total = summarizeUsage(rows);
    const engagements = [...byProject.values()].map((e) => {
      const est = summarizeUsage([e]);
      return {
        projectId: e.projectId,
        tenderTitle: e.tenderTitle,
        runs: e.runs,
        promptTokens: e.promptTokens,
        completionTokens: e.completionTokens,
        estimatedKobo: est.estimatedKobo,
        withinUnitAssumption: est.estimatedKobo <= UNIT_ASSUMPTION_KOBO.high,
      };
    });

    res.json({
      month,
      unitAssumptionKobo: UNIT_ASSUMPTION_KOBO,
      totalRuns: rows.length,
      totalPromptTokens: total.promptTokens,
      totalCompletionTokens: total.completionTokens,
      totalEstimatedKobo: total.estimatedKobo,
      engagements,
    });
  },
);

export default router;
