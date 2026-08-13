import { createHash } from "node:crypto";
import type { Request } from "express";

const OPERATION_FAMILIES = new Set([
  "access-reviews",
  "ai",
  "audit",
  "billing",
  "boq-checks",
  "capabilities",
  "claims-desk",
  "clients",
  "commercial",
  "communications",
  "consortium",
  "defects",
  "documents",
  "evidence",
  "evidence-renewals",
  "feature-flags",
  "intelligence",
  "memberships",
  "notifications",
  "operations",
  "opportunity-sources",
  "organisations",
  "packages",
  "partner-relationships",
  "privacy",
  "projects",
  "reports",
  "requirements",
  "retention-requests",
  "risk",
  "sbd",
  "storage",
  "vault-items",
]);

export interface AuthenticatedRateLimitPolicy {
  max: number;
  windowSeconds: number;
}

export function authenticatedActorRateLimitPolicy(
  environment: NodeJS.ProcessEnv = process.env,
): AuthenticatedRateLimitPolicy {
  return {
    max: boundedInteger(
      environment.AUTHENTICATED_ACTOR_RATE_LIMIT_MAX_REQUESTS,
      180,
      1,
      100_000,
    ),
    windowSeconds: boundedInteger(
      environment.AUTHENTICATED_ACTOR_RATE_LIMIT_WINDOW_SECONDS,
      60,
      1,
      3_600,
    ),
  };
}

function boundedInteger(
  raw: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback;
}

export function authenticatedRateLimitPolicy(
  environment: NodeJS.ProcessEnv = process.env,
): AuthenticatedRateLimitPolicy {
  return {
    max: boundedInteger(
      environment.AUTHENTICATED_RATE_LIMIT_MAX_REQUESTS,
      120,
      1,
      100_000,
    ),
    windowSeconds: boundedInteger(
      environment.AUTHENTICATED_RATE_LIMIT_WINDOW_SECONDS,
      60,
      1,
      3_600,
    ),
  };
}

/** Map every path onto a finite, source-controlled operation-family set. */
export function authenticatedRateLimitOperation(
  req: Pick<Request, "method" | "path">,
): string {
  const firstSegment = req.path.split("/").filter(Boolean)[0]?.toLowerCase();
  const family =
    firstSegment && OPERATION_FAMILIES.has(firstSegment)
      ? firstSegment
      : "other";
  return `${req.method.toUpperCase()}:${family}`;
}

export function authenticatedRateLimitKey(input: {
  actorId: string;
  accessSource: string;
  operation: string;
  organisationId: string;
}): string {
  return createHash("sha256")
    .update(
      [
        "valo-authenticated-rate-limit/v1",
        input.organisationId,
        input.actorId,
        input.accessSource,
        input.operation,
      ].join("\u0000"),
      "utf8",
    )
    .digest("hex");
}

/** One hard total cap across every authenticated mutation path for an actor. */
export function authenticatedActorRateLimitKey(actorId: string): string {
  return createHash("sha256")
    .update(
      ["valo-authenticated-actor-rate-limit/v1", actorId].join("\u0000"),
      "utf8",
    )
    .digest("hex");
}
