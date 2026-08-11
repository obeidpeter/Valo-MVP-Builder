import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import {
  db,
  boqChecks,
  clients,
  defects,
  documents,
  evidenceItems,
  llmRuns,
  notificationAttempts,
  notificationEvents,
  exportDeliveries,
  packageManifestItems,
  packageSignoffs,
  packageVersions,
  packages,
  projects,
  reports,
  requirements,
  retentionRequests,
  vaultItems,
  workTasks,
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
import { writeAudit, writeAuditTx } from "../lib/audit";
import { serializeNotification, serializeRetention } from "../lib/serializers";
import {
  computeExpiry,
  computeRedTeamDueAt,
  computeSlaDueAt,
  validateProjectTransition,
  type ConflictStatus,
  type PaymentStatus,
  type ProjectStatus,
  type SlaClass,
} from "../lib/deterministic";
import { ObjectStorageService } from "../lib/objectStorage";
import { planProjectBlobPurge, purgeBlobs } from "../lib/purge";
import { getActiveConfig } from "../lib/appConfig";
import { RETAINER_TASK_PREFIX } from "../lib/commercialRetainer/contracts";
import { CLAIMS_DESK_RETENTION_WORK_TASK_LIKE } from "../lib/claimsDesk/activation";

const router: IRouter = Router();
const objectStorage = new ObjectStorageService();
const CONSORTIUM_ROOM_TASK_PREFIX = "[CONSORTIUM-ROOM:v1:";

const ACTIVE_STATUSES = [
  "intake",
  "extraction",
  "review",
  "defects",
  "reporting",
];

interface CommercialFinancialRetentionBlockers {
  orders: number;
  invoiceLines: number;
  invoices: number;
  payments: number;
  entitlements: number;
  subscriptions: number;
  entitlementUsage: number;
}

function retentionCount(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return value;
  }
  throw new Error(`Invalid commercial retention count: ${key}`);
}

async function commercialFinancialRetentionBlockers(
  organisationId: string,
  projectId: string,
): Promise<CommercialFinancialRetentionBlockers> {
  const result = await db.execute(sql`
    WITH linked_orders AS MATERIALIZED (
      SELECT id
        FROM orders
       WHERE organisation_id = ${organisationId}::uuid
         AND project_id = ${projectId}::uuid
    ), linked_invoices AS MATERIALIZED (
      SELECT DISTINCT invoice.id
        FROM invoices AS invoice
        JOIN invoice_lines AS line ON line.invoice_id = invoice.id
        JOIN linked_orders AS linked_order ON linked_order.id = line.order_id
       WHERE invoice.organisation_id = ${organisationId}::uuid
    ), linked_entitlements AS MATERIALIZED (
      SELECT entitlement.id, entitlement.subscription_id
        FROM entitlements AS entitlement
        JOIN linked_orders AS linked_order ON linked_order.id = entitlement.order_id
       WHERE entitlement.organisation_id = ${organisationId}::uuid
    )
    SELECT
      (SELECT count(*)::int FROM linked_orders) AS orders,
      (
        SELECT count(*)::int
          FROM invoice_lines AS line
         WHERE line.order_id IN (SELECT id FROM linked_orders)
      ) AS invoice_lines,
      (SELECT count(*)::int FROM linked_invoices) AS invoices,
      (
        SELECT count(*)::int
          FROM payments AS payment
         WHERE payment.organisation_id = ${organisationId}::uuid
           AND payment.invoice_id IN (SELECT id FROM linked_invoices)
      ) AS payments,
      (SELECT count(*)::int FROM linked_entitlements) AS entitlements,
      (
        SELECT count(DISTINCT subscription.id)::int
          FROM subscriptions AS subscription
         WHERE subscription.organisation_id = ${organisationId}::uuid
           AND subscription.id IN (
             SELECT subscription_id
               FROM linked_entitlements
              WHERE subscription_id IS NOT NULL
           )
      ) AS subscriptions,
      (
        SELECT count(*)::int
          FROM entitlement_usage AS usage
         WHERE usage.organisation_id = ${organisationId}::uuid
           AND (
             usage.project_id = ${projectId}::uuid
             OR usage.entitlement_id IN (SELECT id FROM linked_entitlements)
           )
      ) AS entitlement_usage
  `);
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) throw new Error("Commercial retention preflight returned no row");
  return {
    orders: retentionCount(row, "orders"),
    invoiceLines: retentionCount(row, "invoice_lines"),
    invoices: retentionCount(row, "invoices"),
    payments: retentionCount(row, "payments"),
    entitlements: retentionCount(row, "entitlements"),
    subscriptions: retentionCount(row, "subscriptions"),
    entitlementUsage: retentionCount(row, "entitlement_usage"),
  };
}

function hasCommercialFinancialRetentionBlockers(
  blockers: CommercialFinancialRetentionBlockers,
): boolean {
  return Object.values(blockers).some((count) => count > 0);
}

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
 * Completing a retention request is the digital half of NDPR-style deletion:
 * the certificate it issues is a formal representation to the client, so it
 * must only be written once every class of stored engagement content is
 * actually gone — source blobs, extracted requirement text, evidence
 * excerpts, defect snapshots, BOQ lines and LLM run summaries. The
 * tamper-evident audit chain is deliberately retained (and the certificate
 * says so): deleting audit history would break the accountability the
 * doctrine depends on.
 */
router.post(
  "/retention-requests/:id/complete",
  requirePermissionOrLegacy("retention:manage"),
  async (req: Request, res: Response) => {
    const [requestRow] = await db
      .select()
      .from(retentionRequests)
      .where(eq(retentionRequests.id, String(req.params.id)));
    if (!requestRow) {
      res.status(404).json({ error: "Retention request not found" });
      return;
    }
    if (requestRow.status === "completed") {
      res.json(serializeRetention(requestRow));
      return;
    }
    const retentionOrganisationId = requestRow.organisationId;
    if (!retentionOrganisationId) {
      res.status(409).json({
        error:
          "Retention request lacks a governed organisation scope; certificate withheld.",
      });
      return;
    }

    const projectId = requestRow.projectId;
    await db.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${projectId}, 0))`,
    );
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId));
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    // Archiving through retention goes through the same deterministic gate as
    // a manual status edit — most importantly the physical-archive
    // return/destroy instruction, which is the whole point of the archive gate.
    if (project.status !== "archived") {
      const gate = validateProjectTransition({
        fromStatus: project.status as ProjectStatus,
        toStatus: "archived",
        reviewerId: project.reviewerId,
        paymentStatus: project.paymentStatus as PaymentStatus,
        paymentConfirmedByFounder: project.paymentConfirmedByFounder,
        paymentConfirmedByAdvisor: project.paymentConfirmedByAdvisor,
        paymentFounderConfirmedBy: project.paymentFounderConfirmedBy,
        paymentAdvisorConfirmedBy: project.paymentAdvisorConfirmedBy,
        conflictStatus: project.conflictStatus as ConflictStatus,
        physicalArchiveInstruction: project.physicalArchiveInstruction,
      });
      if (!gate.ok) {
        await writeAudit({
          user: getLocalUser(req),
          projectId,
          eventType: "project.transition_denied",
          objectType: "project",
          objectId: projectId,
          details: gate.reason,
        });
        res
          .status(409)
          .json({ error: gate.reason ?? "Project cannot be archived yet" });
        return;
      }
    }

    // Commercial financial records are governed by legal/tax retention, not
    // the engagement-content deletion policy. No approved purge, detachment or
    // financial-retention basis is configured in this release, so completion
    // fails before any blob or row is deleted. This prevents a certificate from
    // claiming that only project metadata and audit remain while linked orders,
    // invoices, payments, entitlements or usage still survive.
    const financialBlockers = await commercialFinancialRetentionBlockers(
      retentionOrganisationId,
      projectId,
    );
    if (hasCommercialFinancialRetentionBlockers(financialBlockers)) {
      await writeAudit({
        user: getLocalUser(req),
        organisationId: retentionOrganisationId,
        projectId,
        eventType: "retention.commercial_financial_records_blocked",
        objectType: "retention_request",
        objectId: requestRow.id,
        details: JSON.stringify({
          schemaVersion: "valo.commercial-retention-block/v1",
          policy: "certificate_withheld_until_approved_financial_policy",
          counts: financialBlockers,
        }),
      });
      res.status(409).json({
        error:
          "Linked commercial financial records require an approved purge or financial-retention policy; the deletion certificate is withheld.",
        commercialFinancialBlockers: financialBlockers,
      });
      return;
    }

    // Blob purge first (external side effect). Vault-owned blobs are the
    // client's long-lived artefacts and are excluded; if any deletable blob
    // fails, the request stays pending and no certificate is issued.
    const plan = await planProjectBlobPurge(projectId);
    const blobResult = await purgeBlobs(
      objectStorage,
      plan.paths,
      (objectPath, error) => {
        req.log.error(
          { err: error, objectPath },
          "failed to purge retained blob",
        );
      },
    );
    if (blobResult.failed.length > 0) {
      await writeAudit({
        user: getLocalUser(req),
        projectId,
        eventType: "retention.purge_failed",
        objectType: "retention_request",
        objectId: requestRow.id,
        details: `${blobResult.failed.length} stored file(s) could not be purged; certificate withheld.`,
      });
      res.status(502).json({
        error: `${blobResult.failed.length} stored file(s) could not be purged. The request stays pending — retry once storage is reachable.`,
      });
      return;
    }

    // Row purge + archive + certificate in one transaction so a crash can
    // never leave a half-purged project with a still-pending request.
    const completedAt = new Date();
    const updated = await db.transaction(
      async (tx) => {
        const projectPackageVersionIds = () =>
          tx
            .select({ id: packageVersions.id })
            .from(packageVersions)
            .innerJoin(packages, eq(packageVersions.packageId, packages.id))
            .where(eq(packages.projectId, projectId));
        const purgedOperationsRecords = await tx
          .delete(workTasks)
          .where(
            and(
              eq(workTasks.projectId, projectId),
              or(
                like(workTasks.title, "[OPS:%"),
                like(workTasks.title, "[CLIENT-ACTION:%"),
                like(workTasks.title, `${RETAINER_TASK_PREFIX}%`),
                like(workTasks.title, `${CONSORTIUM_ROOM_TASK_PREFIX}%`),
                like(workTasks.title, CLAIMS_DESK_RETENTION_WORK_TASK_LIKE),
              ),
            ),
          )
          .returning({ id: workTasks.id, title: workTasks.title });
        const purgedRetainerServiceRequests = purgedOperationsRecords.filter(
          ({ title }) => title.startsWith(RETAINER_TASK_PREFIX),
        ).length;
        const purgedClientActionRecords = purgedOperationsRecords.filter(
          ({ title }) => title.startsWith("[CLIENT-ACTION:"),
        ).length;
        const purgedConsortiumRooms = purgedOperationsRecords.filter(
          ({ title }) => title.startsWith(CONSORTIUM_ROOM_TASK_PREFIX),
        ).length;
        const purgedClaimsDeskEvents = purgedOperationsRecords.filter(
          ({ title }) => title.startsWith("[CLAIMS-DESK:"),
        ).length;
        const projectNotificationEventIds = () =>
          tx
            .select({ id: notificationEvents.id })
            .from(notificationEvents)
            .where(eq(notificationEvents.projectId, projectId));
        const purgedNotificationAttempts = await tx
          .delete(notificationAttempts)
          .where(
            inArray(
              notificationAttempts.notificationEventId,
              projectNotificationEventIds(),
            ),
          )
          .returning({ id: notificationAttempts.id });
        const purgedNotificationEvents = await tx
          .delete(notificationEvents)
          .where(eq(notificationEvents.projectId, projectId))
          .returning({ id: notificationEvents.id });
        const purgedExportDeliveries = await tx
          .delete(exportDeliveries)
          .where(
            inArray(
              exportDeliveries.packageVersionId,
              projectPackageVersionIds(),
            ),
          )
          .returning({ id: exportDeliveries.id });
        const purgedPackageSignoffs = await tx
          .delete(packageSignoffs)
          .where(
            inArray(
              packageSignoffs.packageVersionId,
              projectPackageVersionIds(),
            ),
          )
          .returning({ id: packageSignoffs.id });
        const purgedPackageManifestItems = await tx
          .delete(packageManifestItems)
          .where(
            inArray(
              packageManifestItems.packageVersionId,
              projectPackageVersionIds(),
            ),
          )
          .returning({ id: packageManifestItems.id });
        const purgedPackageVersions = await tx
          .delete(packageVersions)
          .where(inArray(packageVersions.id, projectPackageVersionIds()))
          .returning({ id: packageVersions.id });
        const purgedPackages = await tx
          .delete(packages)
          .where(eq(packages.projectId, projectId))
          .returning({ id: packages.id });
        const purgedEvidence = await tx
          .delete(evidenceItems)
          .where(eq(evidenceItems.projectId, projectId))
          .returning({ id: evidenceItems.id });
        const purgedDefects = await tx
          .delete(defects)
          .where(eq(defects.projectId, projectId))
          .returning({ id: defects.id });
        const purgedBoq = await tx
          .delete(boqChecks)
          .where(eq(boqChecks.projectId, projectId))
          .returning({ id: boqChecks.id });
        const purgedRequirements = await tx
          .delete(requirements)
          .where(eq(requirements.projectId, projectId))
          .returning({ id: requirements.id });
        const purgedLlmRuns = await tx
          .delete(llmRuns)
          .where(eq(llmRuns.projectId, projectId))
          .returning({ id: llmRuns.id });
        const purgedDocs = await tx
          .delete(documents)
          .where(eq(documents.projectId, projectId))
          .returning({ id: documents.id });
        const purgedReports = await tx
          .delete(reports)
          .where(eq(reports.projectId, projectId))
          .returning({ id: reports.id });
        await tx
          .update(projects)
          .set({
            status: "archived",
            scope: null,
            limitations: null,
            responsivenessReview: null,
            riskOverrideNote: null,
            version: sql`${projects.version} + 1`,
            updatedAt: completedAt,
          })
          .where(eq(projects.id, projectId));

        const certificateText =
          `Retention deletion certificate: project ${projectId}. ` +
          `Purged ${blobResult.purged}/${plan.paths.length} stored file(s)` +
          (plan.vaultRetained.length > 0
            ? ` (${plan.vaultRetained.length} file(s) retained as client Certificate Vault artefacts)`
            : "") +
          `; deleted rows: documents=${purgedDocs.length}, reports=${purgedReports.length}, ` +
          `requirements=${purgedRequirements.length}, evidence=${purgedEvidence.length}, ` +
          `defects=${purgedDefects.length}, boq_checks=${purgedBoq.length}, llm_runs=${purgedLlmRuns.length}; ` +
          `operations_records=${purgedOperationsRecords.length}, client_action_records=${purgedClientActionRecords}, retainer_service_requests=${purgedRetainerServiceRequests}, consortium_rooms=${purgedConsortiumRooms}, claims_desk_events=${purgedClaimsDeskEvents}, notification_events=${purgedNotificationEvents.length}, notification_attempts=${purgedNotificationAttempts.length}, packages=${purgedPackages.length}, ` +
          `package_versions=${purgedPackageVersions.length}, package_manifest_items=${purgedPackageManifestItems.length}, ` +
          `package_signoffs=${purgedPackageSignoffs.length}, export_deliveries=${purgedExportDeliveries.length}; ` +
          `project narrative fields cleared. Retained: project metadata, this retention record, ` +
          `and the tamper-evident audit chain. Completed ${completedAt.toISOString()}.`;

        const [row] = await tx
          .update(retentionRequests)
          .set({ status: "completed", completedAt, certificateText })
          .where(eq(retentionRequests.id, requestRow.id))
          .returning();
        await writeAuditTx(tx, {
          user: getLocalUser(req),
          organisationId: getOrganisationId(req),
          projectId,
          eventType: "retention.completed",
          objectType: "retention_request",
          objectId: row.id,
          details: row.certificateText ?? undefined,
        });
        return row;
      },
      { isolationLevel: "read committed" },
    );
    res.json(serializeRetention(updated));
  },
);

export default router;
