import { Router, type IRouter, type Request, type Response } from "express";
import { sql, eq, and, inArray } from "drizzle-orm";
import { db, projects, defects, reports } from "@workspace/db";
import { requireMember } from "../middlewares/auth";

const router: IRouter = Router();

const OPEN_STATUSES = ["intake", "extraction", "review", "defects", "reporting"];
const PAID_OUTCOMES = ["paid_autopsy", "paid_mandate", "retainer_offer"];

router.get(
  "/dashboard/metrics",
  requireMember,
  async (_req: Request, res: Response) => {
    const allProjects = await db
      .select({ id: projects.id, status: projects.status, outcome: projects.outcome, segment: projects.segment })
      .from(projects);

    const totalProjects = allProjects.length;
    const openProjects = allProjects.filter((p) => OPEN_STATUSES.includes(p.status)).length;
    const paidMandates = allProjects.filter((p) => p.outcome === "paid_mandate").length;
    const packagesShared = allProjects.filter((p) => PAID_OUTCOMES.includes(p.outcome) || p.status === "exported").length;

    const [{ signedOff }] = await db
      .select({ signedOff: sql<number>`count(*)::int` })
      .from(reports)
      .where(eq(reports.status, "signed_off"));

    // Material defect rate: share of projects with at least one fatal/likely_fatal defect.
    const projectIds = allProjects.map((p) => p.id);
    let materialDefectPackages = 0;
    let auditedPackages = 0;
    if (projectIds.length > 0) {
      // Material-defect rate counts only OPEN fatal/likely-fatal defects, to
      // match the deterministic risk core (which excludes suggested/remediated/
      // waived). Counting unconfirmed suggestions here would overstate the KPI
      // and contradict per-project risk on the same data.
      const withMaterial = await db
        .selectDistinct({ projectId: defects.projectId })
        .from(defects)
        .where(
          and(
            inArray(defects.severity, ["fatal", "likely_fatal"]),
            eq(defects.status, "open"),
          ),
        );
      materialDefectPackages = withMaterial.length;
      // Denominator: packages with at least one confirmed-live defect.
      const withAny = await db
        .selectDistinct({ projectId: defects.projectId })
        .from(defects)
        .where(eq(defects.status, "open"));
      auditedPackages = withAny.length;
    }
    const materialDefectRate = auditedPackages > 0 ? materialDefectPackages / auditedPackages : 0;

    const bucket = (items: { [k: string]: string | null }[], key: string) => {
      const map = new Map<string, number>();
      for (const it of items) {
        const v = it[key] ?? "unknown";
        map.set(v, (map.get(v) ?? 0) + 1);
      }
      return Array.from(map.entries()).map(([k, count]) => ({ key: k, count }));
    };

    res.json({
      totalProjects,
      openProjects,
      signedOffReports: Number(signedOff),
      paidMandates,
      packagesShared,
      materialDefectRate: Math.round(materialDefectRate * 1000) / 1000,
      materialDefectPackages,
      auditedPackages,
      statusBreakdown: bucket(allProjects, "status"),
      outcomeBreakdown: bucket(allProjects, "outcome"),
      segmentBreakdown: bucket(allProjects, "segment"),
    });
  },
);

export default router;
