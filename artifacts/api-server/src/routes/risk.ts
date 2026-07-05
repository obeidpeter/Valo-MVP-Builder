import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, projects, defects, requirements, evidenceItems } from "@workspace/db";
import { OverrideRiskBody } from "@workspace/api-zod";
import { requireMember, requireRoles, getLocalUser } from "../middlewares/auth";
import { writeAudit } from "../lib/audit";
import { computeRisk, type Severity } from "../lib/deterministic";

const router: IRouter = Router();

async function computeAndPersist(projectId: string) {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) return null;

  const defs = await db.select().from(defects).where(eq(defects.projectId, projectId));
  const reqs = await db.select().from(requirements).where(eq(requirements.projectId, projectId));
  const ev = await db.select().from(evidenceItems).where(eq(evidenceItems.projectId, projectId));

  const result = computeRisk({
    defects: defs.map((d) => ({ severity: d.severity as Severity, status: d.status })),
    requirements: reqs.map((r) => ({
      id: r.id,
      isMandatory: r.isMandatory,
      reviewStatus: r.reviewStatus,
    })),
    evidence: ev.map((e) => ({
      requirementId: e.requirementId,
      evidenceStatus: e.evidenceStatus,
      suggested: e.suggested,
    })),
  });

  await db
    .update(projects)
    .set({ riskScore: result.score, riskBand: result.band })
    .where(eq(projects.id, projectId));

  const band = project.riskOverrideBand || result.band;
  return {
    score: result.score,
    band,
    computedBand: result.band,
    overrideBand: project.riskOverrideBand ?? null,
    overrideNote: project.riskOverrideNote ?? null,
    overrideBy: project.riskOverrideBy ?? null,
    explanation: result.explanation,
    distribution: Object.entries(result.distribution).map(([key, count]) => ({
      key,
      count,
    })),
  };
}

router.get("/projects/:id/risk", requireMember, async (req: Request, res: Response) => {
  const assessment = await computeAndPersist(String(req.params.id));
  if (!assessment) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(assessment);
});

router.post(
  "/projects/:id/risk/override",
  requireRoles("admin", "reviewer"),
  async (req: Request, res: Response) => {
    const parsed = OverrideRiskBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    const user = getLocalUser(req);
    const reviewerName = user?.name || user?.email || "Unknown reviewer";
    const [updated] = await db
      .update(projects)
      .set({
        riskOverrideBand: parsed.data.band,
        riskOverrideNote: parsed.data.note,
        riskOverrideBy: reviewerName,
      })
      .where(eq(projects.id, String(req.params.id)))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    await writeAudit({
      user,
      projectId: updated.id,
      eventType: "risk.overridden",
      objectType: "project",
      objectId: updated.id,
      details: `${parsed.data.band} by ${reviewerName}: ${parsed.data.note}`,
    });
    const assessment = await computeAndPersist(String(req.params.id));
    res.json(assessment);
  },
);

router.delete(
  "/projects/:id/risk/override",
  requireRoles("admin", "reviewer"),
  async (req: Request, res: Response) => {
    const user = getLocalUser(req);
    const [updated] = await db
      .update(projects)
      .set({ riskOverrideBand: null, riskOverrideNote: null, riskOverrideBy: null })
      .where(eq(projects.id, String(req.params.id)))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    await writeAudit({
      user,
      projectId: updated.id,
      eventType: "risk.override_cleared",
      objectType: "project",
      objectId: updated.id,
      details: `Cleared by ${user?.name || user?.email || "Unknown reviewer"}`,
    });
    const assessment = await computeAndPersist(String(req.params.id));
    res.json(assessment);
  },
);

export default router;
