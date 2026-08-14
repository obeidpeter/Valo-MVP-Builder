import type { Request } from "express";
import { getLocalUser } from "../middlewares/auth";
import { getAccessContext, type AccessContext } from "../middlewares/tenancy";
import {
  resolveCurrentDirectAuthority,
  type CurrentDirectAuthority,
} from "../lib/directMembershipAuthority";
import type { Permission } from "../lib/permissions";

/**
 * Shared scaffolding for the small "suite" routers that resolve direct
 * membership authority per request. Only routers whose dependency-injection
 * options match these shapes exactly use this kit; routers with divergent
 * resolver signatures or statically pinned internals keep their local copies.
 */
export interface SuiteAuthorityOptions {
  resolveAccess?: (request: Request) => AccessContext | undefined;
  resolveActorUserId?: (request: Request) => string | undefined;
  resolveAuthority?: (
    context: AccessContext | undefined,
    actorUserId: string | undefined,
  ) => Promise<CurrentDirectAuthority | null>;
}

export interface SuiteAuthorityResolvers {
  resolveAccess: (request: Request) => AccessContext | undefined;
  resolveActorUserId: (request: Request) => string | undefined;
  resolveAuthority: (
    context: AccessContext | undefined,
    actorUserId: string | undefined,
  ) => Promise<CurrentDirectAuthority | null>;
}

export function resolveSuiteAuthorityDefaults(
  options: SuiteAuthorityOptions,
): SuiteAuthorityResolvers {
  return {
    resolveAccess: options.resolveAccess ?? getAccessContext,
    resolveActorUserId:
      options.resolveActorUserId ??
      ((request: Request) => getLocalUser(request)?.id),
    resolveAuthority: options.resolveAuthority ?? resolveCurrentDirectAuthority,
  };
}

/**
 * Bounded positive-integer query-limit parser: `undefined` falls back to the
 * default, anything except a 1-3 digit decimal string within the maximum is
 * rejected as `null`.
 */
export function createBoundedLimitParser(
  defaultLimit: number,
  maxLimit: number,
): (value: unknown) => number | null {
  return (value: unknown): number | null => {
    if (value === undefined) return defaultLimit;
    if (typeof value !== "string" || !/^[1-9][0-9]{0,2}$/u.test(value)) {
      return null;
    }
    const parsed = Number(value);
    return parsed <= maxLimit ? parsed : null;
  };
}

/**
 * Resolves the caller's direct authority and, when it carries the required
 * permission, maps it onto the vertical's request scope. Returns null (deny)
 * otherwise, or when the vertical's scope factory itself rejects the request.
 */
export async function authorisedScopeFor<Scope>(
  request: Request,
  permission: Permission,
  resolvers: SuiteAuthorityResolvers,
  scopeFor: (
    authority: CurrentDirectAuthority,
    request: Request,
  ) => Scope | null,
): Promise<Scope | null> {
  const authority = await resolvers.resolveAuthority(
    resolvers.resolveAccess(request),
    resolvers.resolveActorUserId(request),
  );
  return authority?.permissions.has(permission)
    ? scopeFor(authority, request)
    : null;
}
