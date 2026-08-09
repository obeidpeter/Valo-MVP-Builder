import {
  Router,
  type IRouter,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  organisationMemberships,
  organisations,
  roleGrants,
  users,
  withTenantDatabase,
} from "@workspace/db";
import { getLocalUser } from "../middlewares/auth";
import {
  attachTenantContext,
  getAccessContext,
  requirePermission,
  parseExpectedVersion,
} from "../middlewares/tenancy";
import {
  canGrantRole,
  isActiveAccessWindow,
  isOrganisationRole,
  isRoleAllowedForOrganisation,
  type OrganisationRole,
  type OrganisationType,
} from "../lib/permissions";
import { writeAuditTx } from "../lib/audit";
import {
  isBootstrapIdentity,
  parseBootstrapOrganisationConfig,
  shouldAutoProvisionBootstrapOrganisation,
} from "../lib/bootstrap";

const router: IRouter = Router();
const ORGANISATION_TYPES = new Set<OrganisationType>([
  "client",
  "valo",
  "consultancy_partner",
]);

function requirePlatformBootstrap(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const user = getLocalUser(req);
  if (!user || user.role !== "restricted_platform_administrator") {
    res
      .status(403)
      .json({ error: "Restricted platform administrator required" });
    return;
  }
  next();
}

function requireSelectedOrganisation(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const context = getAccessContext(req);
  if (
    !context ||
    context.organisationId !== String(req.params.organisationId)
  ) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  next();
}

function optionalFutureDate(value: unknown): Date | null | "invalid" {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return "invalid";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) || date.getTime() <= Date.now()
    ? "invalid"
    : date;
}

function defaultOwnerRole(type: OrganisationType): OrganisationRole {
  if (type === "client") return "client_organisation_owner";
  if (type === "consultancy_partner")
    return "consultancy_partner_administrator";
  return "restricted_platform_administrator";
}

async function maybeProvisionConfiguredBootstrapOrganisation(
  req: Request,
  membershipCount: number,
): Promise<void> {
  const user = getLocalUser(req);
  if (!user || membershipCount !== 0) return;
  const config = parseBootstrapOrganisationConfig({
    enabled: process.env.VALO_BOOTSTRAP_ORGANISATION_ENABLED,
    name: process.env.VALO_BOOTSTRAP_ORGANISATION_NAME,
    slug: process.env.VALO_BOOTSTRAP_ORGANISATION_SLUG,
  });
  if (!config) return;
  const [{ count: organisationCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(organisations);
  const identityAllowlisted = isBootstrapIdentity(
    { clerkUserId: user.clerkUserId, email: user.email },
    {
      clerkUserIds: process.env.VALO_BOOTSTRAP_CLERK_USER_IDS,
      emails: process.env.VALO_BOOTSTRAP_EMAILS,
    },
  );
  if (
    !shouldAutoProvisionBootstrapOrganisation({
      config,
      identityAllowlisted,
      userRole: user.role,
      membershipCount,
      organisationCount,
    })
  ) {
    return;
  }

  const organisationId = randomUUID();
  await withTenantDatabase(organisationId, () =>
    db.transaction(
      async (tx) => {
        const [organisation] = await tx
          .insert(organisations)
          .values({
            id: organisationId,
            name: config.name,
            slug: config.slug,
            type: "valo",
            createdBy: user.id,
          })
          .returning();
        const [membership] = await tx
          .insert(organisationMemberships)
          .values({ organisationId, userId: user.id })
          .returning();
        await tx.insert(roleGrants).values({
          membershipId: membership.id,
          // The identity row keeps the platform-only bootstrap role. The
          // tenant grant is operational (not quality/sign-off authority) so
          // the first explicitly allowlisted operator can actually initialise
          // the workbench without a direct database edit.
          role: "valo_operations_administrator",
        });
        await writeAuditTx(tx, {
          user,
          organisationId,
          eventType: "organisation.bootstrap_provisioned",
          objectType: "organisation",
          objectId: organisation.id,
          details: JSON.stringify({
            name: config.name,
            slug: config.slug,
            type: "valo",
            tenantRole: "valo_operations_administrator",
            source: "explicit_environment_configuration",
          }),
        });
      },
      { isolationLevel: "serializable" },
    ),
  );
}

router.get("/organisations", async (req: Request, res: Response) => {
  const user = getLocalUser(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const now = new Date();
  let rows = await db
    .select({
      membership: organisationMemberships,
      organisation: organisations,
    })
    .from(organisationMemberships)
    .innerJoin(
      organisations,
      eq(organisationMemberships.organisationId, organisations.id),
    )
    .where(eq(organisationMemberships.userId, user.id));
  if (rows.length === 0) {
    try {
      await maybeProvisionConfiguredBootstrapOrganisation(req, rows.length);
      rows = await db
        .select({
          membership: organisationMemberships,
          organisation: organisations,
        })
        .from(organisationMemberships)
        .innerJoin(
          organisations,
          eq(organisationMemberships.organisationId, organisations.id),
        )
        .where(eq(organisationMemberships.userId, user.id));
    } catch (error) {
      if ((error as { code?: string }).code !== "23505") throw error;
      req.log.warn(
        { err: error },
        "bootstrap organisation was created by a concurrent request",
      );
      rows = await db
        .select({
          membership: organisationMemberships,
          organisation: organisations,
        })
        .from(organisationMemberships)
        .innerJoin(
          organisations,
          eq(organisationMemberships.organisationId, organisations.id),
        )
        .where(eq(organisationMemberships.userId, user.id));
    }
  }
  const active = rows.filter(
    ({ membership, organisation }) =>
      organisation.status === "active" &&
      isActiveAccessWindow(
        {
          status: membership.status,
          startsAt: membership.accessStartsAt,
          expiresAt: membership.accessExpiresAt,
        },
        now,
      ),
  );
  const membershipIds = active.map(({ membership }) => membership.id);
  const grants =
    membershipIds.length === 0
      ? []
      : await db
          .select()
          .from(roleGrants)
          .where(inArray(roleGrants.membershipId, membershipIds));
  res.json(
    active.map(({ membership, organisation }) => ({
      id: organisation.id,
      name: organisation.name,
      slug: organisation.slug,
      type: organisation.type,
      status: organisation.status,
      countryCode: organisation.countryCode,
      membershipId: membership.id,
      accessExpiresAt: membership.accessExpiresAt?.toISOString() ?? null,
      roles: grants
        .filter(
          (grant) =>
            grant.membershipId === membership.id &&
            isActiveAccessWindow(
              {
                status: grant.revokedAt ? "revoked" : "active",
                startsAt: grant.startsAt,
                expiresAt: grant.expiresAt,
                revokedAt: grant.revokedAt,
              },
              now,
            ),
        )
        .map((grant) => grant.role),
      version: organisation.version,
    })),
  );
});

router.post(
  "/organisations",
  requirePlatformBootstrap,
  async (req: Request, res: Response) => {
    const user = getLocalUser(req)!;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const slug =
      typeof body.slug === "string" ? body.slug.trim().toLowerCase() : "";
    const type = body.type;
    if (
      name.length < 2 ||
      name.length > 160 ||
      !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(slug) ||
      typeof type !== "string" ||
      !ORGANISATION_TYPES.has(type as OrganisationType)
    ) {
      res.status(400).json({ error: "Invalid organisation" });
      return;
    }
    try {
      const organisationId = randomUUID();
      const created = await withTenantDatabase(organisationId, () =>
        db.transaction(
          async (tx) => {
            const [organisation] = await tx
              .insert(organisations)
              .values({
                id: organisationId,
                name,
                slug,
                type,
                createdBy: user.id,
              })
              .returning();
            const [membership] = await tx
              .insert(organisationMemberships)
              .values({ organisationId: organisation.id, userId: user.id })
              .returning();
            await tx.insert(roleGrants).values({
              membershipId: membership.id,
              role: defaultOwnerRole(type as OrganisationType),
            });
            await writeAuditTx(tx, {
              user,
              organisationId: organisation.id,
              eventType: "organisation.created",
              objectType: "organisation",
              objectId: organisation.id,
              details: JSON.stringify({ name, slug, type }),
            });
            return { organisation, membership };
          },
          { isolationLevel: "read committed" },
        ),
      );
      res.status(201).json({
        ...created.organisation,
        membershipId: created.membership.id,
      });
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        res.status(409).json({ error: "Organisation slug already exists" });
        return;
      }
      throw error;
    }
  },
);

router.get(
  "/organisations/:organisationId/memberships",
  attachTenantContext,
  requireSelectedOrganisation,
  requirePermission("membership:read"),
  async (req: Request, res: Response) => {
    const organisationId = String(req.params.organisationId);
    const { rows, grants } = await withTenantDatabase(
      organisationId,
      async () => {
        const rows = await db
          .select({ membership: organisationMemberships, user: users })
          .from(organisationMemberships)
          .innerJoin(users, eq(organisationMemberships.userId, users.id))
          .where(eq(organisationMemberships.organisationId, organisationId));
        const ids = rows.map(({ membership }) => membership.id);
        const grants = ids.length
          ? await db
              .select()
              .from(roleGrants)
              .where(inArray(roleGrants.membershipId, ids))
          : [];
        return { rows, grants };
      },
    );
    res.json(
      rows.map(({ membership, user }) => ({
        id: membership.id,
        user: { id: user.id, email: user.email, name: user.name },
        status: membership.status,
        accessStartsAt: membership.accessStartsAt?.toISOString() ?? null,
        accessExpiresAt: membership.accessExpiresAt?.toISOString() ?? null,
        roles: grants
          .filter(
            (grant) => grant.membershipId === membership.id && !grant.revokedAt,
          )
          .map((grant) => ({
            id: grant.id,
            role: grant.role,
            startsAt: grant.startsAt?.toISOString() ?? null,
            expiresAt: grant.expiresAt?.toISOString() ?? null,
          })),
        version: membership.version,
      })),
    );
  },
);

router.post(
  "/organisations/:organisationId/memberships",
  attachTenantContext,
  requireSelectedOrganisation,
  requirePermission("membership:manage"),
  async (req: Request, res: Response) => {
    const context = getAccessContext(req)!;
    if (context.source !== "membership") {
      res
        .status(403)
        .json({ error: "Direct organisation administration required" });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const userId = typeof body.userId === "string" ? body.userId : "";
    const role = body.role;
    const accessExpiresAt = optionalFutureDate(body.accessExpiresAt);
    const roleExpiresAt = optionalFutureDate(body.roleExpiresAt);
    if (
      !userId ||
      !isOrganisationRole(role) ||
      accessExpiresAt === "invalid" ||
      roleExpiresAt === "invalid"
    ) {
      res.status(400).json({ error: "Invalid membership grant" });
      return;
    }
    if (!canGrantRole(context.roles, role)) {
      res.status(403).json({ error: "Role delegation denied" });
      return;
    }
    const organisationId = String(req.params.organisationId);
    const outcome = await withTenantDatabase(organisationId, async () => {
      const [[organisation], [targetUser]] = await Promise.all([
        db
          .select()
          .from(organisations)
          .where(eq(organisations.id, organisationId)),
        db.select().from(users).where(eq(users.id, userId)),
      ]);
      if (!organisation || !targetUser) return { kind: "not_found" as const };
      if (
        !isRoleAllowedForOrganisation(
          role,
          organisation.type as OrganisationType,
        )
      ) {
        return { kind: "invalid_role" as const };
      }
      const result = await db.transaction(
        async (tx) => {
          const [existingMembership] = await tx
            .select()
            .from(organisationMemberships)
            .where(
              and(
                eq(organisationMemberships.organisationId, organisationId),
                eq(organisationMemberships.userId, userId),
              ),
            );
          if (existingMembership) {
            const existingGrants = await tx
              .select()
              .from(roleGrants)
              .where(
                and(
                  eq(roleGrants.membershipId, existingMembership.id),
                  eq(roleGrants.role, role),
                ),
              );
            if (existingGrants.some((grant) => !grant.revokedAt)) {
              return { membership: existingMembership, duplicate: true };
            }
          }
          const [membership] = await tx
            .insert(organisationMemberships)
            .values({
              organisationId,
              userId,
              accessExpiresAt,
              delegatedByMembershipId: context.membershipId,
            })
            .onConflictDoUpdate({
              target: [
                organisationMemberships.organisationId,
                organisationMemberships.userId,
              ],
              set: {
                status: "active",
                accessExpiresAt,
                delegatedByMembershipId: context.membershipId,
                version: sql`${organisationMemberships.version} + 1`,
                updatedAt: new Date(),
              },
            })
            .returning();
          await tx.insert(roleGrants).values({
            membershipId: membership.id,
            role,
            grantedByMembershipId: context.membershipId,
            expiresAt: roleExpiresAt,
          });
          await writeAuditTx(tx, {
            user: getLocalUser(req),
            organisationId,
            eventType: "membership.role_granted",
            objectType: "membership",
            objectId: membership.id,
            details: JSON.stringify({
              targetUserId: userId,
              role,
              roleExpiresAt,
            }),
          });
          return { membership, duplicate: false };
        },
        { isolationLevel: "read committed" },
      );
      return { kind: "ok" as const, result };
    });
    if (outcome.kind === "not_found") {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (outcome.kind === "invalid_role") {
      res
        .status(400)
        .json({ error: "Role is not valid for this organisation type" });
      return;
    }
    const { result } = outcome;
    if (result.duplicate) {
      res.status(409).json({ error: "Role is already granted" });
      return;
    }
    res.status(201).json({ id: result.membership.id, role });
  },
);

router.patch(
  "/organisations/:organisationId/memberships/:membershipId",
  attachTenantContext,
  requireSelectedOrganisation,
  requirePermission("membership:manage"),
  async (req: Request, res: Response) => {
    const context = getAccessContext(req)!;
    if (context.source !== "membership") {
      res
        .status(403)
        .json({ error: "Direct organisation administration required" });
      return;
    }
    const expectedVersion = parseExpectedVersion(req.get("If-Match"));
    if (!expectedVersion) {
      res
        .status(428)
        .json({ error: "If-Match membership version is required" });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const allowedStatuses = new Set(["active", "suspended", "revoked"]);
    const status = body.status;
    const accessExpiresAt = optionalFutureDate(body.accessExpiresAt);
    if (
      (status !== undefined &&
        (typeof status !== "string" || !allowedStatuses.has(status))) ||
      accessExpiresAt === "invalid"
    ) {
      res.status(400).json({ error: "Invalid membership update" });
      return;
    }
    if (status === undefined && body.accessExpiresAt === undefined) {
      res.status(400).json({ error: "No membership changes supplied" });
      return;
    }
    const organisationId = String(req.params.organisationId);
    const updated = await withTenantDatabase(organisationId, () =>
      db.transaction(
        async (tx) => {
          const [membership] = await tx
            .update(organisationMemberships)
            .set({
              ...(typeof status === "string" ? { status } : {}),
              ...(body.accessExpiresAt !== undefined
                ? { accessExpiresAt }
                : {}),
              version: sql`${organisationMemberships.version} + 1`,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(organisationMemberships.id, String(req.params.membershipId)),
                eq(organisationMemberships.organisationId, organisationId),
                eq(organisationMemberships.version, expectedVersion),
              ),
            )
            .returning();
          if (!membership) return undefined;
          await writeAuditTx(tx, {
            user: getLocalUser(req),
            organisationId,
            eventType: "membership.updated",
            objectType: "membership",
            objectId: membership.id,
            details: JSON.stringify({ status, accessExpiresAt }),
          });
          return membership;
        },
        { isolationLevel: "read committed" },
      ),
    );
    if (!updated) {
      res
        .status(409)
        .json({ error: "Membership changed; reload before updating" });
      return;
    }
    res.setHeader("ETag", `"${updated.version}"`).json(updated);
  },
);

export default router;
