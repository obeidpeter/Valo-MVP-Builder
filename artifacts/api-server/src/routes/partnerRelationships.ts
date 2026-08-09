import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import {
  db,
  organisations,
  partnerRelationships,
  withTenantDatabase,
} from "@workspace/db";
import { getLocalUser } from "../middlewares/auth";
import {
  attachTenantContext,
  getAccessContext,
  parseExpectedVersion,
  requirePermission,
} from "../middlewares/tenancy";
import { isTenantFeatureEnabled } from "../lib/featureFlags";
import { writeAuditTx } from "../lib/audit";

const router: IRouter = Router();

function futureDate(value: unknown): Date | null | "invalid" {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return "invalid";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()
    ? "invalid"
    : parsed;
}

router.get(
  "/partner-relationships",
  attachTenantContext,
  requirePermission("partner_relationship:read"),
  async (req: Request, res: Response) => {
    const organisationId = getAccessContext(req)!.organisationId;
    const rows = await withTenantDatabase(organisationId, () =>
      db
        .select()
        .from(partnerRelationships)
        .where(
          or(
            eq(partnerRelationships.partnerOrganisationId, organisationId),
            eq(partnerRelationships.clientOrganisationId, organisationId),
          ),
        ),
    );
    res.json(rows);
  },
);

router.post(
  "/partner-relationships",
  attachTenantContext,
  requirePermission("partner_relationship:manage"),
  async (req: Request, res: Response) => {
    const context = getAccessContext(req)!;
    if (context.source !== "membership") {
      res.status(403).json({ error: "Direct partner administration required" });
      return;
    }
    const [partner] = await db
      .select()
      .from(organisations)
      .where(eq(organisations.id, context.organisationId));
    if (!partner || partner.type !== "consultancy_partner") {
      res
        .status(403)
        .json({ error: "Consultancy partner organisation required" });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const clientOrganisationId =
      typeof body.clientOrganisationId === "string"
        ? body.clientOrganisationId
        : "";
    const accessExpiresAt = futureDate(body.accessExpiresAt);
    const qaResponsibility =
      typeof body.qaResponsibility === "string"
        ? body.qaResponsibility.trim()
        : null;
    if (
      !clientOrganisationId ||
      clientOrganisationId === partner.id ||
      accessExpiresAt === "invalid" ||
      (qaResponsibility && qaResponsibility.length > 500)
    ) {
      res.status(400).json({ error: "Invalid partner relationship" });
      return;
    }
    const [client] = await db
      .select()
      .from(organisations)
      .where(eq(organisations.id, clientOrganisationId));
    if (!client || client.type !== "client" || client.status !== "active") {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const created = await withTenantDatabase(partner.id, () =>
      db.transaction(
        async (tx) => {
          const [relationship] = await tx
            .insert(partnerRelationships)
            .values({
              partnerOrganisationId: partner.id,
              clientOrganisationId,
              qaResponsibility,
              coSigningRequired: body.coSigningRequired === true,
              accessExpiresAt,
            })
            .onConflictDoNothing()
            .returning();
          if (!relationship) return undefined;
          await writeAuditTx(tx, {
            user: getLocalUser(req),
            organisationId: partner.id,
            eventType: "partner_relationship.requested",
            objectType: "partner_relationship",
            objectId: relationship.id,
            details: JSON.stringify({ clientOrganisationId, accessExpiresAt }),
          });
          return relationship;
        },
        { isolationLevel: "read committed" },
      ),
    );
    if (!created) {
      res.status(409).json({ error: "Partner relationship already exists" });
      return;
    }
    res.status(201).json(created);
  },
);

router.post(
  "/partner-relationships/:id/approve",
  attachTenantContext,
  requirePermission("partner_relationship:manage"),
  async (req: Request, res: Response) => {
    const context = getAccessContext(req)!;
    if (context.source !== "membership") {
      res.status(403).json({ error: "Direct client administration required" });
      return;
    }
    const expectedVersion = parseExpectedVersion(req.get("If-Match"));
    if (!expectedVersion) {
      res
        .status(428)
        .json({ error: "If-Match relationship version is required" });
      return;
    }
    if (
      !(await withTenantDatabase(context.organisationId, () =>
        isTenantFeatureEnabled(context.organisationId, "partner_edition"),
      ))
    ) {
      res
        .status(409)
        .json({ error: "Partner edition is not commercially activated" });
      return;
    }
    const now = new Date();
    const approved = await withTenantDatabase(context.organisationId, () =>
      db.transaction(
        async (tx) => {
          const [relationship] = await tx
            .update(partnerRelationships)
            .set({
              status: "active",
              approvedByMembershipId: context.membershipId,
              accessStartsAt: now,
              version: sql`${partnerRelationships.version} + 1`,
              updatedAt: now,
            })
            .where(
              and(
                eq(partnerRelationships.id, String(req.params.id)),
                eq(
                  partnerRelationships.clientOrganisationId,
                  context.organisationId,
                ),
                eq(partnerRelationships.status, "pending"),
                eq(partnerRelationships.version, expectedVersion),
              ),
            )
            .returning();
          if (!relationship) return undefined;
          await writeAuditTx(tx, {
            user: getLocalUser(req),
            organisationId: context.organisationId,
            eventType: "partner_relationship.approved",
            objectType: "partner_relationship",
            objectId: relationship.id,
            details: JSON.stringify({
              partnerOrganisationId: relationship.partnerOrganisationId,
            }),
          });
          return relationship;
        },
        { isolationLevel: "read committed" },
      ),
    );
    if (!approved) {
      res
        .status(409)
        .json({ error: "Relationship changed or cannot be approved" });
      return;
    }
    res.setHeader("ETag", `"${approved.version}"`).json(approved);
  },
);

router.post(
  "/partner-relationships/:id/lifecycle",
  attachTenantContext,
  requirePermission("partner_relationship:manage"),
  async (req: Request, res: Response) => {
    const context = getAccessContext(req)!;
    if (context.source !== "membership") {
      res.status(403).json({ error: "Direct client administration required" });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const action = body.action;
    if (action !== "suspended" && action !== "revoked") {
      res.status(400).json({ error: "Action must be suspended or revoked" });
      return;
    }
    const expectedVersion = parseExpectedVersion(req.get("If-Match"));
    if (!expectedVersion) {
      res
        .status(428)
        .json({ error: "If-Match relationship version is required" });
      return;
    }
    const now = new Date();
    const changed = await withTenantDatabase(context.organisationId, () =>
      db.transaction(
        async (tx) => {
          const allowedCurrentStates =
            action === "suspended"
              ? ["active"]
              : ["pending", "active", "suspended"];
          const [relationship] = await tx
            .update(partnerRelationships)
            .set({
              status: action,
              version: sql`${partnerRelationships.version} + 1`,
              updatedAt: now,
            })
            .where(
              and(
                eq(partnerRelationships.id, String(req.params.id)),
                eq(
                  partnerRelationships.clientOrganisationId,
                  context.organisationId,
                ),
                inArray(partnerRelationships.status, allowedCurrentStates),
                eq(partnerRelationships.version, expectedVersion),
              ),
            )
            .returning();
          if (!relationship) return undefined;
          await writeAuditTx(tx, {
            user: getLocalUser(req),
            organisationId: context.organisationId,
            eventType: `partner_relationship.${action}`,
            objectType: "partner_relationship",
            objectId: relationship.id,
            details: JSON.stringify({
              partnerOrganisationId: relationship.partnerOrganisationId,
              priorAllowedStates: allowedCurrentStates,
            }),
          });
          return relationship;
        },
        { isolationLevel: "read committed" },
      ),
    );
    if (!changed) {
      res
        .status(409)
        .json({ error: "Relationship changed or action is not permitted" });
      return;
    }
    res.setHeader("ETag", `"${changed.version}"`).json(changed);
  },
);

export default router;
