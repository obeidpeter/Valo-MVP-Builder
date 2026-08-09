import { Router, type IRouter, type Request, type Response } from "express";
import { sql, eq, and, inArray } from "drizzle-orm";
import {
  db,
  projects,
  clients,
  documents,
  defects,
  reports,
} from "@workspace/db";
import {
  getOrganisationId,
  requirePermissionOrLegacy,
} from "../middlewares/tenancy";
import { assembleGate0 } from "../lib/deterministic";

// A "quality" mandate (Build Brief §17) is a real advisory engagement, not
// autopsy-only revenue.
const QUALITY_MANDATE_KINDS = ["assisted_bid", "retainer"];
// NDA is in place for sharing when it is signed or explicitly not required.
const NDA_OK_STATUSES = ["signed", "not_required"];

const router: IRouter = Router();

const OPEN_STATUSES = [
  "intake",
  "extraction",
  "review",
  "defects",
  "reporting",
];
const PAID_OUTCOMES = ["paid_autopsy", "paid_mandate", "retainer_offer"];

router.get(
  "/dashboard/metrics",
  requirePermissionOrLegacy("analytics:read"),
  async (req: Request, res: Response) => {
    const organisationId = getOrganisationId(req);
    const allProjects = await db
      .select({
        id: projects.id,
        status: projects.status,
        outcome: projects.outcome,
        segment: projects.segment,
        mandateQuality: projects.mandateQuality,
      })
      .from(projects)
      .where(
        organisationId
          ? eq(projects.organisationId, organisationId)
          : undefined,
      );

    const totalProjects = allProjects.length;
    const openProjects = allProjects.filter((p) =>
      OPEN_STATUSES.includes(p.status),
    ).length;
    const paidMandates = allProjects.filter(
      (p) => p.outcome === "paid_mandate",
    ).length;
    const packagesShared = allProjects.filter(
      (p) => PAID_OUTCOMES.includes(p.outcome) || p.status === "exported",
    ).length;
    // Gate 0 mandate quality: only PAID mandates that are an assisted bid or
    // retainer count (Build Brief §17 — "≥1 paid mandate is assisted-bid/
    // retainer, not autopsy-only"). A quality label on a non-paid project must
    // not inflate readiness.
    const qualityMandates = allProjects.filter(
      (p) =>
        p.outcome === "paid_mandate" &&
        QUALITY_MANDATE_KINDS.includes(p.mandateQuality ?? "none"),
    ).length;

    const [{ signedOff }] = await db
      .select({ signedOff: sql<number>`count(*)::int` })
      .from(reports)
      .where(
        and(
          eq(reports.status, "signed_off"),
          organisationId
            ? eq(reports.organisationId, organisationId)
            : undefined,
        ),
      );

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
            inArray(defects.projectId, projectIds),
          ),
        );
      materialDefectPackages = withMaterial.length;
      // Denominator: packages with at least one confirmed-live defect.
      const withAny = await db
        .selectDistinct({ projectId: defects.projectId })
        .from(defects)
        .where(
          and(
            eq(defects.status, "open"),
            inArray(defects.projectId, projectIds),
          ),
        );
      auditedPackages = withAny.length;
    }
    const materialDefectRate =
      auditedPackages > 0 ? materialDefectPackages / auditedPackages : 0;

    // Gate 0 decision-maker conversations: sum across clients, kept distinct
    // from junior contacts (Build Brief §17).
    const [{ dmConversations }] = await db
      .select({
        dmConversations: sql<number>`coalesce(sum(${clients.decisionMakerConversations}), 0)::int`,
      })
      .from(clients)
      .where(
        organisationId ? eq(clients.organisationId, organisationId) : undefined,
      );

    // Gate 0 "packages shared under NDA": projects that are a tender+bid pair
    // (at least one tender document AND one bid document) whose client NDA is
    // signed or not required.
    const [{ ndaPairs }] = await db
      .select({ ndaPairs: sql<number>`count(*)::int` })
      .from(projects)
      .innerJoin(clients, eq(projects.clientId, clients.id))
      .where(
        and(
          inArray(clients.ndaStatus, NDA_OK_STATUSES),
          organisationId
            ? eq(projects.organisationId, organisationId)
            : undefined,
          sql`exists (select 1 from ${documents} d where d.project_id = ${projects.id} and d.type = 'tender')`,
          sql`exists (select 1 from ${documents} d where d.project_id = ${projects.id} and d.type = 'bid')`,
        ),
      );

    const gate0 = assembleGate0({
      decisionMakerConversations: Number(dmConversations),
      packagesUnderNda: Number(ndaPairs),
      materialDefectRate,
      paidMandates,
      mandateQuality: qualityMandates,
    });

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
      gate0,
    });
  },
);

export default router;
