import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, gte, lt } from "drizzle-orm";
import { db, auditEvents, clients, projects } from "@workspace/db";
import {
  getOrganisationId,
  requirePermissionOrLegacy,
} from "../middlewares/tenancy";
import { serializeAudit } from "../lib/serializers";

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
    const rows = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.projectId, String(req.params.id)))
      .orderBy(desc(auditEvents.createdAt));
    res.json(rows.map(serializeAudit));
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

    const rows = await db
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
      )
      .orderBy(desc(auditEvents.createdAt));

    const accessRows = rows
      .filter((r) =>
        /^(document|report|project)\.(viewed|exported|downloaded|integrity_|deleted)/.test(
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
