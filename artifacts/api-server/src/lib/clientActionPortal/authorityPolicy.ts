import {
  and,
  eq,
  exists,
  gt,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  or,
} from "drizzle-orm";
import {
  organisationMemberships,
  organisations,
  roleGrants,
  users,
} from "@workspace/db";
import {
  ORGANISATION_ROLES,
  ROLE_PERMISSIONS,
  isRoleAllowedForOrganisation,
  type OrganisationRole,
  type OrganisationType,
  type Permission,
} from "../permissions";
import { CLIENT_ACTION_BOUNDS, type ClientActionScope } from "./contracts";
import { ClientActionError } from "./errors";

const ORGANISATION_TYPES = [
  "client",
  "valo",
  "consultancy_partner",
] as const satisfies readonly OrganisationType[];

export type ClientActionAuthorityRoles = Readonly<
  Record<OrganisationType, readonly OrganisationRole[]>
>;
type ClientActionPolicyDatabase = Pick<
  (typeof import("@workspace/db"))["db"],
  "select"
>;

export function clientActionRolesForPermission(
  permission: Permission,
): ClientActionAuthorityRoles {
  const forType = (type: OrganisationType) =>
    ORGANISATION_ROLES.filter(
      (role) =>
        isRoleAllowedForOrganisation(role, type) &&
        ROLE_PERMISSIONS[role].includes(permission),
    );
  return {
    client: forType("client"),
    valo: forType("valo"),
    consultancy_partner: forType("consultancy_partner"),
  };
}

export const CLIENT_ACTION_CREATOR_ROLES =
  clientActionRolesForPermission("evidence:write");
export const CLIENT_ACTION_RECIPIENT_ROLES =
  clientActionRolesForPermission("document:upload");

function roleList(roles: readonly OrganisationRole[]): OrganisationRole[] {
  if (roles.length === 0) {
    throw new ClientActionError(
      "scope_denied",
      "Client action role policy is unavailable.",
    );
  }
  return [...roles];
}

/**
 * Canonical direct/current membership and permission predicate shared by the
 * authority directory and the write-time repository check.
 */
export function clientActionAuthorityPredicate(
  database: ClientActionPolicyDatabase,
  scope: ClientActionScope,
  now: Date,
  roles: ClientActionAuthorityRoles,
) {
  const currentPermissionGrant = database
    .select({ membershipId: roleGrants.membershipId })
    .from(roleGrants)
    .where(
      and(
        eq(roleGrants.membershipId, organisationMemberships.id),
        or(
          ...ORGANISATION_TYPES.map((type) =>
            and(
              eq(organisations.type, type),
              inArray(roleGrants.role, roleList(roles[type])),
            ),
          ),
        ),
        isNull(roleGrants.revokedAt),
        or(isNull(roleGrants.startsAt), lte(roleGrants.startsAt, now)),
        or(isNull(roleGrants.expiresAt), gt(roleGrants.expiresAt, now)),
      ),
    );

  return and(
    eq(organisationMemberships.organisationId, scope.organisationId),
    eq(organisationMemberships.status, "active"),
    isNull(organisationMemberships.delegatedByMembershipId),
    or(
      isNull(organisationMemberships.accessStartsAt),
      lte(organisationMemberships.accessStartsAt, now),
    ),
    or(
      isNull(organisationMemberships.accessExpiresAt),
      gt(organisationMemberships.accessExpiresAt, now),
    ),
    eq(organisations.status, "active"),
    eq(users.status, "active"),
    exists(currentPermissionGrant),
  );
}

export function clientActionRecipientPredicate(
  database: ClientActionPolicyDatabase,
  scope: ClientActionScope,
  now: Date,
) {
  return and(
    clientActionAuthorityPredicate(
      database,
      scope,
      now,
      CLIENT_ACTION_RECIPIENT_ROLES,
    ),
    ne(organisationMemberships.userId, scope.actorUserId),
    isNotNull(users.name),
  );
}

export function validClientActionAuthorityName(
  value: unknown,
): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value === value.trim() &&
    value.length <= CLIENT_ACTION_BOUNDS.authorityName &&
    !/[\u0000-\u001f\u007f\ud800-\udfff]/u.test(value)
  );
}
