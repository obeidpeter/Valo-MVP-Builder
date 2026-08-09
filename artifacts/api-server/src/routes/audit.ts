import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, gte, lt } from "drizzle-orm";
import {
  db,
  auditEvents,
  clients,
  legacyAuditEvents,
  legacyAuditIntegrityAssessments,
  projects,
} from "@workspace/db";
import {
  getOrganisationId,
  requirePermissionOrLegacy,
} from "../middlewares/tenancy";
import { serializeAudit } from "../lib/serializers";
import { mergeAuditEventPresentations } from "../lib/auditPresentation";

const router: IRouter = Router();

function csvEscape(value: unknown): string {
  let s = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function monthWindow(month?: string): { start: Date; end: Date } | null {
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return null;
  const start = new Date(`${month}-01T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) return null;
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  return { start, end };
}

router.get(
  "/projects/:id/audit",
  requirePermissionOrLegacy("audit:read"),
  async (req: Request, res: Response) => {
    const organisationId = getOrganisationId(req)!;
    const [active, archived] = await Promise.all([
      db
        .select()
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.organisationId, organisationId),
            eq(auditEvents.projectId, String(req.params.id)),
          ),
        )
        .orderBy(desc(auditEvents.createdAt)),
      db
        .select()
        .from(legacyAuditEvents)
        .where(
          and(
            eq(legacyAuditEvents.organisationId, organisationId),
            eq(legacyAuditEvents.projectId, String(req.params.id)),
          ),
        )
        .orderBy(desc(legacyAuditEvents.createdAt)),
    ]);
    res.json(
      mergeAuditEventPresentations(
        active.map(serializeAudit),
        archived.map((row) => ({
          ...serializeAudit(row),
          integrityStatus: row.integrityStatus as
            | "payload_hash_verified"
            | "known_discontinuity",
        })),
      ),
    );
  },
);

router.get(
  "/audit/legacy-integrity-assessment",
  requirePermissionOrLegacy("audit:read"),
  async (req: Request, res: Response) => {
    const organisationId = getOrganisationId(req)!;
    const rows = await db
      .select()
      .from(legacyAuditIntegrityAssessments)
      .where(eq(legacyAuditIntegrityAssessments.organisationId, organisationId))
      .orderBy(desc(legacyAuditIntegrityAssessments.assessedAt));
    res.json(
      rows.map((row) => ({
        ...row,
        integrityStatus: "KNOWN_DISCONTINUITY",
      })),
    );
  },
);

router.get(
  "/audit/access-review",
  requirePermissionOrLegacy("audit:read"),
  async (req: Request, res: Response) => {
    const window = monthWindow(req.query.month as string | undefined);
    if (!window) {
      res
        .status(400)
        .json({ error: "month query parameter is required in YYYY-MM format" });
      return;
    }

    const [activeRows, archivedRows] = await Promise.all([
      db
        .select({
          audit: auditEvents,
          tenderTitle: projects.tenderTitle,
          clientName: clients.name,
        })
        .from(auditEvents)
        .leftJoin(projects, eq(auditEvents.projectId, projects.id))
        .leftJoin(clients, eq(projects.clientId, clients.id))
        .where(
          and(
            gte(auditEvents.createdAt, window.start),
            lt(auditEvents.createdAt, window.end),
            getOrganisationId(req)
              ? eq(auditEvents.organisationId, getOrganisationId(req)!)
              : undefined,
          ),
        ),
      db
        .select({
          audit: legacyAuditEvents,
          tenderTitle: projects.tenderTitle,
          clientName: clients.name,
        })
        .from(legacyAuditEvents)
        .leftJoin(projects, eq(legacyAuditEvents.projectId, projects.id))
        .leftJoin(clients, eq(projects.clientId, clients.id))
        .where(
          and(
            gte(legacyAuditEvents.createdAt, window.start),
            lt(legacyAuditEvents.createdAt, window.end),
            getOrganisationId(req)
              ? eq(legacyAuditEvents.organisationId, getOrganisationId(req)!)
              : undefined,
          ),
        ),
    ]);

    const rows = [
      ...activeRows.map((row) => ({
        ...row,
        auditSource: "active_v2",
        integrityStatus: "active_v2_record",
      })),
      ...archivedRows.map((row) => ({
        ...row,
        auditSource: "legacy_v1_archive",
        integrityStatus: row.audit.integrityStatus,
      })),
    ];

    const accessRows = rows
      .filter((r) =>
        /^(document|report|project)\.(viewed|exported|export_denied|downloaded|integrity_|deleted)/.test(
          r.audit.eventType,
        ),
      )
      .map((r) => ({
        at:
          r.audit.createdAt instanceof Date
            ? r.audit.createdAt.toISOString()
            : String(r.audit.createdAt),
        actor: r.audit.userName ?? "unknown",
        client: r.clientName ?? "",
        project: r.tenderTitle ?? "",
        action: r.audit.eventType,
        objectType: r.audit.objectType ?? "",
        objectId: r.audit.objectId ?? "",
        details: r.audit.details ?? "",
        auditSource: r.auditSource,
        integrityStatus: r.integrityStatus,
      }));

    if (req.query.format === "csv") {
      const headers = [
        "at",
        "actor",
        "client",
        "project",
        "action",
        "objectType",
        "objectId",
        "details",
        "auditSource",
        "integrityStatus",
      ];
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="access-review-${req.query.month}.csv"`,
      );
      res.send(
        [
          headers.join(","),
          ...accessRows.map((row) =>
            headers.map((h) => csvEscape(row[h as keyof typeof row])).join(","),
          ),
        ].join("\n"),
      );
      return;
    }

    res.json({ month: req.query.month, rows: accessRows });
  },
);

export default router;
