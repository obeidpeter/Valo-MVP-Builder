import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, or, ne, isNull, desc, sql, inArray } from "drizzle-orm";
import {
  db,
  projects,
  clients,
  users,
  defects,
  requirements,
  conflictRecords,
} from "@workspace/db";
import {
  ConfirmProjectPaymentBody,
  CreateProjectBody,
  UpdateProjectBody,
} from "@workspace/api-zod";
import { getLocalUser } from "../middlewares/auth";
import {
  getOrganisationId,
  hasRequestPermission,
  parseExpectedVersion,
  requirePermissionOrLegacy,
} from "../middlewares/tenancy";
import { serializeProject } from "../lib/serializers";
import { writeAudit, writeAuditTx } from "../lib/audit";
import { responsivenessReview } from "../lib/llm";
import { isSystemManagedProjectStatus } from "../lib/reportPolicy";
import {
  validateProjectTransition,
  type ConflictStatus,
  type PaymentStatus,
  type ProjectStatus,
} from "../lib/deterministic";
import { holdTenantDatabaseUntilComplete } from "../middlewares/databaseTenancy";
import { sendAiGatewayError } from "../lib/aiHttp";
import {
  canonicalOpportunityPursuitConflictValue,
  lockOpportunityPursuitConflictBoundary,
} from "../lib/opportunityPursuitHandoff";
import {
  currentProjectReviewerAuthorityTime,
  isCurrentProjectReviewer,
  lockProjectReviewerAuthorityBoundary,
} from "../lib/projectReviewerAuthority";
import {
  canonicalProjectDeadline,
  hasServerManagedProjectCreateField,
  isUuid,
} from "../lib/projectMutationPolicy";

const PAYMENT_CONFIRMATION_ROLE_BINDING_ENABLED = false;

const router: IRouter = Router();
function nextActionFor(status: string): string {
  switch (status) {
    case "intake":
      return "Upload tender and bid documents";
    case "extraction":
      return "Extract and confirm requirements";
    case "review":
      return "Map evidence to requirements";
    case "defects":
      return "Review defect register";
    case "reporting":
      return "Generate and sign off report";
    case "signed_off":
      return "Export package";
    case "exported":
      return "Record engagement outcome";
    default:
      return "Review project";
  }
}

async function findSameTenderConflict(
  params: {
    tenderRef?: string | null;
    lot?: string | null;
    excludeProjectId?: string | null;
    organisationId?: string;
  },
  database: typeof db | ProjectTransaction = db,
) {
  const tenderReference = canonicalOpportunityPursuitConflictValue(
    params.tenderRef,
  );
  if (!tenderReference) return null;
  const lotReference = canonicalOpportunityPursuitConflictValue(params.lot);
  const rows = await database
    .select()
    .from(projects)
    .where(
      and(
        sql`pg_catalog.regexp_replace(normalize(pg_catalog.btrim(${projects.tenderRef}), NFC), '[[:space:]]+', ' ', 'g') = ${tenderReference}`,
        sql`pg_catalog.regexp_replace(normalize(pg_catalog.btrim(coalesce(${projects.lot}, '')), NFC), '[[:space:]]+', ' ', 'g') = ${lotReference ?? ""}`,
        inArray(projects.status, [
          "intake",
          "extraction",
          "review",
          "defects",
          "reporting",
          "signed_off",
        ]),
        params.excludeProjectId
          ? ne(projects.id, params.excludeProjectId)
          : undefined,
        params.organisationId
          ? eq(projects.organisationId, params.organisationId)
          : undefined,
      ),
    )
    .orderBy(projects.id)
    .limit(1);
  return rows[0] ?? null;
}

type ProjectTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

// GET /projects — dashboard summaries with aggregates.
router.get(
  "/projects",
  requirePermissionOrLegacy("project:read"),
  async (req: Request, res: Response) => {
    const clientId = (req.query.clientId as string | undefined) || undefined;
    const organisationId = getOrganisationId(req);
    const rows = await db
      .select({
        project: projects,
        clientName: clients.name,
        reviewerName: users.name,
      })
      .from(projects)
      .leftJoin(clients, eq(projects.clientId, clients.id))
      .leftJoin(users, eq(projects.reviewerId, users.id))
      .where(
        and(
          clientId ? eq(projects.clientId, clientId) : undefined,
          organisationId
            ? eq(projects.organisationId, organisationId)
            : undefined,
        ),
      )
      .orderBy(desc(projects.createdAt));

    const ids = rows.map((r) => r.project.id);
    const defectCounts = new Map<string, { total: number; fatal: number }>();
    const reqCounts = new Map<string, number>();
    if (ids.length > 0) {
      const dc = await db
        .select({
          projectId: defects.projectId,
          total: sql<number>`count(*)::int`,
          fatal: sql<number>`count(*) filter (where ${defects.severity} in ('fatal','likely_fatal'))::int`,
        })
        .from(defects)
        .where(inArray(defects.projectId, ids))
        .groupBy(defects.projectId);
      for (const r of dc)
        defectCounts.set(r.projectId, {
          total: Number(r.total),
          fatal: Number(r.fatal),
        });
      const rc = await db
        .select({
          projectId: requirements.projectId,
          total: sql<number>`count(*)::int`,
        })
        .from(requirements)
        .where(inArray(requirements.projectId, ids))
        .groupBy(requirements.projectId);
      for (const r of rc) reqCounts.set(r.projectId, Number(r.total));
    }

    res.json(
      rows.map((r) => {
        const p = r.project;
        const dc = defectCounts.get(p.id) ?? { total: 0, fatal: 0 };
        return {
          id: p.id,
          clientId: p.clientId,
          clientName: r.clientName ?? null,
          tenderTitle: p.tenderTitle,
          issuingEntity: p.issuingEntity ?? null,
          tenderRef: p.tenderRef ?? null,
          lot: p.lot ?? null,
          deadline: p.deadline ?? null,
          segment: p.segment ?? null,
          status: p.status,
          reviewerId: p.reviewerId ?? null,
          reviewerName: r.reviewerName ?? null,
          slaClass: p.slaClass ?? "standard",
          paymentStatus: p.paymentStatus ?? "not_required",
          conflictStatus: p.conflictStatus ?? "clear",
          restrictedMode: p.restrictedMode ?? false,
          riskScore: p.riskScore ?? null,
          riskBand: p.riskBand ?? null,
          outcome: p.outcome,
          nextAction: nextActionFor(p.status),
          defectCount: dc.total,
          fatalDefectCount: dc.fatal,
          requirementCount: reqCounts.get(p.id) ?? 0,
          createdAt: (p.createdAt instanceof Date
            ? p.createdAt
            : new Date(p.createdAt)
          ).toISOString(),
        };
      }),
    );
  },
);

router.post(
  "/projects",
  requirePermissionOrLegacy("project:create"),
  async (req: Request, res: Response) => {
    if (hasServerManagedProjectCreateField(req.body)) {
      res.status(400).json({
        error:
          "Payment and conflict state are server-managed and cannot be supplied when creating a project.",
      });
      return;
    }
    const rawDeadline =
      req.body && typeof req.body === "object" && !Array.isArray(req.body)
        ? (req.body as Record<string, unknown>).deadline
        : undefined;
    const canonicalDeadline =
      rawDeadline === undefined
        ? undefined
        : typeof rawDeadline === "string"
          ? canonicalProjectDeadline(rawDeadline)
          : null;
    if (canonicalDeadline === null) {
      res.status(400).json({
        error:
          "Submission deadline must be an explicit RFC 3339 date-time with a Z or numeric offset.",
      });
      return;
    }
    const parsed = CreateProjectBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    if (!parsed.data.reviewerId) {
      res.status(400).json({
        error:
          "A named reviewer is required before an engagement can be created.",
      });
      return;
    }
    if (!isUuid(parsed.data.clientId) || !isUuid(parsed.data.reviewerId)) {
      res.status(400).json({
        error: "Client and reviewer identifiers must be valid UUIDs.",
      });
      return;
    }
    const organisationId = getOrganisationId(req);
    if (!organisationId) {
      res.status(403).json({ error: "Organisation context is required." });
      return;
    }
    const user = getLocalUser(req);
    const { deadline: _parsedDeadline, ...parsedCreateFields } = parsed.data;
    const createFields = {
      ...parsedCreateFields,
      ...(canonicalDeadline === undefined
        ? {}
        : { deadline: canonicalDeadline }),
    };
    const outcome = await db.transaction(
      async (tx) => {
        await lockProjectReviewerAuthorityBoundary(
          tx,
          organisationId,
          parsed.data.reviewerId,
        );
        const authorityTime = await currentProjectReviewerAuthorityTime(tx);
        if (
          !(await isCurrentProjectReviewer(
            tx,
            organisationId,
            parsed.data.reviewerId,
            authorityTime,
          ))
        ) {
          return { kind: "reviewer_ineligible" } as const;
        }
        const [owningClient] = await tx
          .select({ id: clients.id })
          .from(clients)
          .where(
            and(
              eq(clients.id, parsed.data.clientId),
              eq(clients.organisationId, organisationId),
            ),
          );
        if (!owningClient) return { kind: "client_not_found" } as const;
        const tenderReference = canonicalOpportunityPursuitConflictValue(
          parsed.data.tenderRef,
        );
        const lotReference = canonicalOpportunityPursuitConflictValue(
          parsed.data.lot,
        );
        if (organisationId && tenderReference) {
          await lockOpportunityPursuitConflictBoundary(
            tx,
            organisationId,
            tenderReference,
          );
        }
        const conflict = await findSameTenderConflict(
          {
            tenderRef: tenderReference,
            lot: lotReference,
            organisationId,
          },
          tx,
        );
        const [project] = await tx
          .insert(projects)
          .values({
            ...createFields,
            tenderRef: tenderReference,
            lot: lotReference,
            // Commercial and conflict outcomes are server-managed. New work starts
            // payment-pending and only deterministic conflict detection may block it.
            paymentStatus: "pending",
            conflictStatus: conflict ? "blocked" : "clear",
            conflictDecision: conflict ? "pending_disclosure" : null,
            conflictRationale: conflict
              ? `Same tender/lot already active on project ${conflict.id}.`
              : null,
            organisationId,
          })
          .returning();
        if (conflict) {
          await tx.insert(conflictRecords).values({
            clientId: project.clientId,
            organisationId,
            projectId: project.id,
            tenderRef: project.tenderRef,
            lot: project.lot,
            matchedProjectId: conflict.id,
            status: "blocked",
            decision: "pending_disclosure",
            rationale: `Same tender/lot already active on project ${conflict.id}.`,
          });
        }
        await writeAuditTx(tx, {
          user,
          organisationId,
          projectId: project.id,
          eventType: conflict
            ? "project.created_conflict_blocked"
            : "project.created",
          objectType: "project",
          objectId: project.id,
          details: project.tenderTitle,
        });
        return { kind: "created", project } as const;
      },
      { isolationLevel: "read committed" },
    );
    if (outcome.kind === "reviewer_ineligible") {
      res.status(403).json({
        error:
          "The named reviewer is not currently eligible in this organisation.",
      });
      return;
    }
    if (outcome.kind === "client_not_found") {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.status(201).json(serializeProject(outcome.project));
  },
);

async function loadProjectWithJoins(id: string, organisationId?: string) {
  const [row] = await db
    .select({
      project: projects,
      clientName: clients.name,
      ndaStatus: clients.ndaStatus,
      reviewerName: users.name,
    })
    .from(projects)
    .leftJoin(clients, eq(projects.clientId, clients.id))
    .leftJoin(users, eq(projects.reviewerId, users.id))
    .where(
      and(
        eq(projects.id, id),
        organisationId
          ? eq(projects.organisationId, organisationId)
          : undefined,
      ),
    );
  return row;
}

router.get(
  "/projects/:id",
  requirePermissionOrLegacy("project:read"),
  async (req: Request, res: Response) => {
    const organisationId = getOrganisationId(req);
    const row = await loadProjectWithJoins(
      String(req.params.id),
      organisationId,
    );
    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    await writeAudit({
      user: getLocalUser(req),
      organisationId,
      projectId: row.project.id,
      eventType: "project.viewed",
      objectType: "project",
      objectId: row.project.id,
      details: row.project.tenderTitle,
    });
    res.json(
      serializeProject(row.project, {
        clientName: row.clientName,
        ndaStatus: row.ndaStatus,
        reviewerName: row.reviewerName,
      }),
    );
  },
);

type ParsedProjectPatchBody = Extract<
  ReturnType<typeof UpdateProjectBody.safeParse>,
  { success: true }
>;

/**
 * Pre-transaction PATCH validation (moved verbatim out of the handler):
 * canonicalises the deadline, parses and bounds the body, and rejects
 * server-managed payment/conflict/status fields. Returns null after sending
 * the matching error response.
 */
function parseProjectPatchPayload(req: Request, res: Response) {
  const rawDeadline =
    req.body && typeof req.body === "object" && !Array.isArray(req.body)
      ? (req.body as Record<string, unknown>).deadline
      : undefined;
  const canonicalDeadline =
    rawDeadline === undefined
      ? undefined
      : typeof rawDeadline === "string"
        ? canonicalProjectDeadline(rawDeadline)
        : null;
  if (canonicalDeadline === null) {
    res.status(400).json({
      error:
        "Submission deadline must be an explicit RFC 3339 date-time with a Z or numeric offset.",
    });
    return;
  }
  const parsed = UpdateProjectBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  if (Object.keys(parsed.data).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }
  if (parsed.data.reviewerId !== undefined && !isUuid(parsed.data.reviewerId)) {
    res
      .status(400)
      .json({ error: "Reviewer identifier must be a valid UUID." });
    return;
  }
  const { deadline: _parsedDeadline, ...parsedUpdateFields } = parsed.data;
  const updateFields = {
    ...parsedUpdateFields,
    ...(canonicalDeadline === undefined ? {} : { deadline: canonicalDeadline }),
  };
  const editsResponsiveness = parsed.data.responsivenessReview !== undefined;
  if (editsResponsiveness && !hasRequestPermission(req, "report:sign_off")) {
    res.status(403).json({
      error:
        "Editing or approving the responsiveness review requires report:sign_off.",
    });
    return;
  }
  if (
    parsed.data.paymentStatus !== undefined ||
    parsed.data.conflictStatus !== undefined ||
    parsed.data.conflictDecision !== undefined ||
    parsed.data.conflictRationale !== undefined
  ) {
    res.status(409).json({
      error:
        "Payment and conflict decisions are controlled by dedicated authorised workflows.",
    });
    return;
  }
  if (
    isSystemManagedProjectStatus(parsed.data.status) ||
    parsed.data.status === "archived"
  ) {
    res.status(409).json({
      error:
        parsed.data.status === "archived"
          ? "Archived state is controlled by the governed retention workflow."
          : "Signed-off and exported states are controlled by the governed sign-off/export routes.",
    });
    return;
  }
  return { parsed, updateFields, editsResponsiveness };
}

type ProjectPatchPayload = NonNullable<
  ReturnType<typeof parseProjectPatchPayload>
>;

/**
 * Loads the tenant-scoped PATCH target and its optimistic-concurrency
 * version, and gates supplied reviewer assignments on project:assign.
 * Returns undefined after sending the matching error response.
 */
async function loadProjectPatchTarget(
  req: Request,
  res: Response,
  parsed: ParsedProjectPatchBody,
  organisationId: string,
) {
  const [existing] = await db
    .select()
    .from(projects)
    .where(
      and(
        eq(projects.id, String(req.params.id)),
        eq(projects.organisationId, organisationId),
      ),
    );
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
    parsed.data.reviewerId !== undefined &&
    !hasRequestPermission(req, "project:assign")
  ) {
    res
      .status(403)
      .json({ error: "Project reviewer assignment requires project:assign" });
    return;
  }
  return { existing, expectedVersion };
}

/**
 * Computes the canonical tender identity, the prospective row state and the
 * conflict flags, and enforces the deterministic status-transition gate.
 * Returns null after sending the matching error response.
 */
async function evaluateProjectPatchTransition({
  req,
  res,
  parsed,
  updateFields,
  existing,
}: {
  req: Request;
  res: Response;
  parsed: ParsedProjectPatchBody;
  updateFields: ProjectPatchPayload["updateFields"];
  existing: typeof projects.$inferSelect;
}) {
  const existingTenderReference = canonicalOpportunityPursuitConflictValue(
    existing.tenderRef,
  );
  const existingLotReference = canonicalOpportunityPursuitConflictValue(
    existing.lot,
  );
  const nextTenderReference =
    parsed.data.tenderRef === undefined
      ? existingTenderReference
      : canonicalOpportunityPursuitConflictValue(parsed.data.tenderRef);
  const nextLotReference =
    parsed.data.lot === undefined
      ? existingLotReference
      : canonicalOpportunityPursuitConflictValue(parsed.data.lot);
  const next = {
    ...existing,
    ...updateFields,
    tenderRef: nextTenderReference,
    lot: nextLotReference,
  };
  const user = getLocalUser(req);
  if (parsed.data.status && parsed.data.status !== existing.status) {
    const gate = validateProjectTransition({
      fromStatus: existing.status as ProjectStatus,
      toStatus: parsed.data.status as ProjectStatus,
      reviewerId: next.reviewerId,
      paymentStatus: next.paymentStatus as PaymentStatus,
      paymentConfirmedByFounder: next.paymentConfirmedByFounder,
      paymentConfirmedByAdvisor: next.paymentConfirmedByAdvisor,
      paymentFounderConfirmedBy: next.paymentFounderConfirmedBy,
      paymentAdvisorConfirmedBy: next.paymentAdvisorConfirmedBy,
      conflictStatus: next.conflictStatus as ConflictStatus,
      physicalArchiveInstruction: next.physicalArchiveInstruction,
    });
    if (!gate.ok) {
      await writeAudit({
        user,
        projectId: existing.id,
        eventType: "project.transition_denied",
        objectType: "project",
        objectId: existing.id,
        details: gate.reason,
      });
      res
        .status(409)
        .json({ error: gate.reason ?? "Project transition blocked" });
      return;
    }
  }
  // A consent only covers the tender identity it was granted for. So:
  //  - an unrelated PATCH (deadline edit, status move) on a consented/declined
  //    project must NOT silently re-block it or duplicate conflict_records;
  //  - but a PATCH that CHANGES tenderRef/lot has moved the project onto a
  //    different tender — any match there is a brand-new conflict the old
  //    consent cannot waive, and it must block afresh.
  const conflictIdentityChanged =
    nextTenderReference !== existingTenderReference ||
    nextLotReference !== existingLotReference;
  const decidedConflict =
    (parsed.data.conflictStatus === "consented" ||
      parsed.data.conflictStatus === "declined") &&
    existing.conflictStatus !== parsed.data.conflictStatus;
  return {
    nextTenderReference,
    nextLotReference,
    next,
    user,
    conflictIdentityChanged,
    decidedConflict,
  };
}

router.patch(
  "/projects/:id",
  requirePermissionOrLegacy("project:update"),
  async (req: Request, res: Response) => {
    const payload = parseProjectPatchPayload(req, res);
    if (!payload) return;
    const { parsed, updateFields, editsResponsiveness } = payload;
    const organisationId = getOrganisationId(req);
    if (!organisationId) {
      res.status(403).json({ error: "Organisation context is required." });
      return;
    }
    const target = await loadProjectPatchTarget(
      req,
      res,
      parsed,
      organisationId,
    );
    if (!target) return;
    const { existing, expectedVersion } = target;
    const evaluation = await evaluateProjectPatchTransition({
      req,
      res,
      parsed,
      updateFields,
      existing,
    });
    if (!evaluation) return;
    const {
      nextTenderReference,
      nextLotReference,
      next,
      user,
      conflictIdentityChanged,
      decidedConflict,
    } = evaluation;
    const outcome = await db.transaction(
      async (tx) => {
        // Every supplied reviewerId is an assignment. Equality against the
        // pre-transaction snapshot is not authority: another version-N writer
        // could change the reviewer before this UPDATE acquires its row lock.
        // Revalidate the target under the membership lock, then let If-Match
        // close the project-row race.
        if (updateFields.reviewerId !== undefined) {
          await lockProjectReviewerAuthorityBoundary(
            tx,
            organisationId,
            updateFields.reviewerId!,
          );
          const authorityTime = await currentProjectReviewerAuthorityTime(tx);
          if (
            !(await isCurrentProjectReviewer(
              tx,
              organisationId,
              updateFields.reviewerId!,
              authorityTime,
            ))
          ) {
            return { kind: "reviewer_ineligible" } as const;
          }
        }
        const tenderReference = nextTenderReference;
        if (organisationId && tenderReference) {
          await lockOpportunityPursuitConflictBoundary(
            tx,
            organisationId,
            tenderReference,
          );
        }
        const conflict = await findSameTenderConflict(
          {
            tenderRef: tenderReference,
            lot: nextLotReference,
            excludeProjectId: existing.id,
            organisationId,
          },
          tx,
        );
        const shouldBlockConflict =
          conflict != null &&
          (conflictIdentityChanged ||
            (next.conflictStatus !== "consented" &&
              next.conflictStatus !== "declined"));
        const newlyBlocked =
          shouldBlockConflict &&
          (existing.conflictStatus !== "blocked" || conflictIdentityChanged);
        const conflictPatch =
          shouldBlockConflict && conflict
            ? {
                conflictStatus: "blocked",
                conflictDecision: "pending_disclosure",
                conflictRationale: `Same tender/lot already active on project ${conflict.id}.`,
              }
            : {};
        const [project] = await tx
          .update(projects)
          .set({
            ...updateFields,
            ...(updateFields.tenderRef !== undefined
              ? { tenderRef: nextTenderReference }
              : {}),
            ...(updateFields.lot !== undefined
              ? { lot: nextLotReference }
              : {}),
            ...(editsResponsiveness ? { responsivenessSuggested: false } : {}),
            ...conflictPatch,
            version: sql`${projects.version} + 1`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(projects.id, String(req.params.id)),
              eq(projects.version, expectedVersion),
              eq(projects.organisationId, organisationId),
            ),
          )
          .returning();
        if (!project) return { kind: "changed" } as const;
        if (conflict && newlyBlocked) {
          await tx.insert(conflictRecords).values({
            clientId: project.clientId,
            organisationId,
            projectId: project.id,
            tenderRef: project.tenderRef,
            lot: project.lot,
            matchedProjectId: conflict.id,
            status: "blocked",
            decision: "pending_disclosure",
            rationale: `Same tender/lot already active on project ${conflict.id}.`,
          });
        }
        // When the reviewer rules on a blocked conflict, stamp the open conflict
        // record with the decision and the deciding identity instead of leaving
        // the register write-only.
        if (decidedConflict) {
          await tx
            .update(conflictRecords)
            .set({
              status: parsed.data.conflictStatus,
              decision: next.conflictDecision ?? parsed.data.conflictStatus,
              rationale: next.conflictRationale ?? null,
              decidedBy: user?.id ?? null,
              decidedAt: new Date(),
            })
            .where(
              and(
                eq(conflictRecords.projectId, project.id),
                eq(conflictRecords.status, "blocked"),
              ),
            );
        }
        await writeAuditTx(tx, {
          user,
          organisationId,
          projectId: project.id,
          eventType: editsResponsiveness
            ? "project.responsiveness_approved"
            : parsed.data.status
              ? "project.transitioned"
              : "project.updated",
          objectType: "project",
          objectId: project.id,
          details: editsResponsiveness
            ? "Named report approver edited and approved the responsiveness review."
            : JSON.stringify(updateFields),
        });
        return { kind: "updated", project } as const;
      },
      { isolationLevel: "read committed" },
    );
    if (outcome.kind === "reviewer_ineligible") {
      res.status(403).json({
        error:
          "The named reviewer is not currently eligible in this organisation.",
      });
      return;
    }
    if (outcome.kind === "changed") {
      res
        .status(409)
        .json({ error: "Project changed; reload before retrying" });
      return;
    }
    const row = await loadProjectWithJoins(outcome.project.id, organisationId);
    res.json(
      serializeProject(row!.project, {
        clientName: row!.clientName,
        ndaStatus: row!.ndaStatus,
        reviewerName: row!.reviewerName,
      }),
    );
  },
);

/**
 * One leg of the dual payment confirmation (FR-BIL-01). The confirming
 * identity is derived from the authenticated session — never from the
 * request body — and the two legs must be confirmed by different people.
 */
router.post(
  "/projects/:id/payment-confirmations",
  requirePermissionOrLegacy("project:update"),
  async (req: Request, res: Response) => {
    if (!PAYMENT_CONFIRMATION_ROLE_BINDING_ENABLED) {
      res.status(503).json({
        error:
          "Payment confirmation is disabled until founder and adviser authority is bound server-side.",
      });
      return;
    }
    const parsed = ConfirmProjectPaymentBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    const user = getLocalUser(req);
    const organisationId = getOrganisationId(req);
    if (!user) {
      res.status(403).json({ error: "Insufficient role" });
      return;
    }
    const [project] = await db
      .select()
      .from(projects)
      .where(
        and(
          eq(projects.id, String(req.params.id)),
          organisationId
            ? eq(projects.organisationId, organisationId)
            : undefined,
        ),
      );
    if (!project) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const role = parsed.data.role;
    const now = new Date();
    const patch =
      role === "founder"
        ? {
            paymentConfirmedByFounder: true,
            paymentFounderConfirmedBy: user.id,
            paymentFounderConfirmedByName: user.name ?? user.email,
            paymentFounderConfirmedAt: now,
          }
        : {
            paymentConfirmedByAdvisor: true,
            paymentAdvisorConfirmedBy: user.id,
            paymentAdvisorConfirmedByName: user.name ?? user.email,
            paymentAdvisorConfirmedAt: now,
          };
    // The distinct-actor invariant is re-asserted INSIDE the UPDATE's WHERE
    // (not just checked-then-written) so two concurrent requests from the
    // same user cannot both slip past the guard and stamp both legs.
    const otherLegColumn =
      role === "founder"
        ? projects.paymentAdvisorConfirmedBy
        : projects.paymentFounderConfirmedBy;
    const updated = await db.transaction(
      async (tx) => {
        const [confirmed] = await tx
          .update(projects)
          .set({
            ...patch,
            version: sql`${projects.version} + 1`,
            updatedAt: now,
          })
          .where(
            and(
              eq(projects.id, project.id),
              organisationId
                ? eq(projects.organisationId, organisationId)
                : undefined,
              or(isNull(otherLegColumn), ne(otherLegColumn, user.id)),
            ),
          )
          .returning();
        if (!confirmed) return undefined;
        if (
          confirmed.paymentConfirmedByFounder &&
          confirmed.paymentConfirmedByAdvisor &&
          !confirmed.paymentConfirmedAt
        ) {
          await tx
            .update(projects)
            .set({ paymentConfirmedAt: now, updatedAt: now })
            .where(eq(projects.id, project.id));
        }
        await writeAuditTx(tx, {
          user,
          organisationId,
          projectId: project.id,
          eventType: "project.payment_confirmed",
          objectType: "project",
          objectId: project.id,
          details: `${role} leg confirmed by ${user.name ?? user.email}`,
        });
        return confirmed;
      },
      { isolationLevel: "read committed" },
    );
    if (!updated) {
      res.status(409).json({
        error:
          "Dual confirmation requires two distinct people; you already confirmed the other leg.",
      });
      return;
    }
    const row = await loadProjectWithJoins(project.id, organisationId);
    res.json(
      serializeProject(row!.project, {
        clientName: row!.clientName,
        ndaStatus: row!.ndaStatus,
        reviewerName: row!.reviewerName,
      }),
    );
  },
);

router.delete(
  "/projects/:id",
  requirePermissionOrLegacy("project:delete"),
  (_req: Request, res: Response) => {
    res.status(409).json({
      error:
        "Direct deletion is disabled; use the governed retention detach, reconcile and certify workflow.",
    });
  },
);

router.post(
  "/projects/:id/responsiveness-review",
  requirePermissionOrLegacy("report:generate"),
  async (req: Request, res: Response) => {
    const releaseTenantWork = holdTenantDatabaseUntilComplete(req);
    const disconnectController = new AbortController();
    const abortOnDisconnect = () => disconnectController.abort();
    res.once("close", abortOnDisconnect);
    let workflowError: unknown;
    try {
      const organisationId = getOrganisationId(req);
      const [project] = await db
        .select()
        .from(projects)
        .where(
          and(
            eq(projects.id, String(req.params.id)),
            organisationId
              ? eq(projects.organisationId, organisationId)
              : undefined,
          ),
        );
      if (!project) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      const reviewedRequirements = await db
        .select({
          text: requirements.text,
          isMandatory: requirements.isMandatory,
        })
        .from(requirements)
        .where(
          and(
            eq(requirements.projectId, project.id),
            inArray(requirements.reviewStatus, ["confirmed", "edited"]),
          ),
        );
      const reviewedDefects = await db
        .select({
          type: defects.type,
          severity: defects.severity,
          description: defects.description,
        })
        .from(defects)
        .where(
          and(
            eq(defects.projectId, project.id),
            ne(defects.status, "suggested"),
          ),
        );
      if (reviewedRequirements.length === 0) {
        res.status(400).json({
          error: "No reviewed requirements available for responsiveness review",
        });
        return;
      }

      try {
        const { review, model } = await responsivenessReview(
          project.id,
          {
            tenderTitle: project.tenderTitle,
            requirements: reviewedRequirements,
            defects: reviewedDefects,
          },
          { signal: disconnectController.signal },
        );
        await db.transaction(
          async (tx) => {
            await tx
              .update(projects)
              .set({
                responsivenessReview: review,
                responsivenessSuggested: true,
                version: sql`${projects.version} + 1`,
                updatedAt: new Date(),
              })
              .where(eq(projects.id, project.id));
            await writeAuditTx(tx, {
              user: getLocalUser(req),
              organisationId,
              projectId: project.id,
              eventType: "project.responsiveness_suggested",
              objectType: "project",
              objectId: project.id,
              details: `${reviewedRequirements.length} reviewed requirement(s); ${reviewedDefects.length} reviewed defect(s)`,
            });
          },
          { isolationLevel: "read committed" },
        );
        res.json({ review, model });
      } catch (error) {
        workflowError = error;
        req.log.error({ err: error }, "responsiveness review failed");
        if (
          !disconnectController.signal.aborted &&
          !res.headersSent &&
          !sendAiGatewayError(res, error)
        ) {
          res.status(502).json({ error: "AI responsiveness review failed" });
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

export default router;
