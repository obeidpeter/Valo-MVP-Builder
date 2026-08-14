import type { Request } from "express";
import { getLocalUser } from "../middlewares/auth";
import type { AccessContext } from "../middlewares/tenancy";

export interface MembershipActorScope {
  organisationId: string;
  actorUserId: string;
  actorName: string;
  membershipId: string;
}

/**
 * Resolve the acting membership scope shared by the opportunity routes: the
 * request must carry an active membership-sourced access context and an active
 * actor with a non-empty, trimmed name. When
 * `requireMembershipOrganisationMatch` is set (the pursuit-handoff routes),
 * the membership's organisation must additionally match the access context's
 * organisation.
 */
export function resolveMembershipActorScope(
  request: Request,
  resolveAccess: (request: Request) => AccessContext | undefined,
  options: { requireMembershipOrganisationMatch: boolean },
): MembershipActorScope | null {
  const access = resolveAccess(request);
  const actor = getLocalUser(request);
  if (
    !access ||
    access.source !== "membership" ||
    !access.membershipId ||
    (options.requireMembershipOrganisationMatch &&
      access.membershipOrganisationId !== access.organisationId) ||
    !actor ||
    actor.status !== "active" ||
    typeof actor.name !== "string" ||
    actor.name !== actor.name.trim() ||
    actor.name.length < 1
  ) {
    return null;
  }
  return {
    organisationId: access.organisationId,
    actorUserId: actor.id,
    actorName: actor.name,
    membershipId: access.membershipId,
  };
}
