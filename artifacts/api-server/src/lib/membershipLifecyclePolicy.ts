import {
  canGrantRole,
  hasPermission,
  isActiveAccessWindow,
  isOrganisationRole,
  type OrganisationRole,
} from "./permissions";

export interface MembershipLifecycleSnapshot {
  id: string;
  userId?: string;
  status: string;
  accessStartsAt?: Date | string | null;
  accessExpiresAt?: Date | string | null;
}

export interface RoleGrantLifecycleSnapshot {
  membershipId: string;
  role: string;
  startsAt?: Date | string | null;
  expiresAt?: Date | string | null;
  revokedAt?: Date | string | null;
}

export type MembershipAuthorityDenial =
  | "actor_authority_changed"
  | "role_delegation_denied"
  | "target_above_management_ceiling"
  | "unsafe_self_grant"
  | "unsafe_self_lifecycle_change"
  | "last_active_administrator"
  | "last_active_owner";

export type MembershipAuthorityDecision =
  | { allowed: true; actorRoles: OrganisationRole[] }
  | {
      allowed: false;
      actorRoles: OrganisationRole[];
      denial: MembershipAuthorityDenial;
    };

function toMillis(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

function grantCanStillTakeEffect(
  grant: RoleGrantLifecycleSnapshot,
  now: Date,
): boolean {
  if (grant.revokedAt) return false;
  if (!grant.expiresAt) return true;
  const expiresAt = toMillis(grant.expiresAt);
  // A malformed persisted window is not proof that a higher grant has ended.
  return !Number.isFinite(expiresAt) || expiresAt > now.getTime();
}

export function activeRolesForMembershipAt(
  membership: MembershipLifecycleSnapshot | undefined,
  grants: readonly RoleGrantLifecycleSnapshot[],
  at: Date,
): OrganisationRole[] {
  if (
    !membership ||
    !isActiveAccessWindow(
      {
        status: membership.status,
        startsAt: membership.accessStartsAt,
        expiresAt: membership.accessExpiresAt,
      },
      at,
    )
  ) {
    return [];
  }

  return Array.from(
    new Set(
      grants.flatMap((grant) => {
        if (
          grant.membershipId !== membership.id ||
          !isOrganisationRole(grant.role) ||
          !isActiveAccessWindow(
            {
              status: grant.revokedAt ? "revoked" : "active",
              startsAt: grant.startsAt,
              expiresAt: grant.expiresAt,
              revokedAt: grant.revokedAt,
            },
            at,
          )
        ) {
          return [];
        }
        return [grant.role];
      }),
    ),
  );
}

/**
 * Scheduled grants count toward the target's management ceiling. Otherwise a
 * delegated administrator could reactivate a membership just before a
 * higher-authority grant starts. Expired and revoked grants cannot take effect
 * and therefore do not constrain a new mutation.
 */
export function canManageMembershipTarget(
  actorRoles: readonly OrganisationRole[],
  targetMembershipId: string,
  grants: readonly RoleGrantLifecycleSnapshot[],
  now: Date,
): boolean {
  return grants
    .filter(
      (grant) =>
        grant.membershipId === targetMembershipId &&
        grantCanStillTakeEffect(grant, now),
    )
    .every(
      (grant) =>
        isOrganisationRole(grant.role) && canGrantRole(actorRoles, grant.role),
    );
}

function hasAdministrativeAuthorityAt(
  membership: MembershipLifecycleSnapshot,
  grants: readonly RoleGrantLifecycleSnapshot[],
  at: Date,
): boolean {
  return hasPermission(
    activeRolesForMembershipAt(membership, grants, at),
    "membership:manage",
  );
}

function hasOwnerAuthorityAt(
  membership: MembershipLifecycleSnapshot,
  grants: readonly RoleGrantLifecycleSnapshot[],
  at: Date,
): boolean {
  return activeRolesForMembershipAt(membership, grants, at).includes(
    "client_organisation_owner",
  );
}

function hasAuthorityAt(
  membership: MembershipLifecycleSnapshot,
  grants: readonly RoleGrantLifecycleSnapshot[],
  at: Date,
  kind: "administrator" | "owner",
): boolean {
  return kind === "owner"
    ? hasOwnerAuthorityAt(membership, grants, at)
    : hasAdministrativeAuthorityAt(membership, grants, at);
}

function isAuthorityRole(
  role: string,
  kind: "administrator" | "owner",
): role is OrganisationRole {
  return (
    isOrganisationRole(role) &&
    (kind === "owner"
      ? role === "client_organisation_owner"
      : hasPermission([role], "membership:manage"))
  );
}

function windowStartMillis(value: Date | string | null | undefined): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const millis = toMillis(value);
  // Match isActiveAccessWindow: an invalid start does not delay access.
  return Number.isFinite(millis) ? millis : Number.NEGATIVE_INFINITY;
}

function windowEndMillis(value: Date | string | null | undefined): number {
  if (!value) return Number.POSITIVE_INFINITY;
  const millis = toMillis(value);
  // Match isActiveAccessWindow: an invalid expiry does not end access.
  return Number.isFinite(millis) ? millis : Number.POSITIVE_INFINITY;
}

function membershipCanHoldAuthorityAtOrAfter(
  membership: MembershipLifecycleSnapshot,
  grants: readonly RoleGrantLifecycleSnapshot[],
  now: Date,
  kind: "administrator" | "owner",
): boolean {
  if (membership.status !== "active") return false;
  const membershipStartsAt = windowStartMillis(membership.accessStartsAt);
  const membershipExpiresAt = windowEndMillis(membership.accessExpiresAt);

  return grants.some((grant) => {
    if (
      grant.membershipId !== membership.id ||
      grant.revokedAt ||
      !isAuthorityRole(grant.role, kind)
    ) {
      return false;
    }
    const effectiveStart = Math.max(
      now.getTime(),
      membershipStartsAt,
      windowStartMillis(grant.startsAt),
    );
    const effectiveEnd = Math.min(
      membershipExpiresAt,
      windowEndMillis(grant.expiresAt),
    );
    return effectiveStart < effectiveEnd;
  });
}

/**
 * Authority is piecewise constant between membership/grant boundaries. Check
 * the proposed organisation at every such boundary, including starts as well
 * as expiries, so a scheduled successor cannot hide an authority gap.
 */
function hasContinuousAuthority(
  memberships: readonly MembershipLifecycleSnapshot[],
  grants: readonly RoleGrantLifecycleSnapshot[],
  now: Date,
  kind: "administrator" | "owner",
): boolean {
  const nowMillis = now.getTime();
  const boundaries = new Set<number>([nowMillis]);
  const addFutureBoundary = (value: Date | string | null | undefined): void => {
    if (!value) return;
    const boundary = toMillis(value);
    if (Number.isFinite(boundary) && boundary > nowMillis) {
      boundaries.add(boundary);
    }
  };

  for (const membership of memberships) {
    if (membership.status !== "active") continue;
    addFutureBoundary(membership.accessStartsAt);
    addFutureBoundary(membership.accessExpiresAt);
  }
  for (const grant of grants) {
    if (grant.revokedAt || !isAuthorityRole(grant.role, kind)) continue;
    addFutureBoundary(grant.startsAt);
    addFutureBoundary(grant.expiresAt);
  }

  return [...boundaries]
    .sort((left, right) => left - right)
    .every((boundary) => {
      const atBoundary = new Date(boundary);
      return memberships.some((membership) =>
        hasAuthorityAt(membership, grants, atBoundary, kind),
      );
    });
}

function hasOtherAuthorityAt(
  memberships: readonly MembershipLifecycleSnapshot[],
  grants: readonly RoleGrantLifecycleSnapshot[],
  targetMembershipId: string,
  at: Date,
  predicate: (
    membership: MembershipLifecycleSnapshot,
    grants: readonly RoleGrantLifecycleSnapshot[],
    at: Date,
  ) => boolean,
): boolean {
  return memberships.some(
    (membership) =>
      membership.id !== targetMembershipId && predicate(membership, grants, at),
  );
}

export function evaluateMembershipGrantAuthority(input: {
  actorMembershipId: string;
  actorUserId?: string;
  targetMembershipId?: string;
  requestedRole: OrganisationRole;
  memberships: readonly MembershipLifecycleSnapshot[];
  grants: readonly RoleGrantLifecycleSnapshot[];
  now: Date;
}): MembershipAuthorityDecision {
  const actorMembership = input.memberships.find(
    (membership) => membership.id === input.actorMembershipId,
  );
  const actorRoles = activeRolesForMembershipAt(
    actorMembership,
    input.grants,
    input.now,
  );
  if (
    (input.actorUserId && actorMembership?.userId !== input.actorUserId) ||
    !hasPermission(actorRoles, "membership:manage")
  ) {
    return { allowed: false, actorRoles, denial: "actor_authority_changed" };
  }
  if (
    input.targetMembershipId &&
    input.targetMembershipId === input.actorMembershipId
  ) {
    return { allowed: false, actorRoles, denial: "unsafe_self_grant" };
  }
  if (!canGrantRole(actorRoles, input.requestedRole)) {
    return { allowed: false, actorRoles, denial: "role_delegation_denied" };
  }
  if (
    input.targetMembershipId &&
    !canManageMembershipTarget(
      actorRoles,
      input.targetMembershipId,
      input.grants,
      input.now,
    )
  ) {
    return {
      allowed: false,
      actorRoles,
      denial: "target_above_management_ceiling",
    };
  }
  return { allowed: true, actorRoles };
}

function shortensAccessWindow(
  membership: MembershipLifecycleSnapshot,
  nextAccessExpiresAt: Date | null,
): boolean {
  if (!nextAccessExpiresAt) return false;
  if (!membership.accessExpiresAt) return true;
  return nextAccessExpiresAt.getTime() < toMillis(membership.accessExpiresAt);
}

export function evaluateMembershipLifecycleAuthority(input: {
  actorMembershipId: string;
  actorUserId?: string;
  targetMembershipId: string;
  memberships: readonly MembershipLifecycleSnapshot[];
  grants: readonly RoleGrantLifecycleSnapshot[];
  nextStatus?: "active" | "suspended" | "revoked";
  changesAccessStart?: boolean;
  nextAccessStartsAt?: Date | string | null;
  changesAccessExpiry: boolean;
  nextAccessExpiresAt: Date | null;
  checksProposedAuthorityLoss?: boolean;
  now: Date;
}): MembershipAuthorityDecision {
  const actorMembership = input.memberships.find(
    (membership) => membership.id === input.actorMembershipId,
  );
  const targetMembership = input.memberships.find(
    (membership) => membership.id === input.targetMembershipId,
  );
  const actorRoles = activeRolesForMembershipAt(
    actorMembership,
    input.grants,
    input.now,
  );
  if (
    !actorMembership ||
    (input.actorUserId && actorMembership.userId !== input.actorUserId) ||
    !targetMembership ||
    !hasPermission(actorRoles, "membership:manage")
  ) {
    return { allowed: false, actorRoles, denial: "actor_authority_changed" };
  }
  if (
    !canManageMembershipTarget(
      actorRoles,
      targetMembership.id,
      input.grants,
      input.now,
    )
  ) {
    return {
      allowed: false,
      actorRoles,
      denial: "target_above_management_ceiling",
    };
  }

  if (
    actorMembership.id === targetMembership.id &&
    ((input.nextStatus !== undefined && input.nextStatus !== "active") ||
      input.changesAccessExpiry)
  ) {
    return {
      allowed: false,
      actorRoles,
      denial: "unsafe_self_lifecycle_change",
    };
  }

  const targetIsAdministrator = hasAdministrativeAuthorityAt(
    targetMembership,
    input.grants,
    input.now,
  );
  const targetIsOwner = hasOwnerAuthorityAt(
    targetMembership,
    input.grants,
    input.now,
  );
  const removesAccessNow =
    input.nextStatus === "suspended" || input.nextStatus === "revoked";

  if (removesAccessNow && targetIsOwner) {
    if (
      !hasOtherAuthorityAt(
        input.memberships,
        input.grants,
        targetMembership.id,
        input.now,
        hasOwnerAuthorityAt,
      )
    ) {
      return { allowed: false, actorRoles, denial: "last_active_owner" };
    }
  }
  if (removesAccessNow && targetIsAdministrator) {
    if (
      !hasOtherAuthorityAt(
        input.memberships,
        input.grants,
        targetMembership.id,
        input.now,
        hasAdministrativeAuthorityAt,
      )
    ) {
      return {
        allowed: false,
        actorRoles,
        denial: "last_active_administrator",
      };
    }
  }

  const proposedTarget: MembershipLifecycleSnapshot = {
    ...targetMembership,
    status: input.nextStatus ?? targetMembership.status,
    accessStartsAt: input.changesAccessStart
      ? input.nextAccessStartsAt
      : targetMembership.accessStartsAt,
    accessExpiresAt: input.changesAccessExpiry
      ? input.nextAccessExpiresAt
      : targetMembership.accessExpiresAt,
  };
  const reactivatesTarget =
    !isActiveAccessWindow(
      {
        status: targetMembership.status,
        startsAt: targetMembership.accessStartsAt,
        expiresAt: targetMembership.accessExpiresAt,
      },
      input.now,
    ) && proposedTarget.status === "active";
  const schedulesEarlierExpiry =
    input.changesAccessExpiry &&
    input.nextStatus !== "suspended" &&
    input.nextStatus !== "revoked" &&
    shortensAccessWindow(targetMembership, input.nextAccessExpiresAt);
  const proposedMemberships = input.memberships.map((membership) =>
    membership.id === targetMembership.id ? proposedTarget : membership,
  );
  const validatesContinuousAuthority =
    reactivatesTarget ||
    removesAccessNow ||
    schedulesEarlierExpiry ||
    input.changesAccessStart ||
    input.checksProposedAuthorityLoss;
  if (validatesContinuousAuthority) {
    if (
      (membershipCanHoldAuthorityAtOrAfter(
        targetMembership,
        input.grants,
        input.now,
        "owner",
      ) ||
        membershipCanHoldAuthorityAtOrAfter(
          proposedTarget,
          input.grants,
          input.now,
          "owner",
        )) &&
      !hasContinuousAuthority(
        proposedMemberships,
        input.grants,
        input.now,
        "owner",
      )
    ) {
      return { allowed: false, actorRoles, denial: "last_active_owner" };
    }
    if (
      (membershipCanHoldAuthorityAtOrAfter(
        targetMembership,
        input.grants,
        input.now,
        "administrator",
      ) ||
        membershipCanHoldAuthorityAtOrAfter(
          proposedTarget,
          input.grants,
          input.now,
          "administrator",
        )) &&
      !hasContinuousAuthority(
        proposedMemberships,
        input.grants,
        input.now,
        "administrator",
      )
    ) {
      return {
        allowed: false,
        actorRoles,
        denial: "last_active_administrator",
      };
    }
  }

  return { allowed: true, actorRoles };
}
