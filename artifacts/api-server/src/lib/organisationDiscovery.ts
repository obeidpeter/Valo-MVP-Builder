import { continuousAccessExpiry } from "./continuousAccess";
import {
  isActiveAccessWindow,
  isOrganisationRole,
  isRoleAllowedForOrganisation,
  type OrganisationRole,
  type OrganisationType,
} from "./permissions";

export type DiscoveryRoleGrant = Readonly<{
  membershipId: string;
  role: string;
  startsAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
}>;

export function discoverableOrganisationRoleAccess(
  membershipId: string,
  organisationType: OrganisationType,
  grants: readonly DiscoveryRoleGrant[],
  now: Date,
): Readonly<{
  roles: OrganisationRole[];
  roleAccessExpiresAt: Date | null;
}> | null {
  const eligible = grants.filter(
    (grant) =>
      grant.membershipId === membershipId &&
      !grant.revokedAt &&
      isOrganisationRole(grant.role) &&
      isRoleAllowedForOrganisation(grant.role, organisationType),
  );
  const roles = Array.from(
    new Set(
      eligible.flatMap((grant) =>
        isActiveAccessWindow(
          {
            status: "active",
            startsAt: grant.startsAt,
            expiresAt: grant.expiresAt,
          },
          now,
        )
          ? [grant.role as OrganisationRole]
          : [],
      ),
    ),
  );
  if (roles.length === 0) return null;

  const roleAccessExpiresAt = continuousAccessExpiry(eligible, now);
  if (roleAccessExpiresAt === undefined) return null;
  return { roles, roleAccessExpiresAt };
}
