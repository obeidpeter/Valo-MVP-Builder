import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  db,
  clients,
  notificationEvents,
  projects,
  retentionRequests,
  vaultItems,
} from "@workspace/db";
import {
  CreateProjectNotificationBody,
  CreateRetentionRequestBody,
} from "@workspace/api-zod";
import { getLocalUser } from "../middlewares/auth";
import {
  getOrganisationId,
  requirePermissionOrLegacy,
} from "../middlewares/tenancy";
import { writeAudit } from "../lib/audit";
import { serializeNotification, serializeRetention } from "../lib/serializers";
import {
  computeExpiry,
  computeRedTeamDueAt,
  computeSlaDueAt,
  type SlaClass,
} from "../lib/deterministic";
import { getActiveConfig } from "../lib/appConfig";

const router: IRouter = Router();

const ACTIVE_STATUSES = [
  "intake",
  "extraction",
  "review",
  "defects",
  "reporting",
];

router.get(
  "/workflow/alerts",
  requirePermissionOrLegacy("project:read"),
  async (req: Request, res: Response) => {
    const now = new Date();
    const organisationId = getOrganisationId(req);
    const projectRows = await db
      .select()
      .from(projects)
      .where(
        and(
          inArray(projects.status, ACTIVE_STATUSES),
          organisationId
            ? eq(projects.organisationId, organisationId)
            : undefined,
        ),
      )
      .orderBy(desc(projects.createdAt));
    const vaultRows = await db
      .select({ item: vaultItems, clientName: clients.name })
      .from(vaultItems)
      .leftJoin(clients, eq(vaultItems.clientId, clients.id))
      .where(
        organisationId
          ? eq(vaultItems.organisationId, organisationId)
          : undefined,
      );

    const slaBreaches = projectRows
      .map((p) => {
        const dueAt = computeSlaDueAt(
          p.createdAt instanceof Date ? p.createdAt : new Date(p.createdAt),
          (p.slaClass ?? "standard") as SlaClass,
        );
        return {
          projectId: p.id,
          tenderTitle: p.tenderTitle,
          dueAt,
          breached: now > dueAt,
        };
      })
      .filter((a) => a.breached)
      .map((a) => ({ ...a, dueAt: a.dueAt.toISOString() }));

    // The red-team window opens 72h before the tender deadline and closes at
    // the deadline itself — a red-team prompt after submission is dead noise.
    const redTeamDue = projectRows.flatMap((p) => {
      const dueAt = computeRedTeamDueAt(p.deadline);
      if (!dueAt || now < dueAt) return [];
      const deadlineMs = p.deadline ? Date.parse(p.deadline) : Number.NaN;
      if (!Number.isNaN(deadlineMs) && now.getTime() > deadlineMs) return [];
      return [
        {
          projectId: p.id,
          tenderTitle: p.tenderTitle,
          dueAt: dueAt.toISOString(),
        },
      ];
    });

    const vaultExpiring = vaultRows
      .map(({ item, clientName }) => ({
        vaultItemId: item.id,
        clientId: item.clientId,
        clientName: clientName ?? null,
        artefactType: item.artefactType,
        expiry: computeExpiry(item.expiryDate, now, item.renewalLeadDays),
      }))
      .filter((v) =>
        ["expired", "critical", "warning", "upcoming"].includes(v.expiry.band),
      );

    res.json({ slaBreaches, redTeamDue, vaultExpiring });
  },
);

router.get(
  "/projects/:id/notifications",
  requirePermissionOrLegacy("project:read"),
  async (req: Request, res: Response) => {
    const rows = await db
      .select()
      .from(notificationEvents)
      .where(eq(notificationEvents.projectId, String(req.params.id)))
      .orderBy(desc(notificationEvents.createdAt));
    res.json(rows.map(serializeNotification));
  },
);

/**
 * FR-NTF-01: templates render from engagement data server-side, so the
 * notification log records the actual message that goes to the client, not
 * just a template name. A caller-supplied payload (bespoke text) wins.
 */
function renderNotificationTemplate(
  template: string,
  project: typeof projects.$inferSelect,
  clientName: string | null,
): string {
  switch (template) {
    case "deadline_reminder":
      return `Reminder: "${project.tenderTitle}" submission deadline is ${project.deadline ?? "not recorded"}.`;
    case "payment_confirmation":
      return `Payment status for "${project.tenderTitle}" is ${project.paymentStatus ?? "not_required"}${
        project.paymentConfirmedAt ? " (dual confirmation complete)" : ""
      }.`;
    case "certificate_renewal":
      return `Certificate renewal check for ${clientName ?? "client"} — review the Vault renewal radar for expiring artefacts.`;
    case "report_ready":
      return `The bid autopsy report for "${project.tenderTitle}" is ready for review and delivery.`;
    default:
      return `${template.replace(/_/g, " ")} — "${project.tenderTitle}".`;
  }
}

router.post(
  "/projects/:id/notifications",
  requirePermissionOrLegacy("project:update"),
  async (req: Request, res: Response) => {
    const parsed = CreateProjectNotificationBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    if (parsed.data.status !== undefined && parsed.data.status !== "queued") {
      res.status(400).json({
        error:
          "Delivery status is provider-owned; this endpoint can only queue notifications.",
      });
      return;
    }
    const projectId = String(req.params.id);
    const [row] = await db
      .select({ project: projects, clientName: clients.name })
      .from(projects)
      .leftJoin(clients, eq(projects.clientId, clients.id))
      .where(eq(projects.id, projectId));
    if (!row) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    const project = row.project;
    const user = getLocalUser(req);
    const [created] = await db
      .insert(notificationEvents)
      .values({
        organisationId: getOrganisationId(req),
        projectId,
        clientId: project.clientId,
        channel: parsed.data.channel ?? "manual",
        template: parsed.data.template,
        recipient: parsed.data.recipient ?? null,
        payload:
          parsed.data.payload == null
            ? renderNotificationTemplate(
                parsed.data.template,
                project,
                row.clientName,
              )
            : JSON.stringify(parsed.data.payload),
        status: "queued",
        createdBy: user?.id ?? null,
      })
      .returning();
    await writeAudit({
      user,
      projectId,
      eventType: "notification.queued",
      objectType: "notification",
      objectId: created.id,
      details: `${created.channel}:${created.template}`,
    });
    res.status(201).json(serializeNotification(created));
  },
);

router.post(
  "/projects/:id/retention-requests",
  requirePermissionOrLegacy("retention:manage"),
  async (req: Request, res: Response) => {
    const parsed = CreateRetentionRequestBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    const projectId = String(req.params.id);
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId));
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    const now = Date.now();
    const { retentionDefaultDays } = await getActiveConfig();
    let dueAt = new Date(now + retentionDefaultDays * 24 * 60 * 60 * 1000);
    if (parsed.data.dueAt !== undefined) {
      const requested = Date.parse(parsed.data.dueAt);
      if (Number.isNaN(requested)) {
        res.status(400).json({ error: "dueAt must be a valid date" });
        return;
      }
      if (requested < now) {
        res.status(400).json({ error: "dueAt cannot be in the past" });
        return;
      }
      dueAt = new Date(requested);
    }
    const [openRequest] = await db
      .select({ id: retentionRequests.id })
      .from(retentionRequests)
      .where(
        and(
          eq(retentionRequests.projectId, projectId),
          eq(retentionRequests.status, "pending"),
        ),
      );
    if (openRequest) {
      res.status(409).json({
        error: `A retention request (${openRequest.id}) is already open for this engagement.`,
      });
      return;
    }
    const user = getLocalUser(req);
    const [created] = await db
      .insert(retentionRequests)
      .values({
        organisationId: getOrganisationId(req),
        projectId,
        requestedBy: user?.id ?? null,
        reason: parsed.data.reason ?? null,
        dueAt,
      })
      .returning();
    await writeAudit({
      user,
      projectId,
      eventType: "retention.requested",
      objectType: "retention_request",
      objectId: created.id,
      details: `due ${dueAt.toISOString()}`,
    });
    res.status(201).json(serializeRetention(created));
  },
);

router.get(
  "/retention-requests",
  requirePermissionOrLegacy("retention:manage"),
  async (req: Request, res: Response) => {
    const organisationId = getOrganisationId(req);
    const rows = await db
      .select()
      .from(retentionRequests)
      .where(
        organisationId
          ? eq(retentionRequests.organisationId, organisationId)
          : undefined,
      )
      .orderBy(desc(retentionRequests.createdAt));
    res.json(rows.map(serializeRetention));
  },
);

/**
 * Retention completion is deliberately unavailable in this release. Blob
 * deletion and relational deletion cannot be represented by one atomic
 * transaction, and upload-session/lifecycle control rows must be detached and
 * reconciled as part of the same governed outcome. Keep this endpoint
 * fail-closed until a durable two-phase detach/reconcile/certify workflow has
 * proven every postcondition. This handler must stay free of storage, database
 * and audit calls: a refusal is not a completion event.
 */
router.post(
  "/retention-requests/:id/complete",
  requirePermissionOrLegacy("retention:manage"),
  (_req: Request, res: Response) => {
    res.set("Cache-Control", "private, no-store");
    res.status(503).json({
      error:
        "Retention completion is not activated. No data was deleted and no deletion certificate was issued.",
      code: "RETENTION_COMPLETION_NOT_ACTIVATED",
      sideEffectsApplied: false,
      requiredWorkflow: "durable_two_phase_detach_reconcile_certify",
      requiredCoverage: [
        "project_content_rows",
        "object_storage",
        "upload_sessions",
        "storage_lifecycle_control_rows",
      ],
    });
  },
);

export default router;
