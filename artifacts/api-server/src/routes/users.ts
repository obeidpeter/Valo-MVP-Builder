import { Router, type IRouter, type Request, type Response } from "express";
import { eq, inArray } from "drizzle-orm";
import { db, organisationMemberships, roleGrants, users } from "@workspace/db";
import {
  getOrganisationId,
  requirePermissionOrLegacy,
} from "../middlewares/tenancy";
import { serializeUser } from "../lib/serializers";

const router: IRouter = Router();

router.get(
  "/users",
  requirePermissionOrLegacy("membership:read"),
  async (req: Request, res: Response) => {
    const organisationId = getOrganisationId(req);
    const rows = await db
      .select({ user: users, membership: organisationMemberships })
      .from(organisationMemberships)
      .innerJoin(users, eq(organisationMemberships.userId, users.id))
      .where(
        organisationId
          ? eq(organisationMemberships.organisationId, organisationId)
          : undefined,
      )
      .orderBy(users.createdAt);
    const membershipIds = rows.map(({ membership }) => membership.id);
    const grants = membershipIds.length
      ? await db
          .select()
          .from(roleGrants)
          .where(inArray(roleGrants.membershipId, membershipIds))
      : [];
    res.json(
      rows.map(({ user, membership }) => ({
        ...serializeUser(user),
        role:
          grants.find(
            (grant) => grant.membershipId === membership.id && !grant.revokedAt,
          )?.role ?? "none",
        membershipId: membership.id,
        membershipStatus: membership.status,
        membershipVersion: membership.version,
      })),
    );
  },
);

router.patch(
  "/users/:id",
  requirePermissionOrLegacy("membership:manage"),
  async (_req: Request, res: Response) => {
    res.status(410).json({
      error:
        "Global user-role updates are retired; update the organisation membership with If-Match instead",
    });
  },
);

export default router;
