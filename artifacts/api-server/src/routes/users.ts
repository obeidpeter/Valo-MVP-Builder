import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, organisationMemberships, users } from "@workspace/db";
import {
  getOrganisationId,
  requirePermissionOrLegacy,
} from "../middlewares/tenancy";
import { serializeUser } from "../lib/serializers";
import {
  currentProjectReviewerAuthorityTime,
  hasProjectReviewerAuthority,
  loadCurrentProjectMembershipAuthorities,
} from "../lib/projectReviewerAuthority";

const router: IRouter = Router();

router.get(
  "/users",
  requirePermissionOrLegacy("membership:read"),
  async (req: Request, res: Response) => {
    const organisationId = getOrganisationId(req);
    if (!organisationId) {
      res.status(403).json({ error: "Organisation context is required." });
      return;
    }
    const authorityTime = await currentProjectReviewerAuthorityTime(db);
    const currentAuthorities = await loadCurrentProjectMembershipAuthorities(
      db,
      organisationId,
      authorityTime,
    );
    const authorityByMembership = new Map(
      currentAuthorities.map((authority) => [
        authority.membershipId,
        authority,
      ]),
    );
    const rows = await db
      .select({ user: users, membership: organisationMemberships })
      .from(organisationMemberships)
      .innerJoin(users, eq(organisationMemberships.userId, users.id))
      .where(eq(organisationMemberships.organisationId, organisationId))
      .orderBy(users.createdAt);
    res.json(
      rows.map(({ user, membership }) => {
        const authority = authorityByMembership.get(membership.id);
        return {
          ...serializeUser(user),
          role: authority?.roles[0] ?? "none",
          membershipId: membership.id,
          membershipStatus: membership.status,
          membershipVersion: membership.version,
          reviewerEligible: hasProjectReviewerAuthority(authority),
        };
      }),
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
