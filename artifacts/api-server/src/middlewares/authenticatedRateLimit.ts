import type { NextFunction, Request, RequestHandler, Response } from "express";
import { db, withIndependentTenantDatabase } from "@workspace/db";
import { sql } from "drizzle-orm";
import { getLocalUser } from "./auth";
import { getAccessContext } from "./tenancy";
import {
  authenticatedActorRateLimitKey,
  authenticatedActorRateLimitPolicy,
  authenticatedRateLimitKey,
  authenticatedRateLimitOperation,
  authenticatedRateLimitPolicy,
  type AuthenticatedRateLimitPolicy,
} from "./authenticatedRateLimitPolicy";
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export interface AuthenticatedRateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: Date;
}

export async function consumeAuthenticatedRateLimit(input: {
  bucketKeySha256: string;
  max: number;
  organisationId: string;
  windowSeconds: number;
}): Promise<AuthenticatedRateLimitResult> {
  const result = await db.execute(sql`
    WITH timing AS (
      SELECT
        pg_catalog.to_timestamp(
          pg_catalog.floor(
            extract(epoch FROM pg_catalog.clock_timestamp())
            / ${input.windowSeconds}
          )
          * ${input.windowSeconds}
        ) AS window_started_at
    ), consumed AS (
      INSERT INTO public.authenticated_rate_limit_buckets AS bucket (
        organisation_id,
        bucket_key_sha256,
        window_started_at,
        request_count,
        expires_at
      )
      SELECT
        ${input.organisationId}::uuid,
        ${input.bucketKeySha256},
        timing.window_started_at,
        1,
        timing.window_started_at
          + pg_catalog.make_interval(secs => ${input.windowSeconds})
      FROM timing
      ON CONFLICT (organisation_id, bucket_key_sha256, window_started_at)
      DO UPDATE SET
        request_count = least(
          bucket.request_count + 1,
          1000000
        ),
        expires_at = excluded.expires_at
      RETURNING request_count, expires_at
    )
    SELECT request_count, expires_at FROM consumed
  `);
  const row = result.rows[0];
  const count = Number(row?.request_count);
  const resetAt = new Date(String(row?.expires_at ?? ""));
  if (!Number.isSafeInteger(count) || !Number.isFinite(resetAt.getTime())) {
    throw new Error("Authenticated rate-limit projection is unavailable");
  }
  return {
    allowed: count <= input.max,
    limit: input.max,
    remaining: Math.max(0, input.max - count),
    resetAt,
  };
}

export async function consumeAuthenticatedActorRateLimit(input: {
  bucketKeySha256: string;
  max: number;
  windowSeconds: number;
}): Promise<AuthenticatedRateLimitResult> {
  const result = await db.execute(sql`
    SELECT allowed, remaining, reset_at
    FROM valo_security.consume_authenticated_actor_rate_limit(
      ${input.bucketKeySha256},
      ${input.windowSeconds},
      ${input.max}
    )
  `);
  const row = result.rows[0];
  const remaining = Number(row?.remaining);
  const resetAt = new Date(String(row?.reset_at ?? ""));
  if (
    result.rows.length !== 1 ||
    typeof row?.allowed !== "boolean" ||
    !Number.isSafeInteger(remaining) ||
    remaining < 0 ||
    !Number.isFinite(resetAt.valueOf())
  ) {
    throw new Error("Authenticated actor rate-limit projection is unavailable");
  }
  return {
    allowed: row.allowed,
    limit: input.max,
    remaining,
    resetAt,
  };
}

type Consume = typeof consumeAuthenticatedRateLimit;
type RunInTenant = <T>(
  organisationId: string,
  work: () => Promise<T>,
) => Promise<T>;

export function createAuthenticatedRateLimiter(options?: {
  consume?: Consume;
  policy?: AuthenticatedRateLimitPolicy;
  runInTenant?: RunInTenant;
}): RequestHandler {
  const consume = options?.consume ?? consumeAuthenticatedRateLimit;
  const policy = options?.policy ?? authenticatedRateLimitPolicy();
  const runInTenant = options?.runInTenant ?? withIndependentTenantDatabase;
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!MUTATING_METHODS.has(req.method.toUpperCase())) {
      next();
      return;
    }
    const access = getAccessContext(req);
    const user = getLocalUser(req);
    if (!access || !user) {
      res
        .status(403)
        .json({ error: "Authenticated rate-limit context missing" });
      return;
    }
    try {
      // Commit this content-free abuse-control attempt before the business
      // request starts. A later workflow rollback must not erase its limit.
      const result = await runInTenant(access.organisationId, () =>
        consume({
          bucketKeySha256: authenticatedRateLimitKey({
            actorId: user.id,
            accessSource: access.source,
            operation: authenticatedRateLimitOperation(req),
            organisationId: access.organisationId,
          }),
          max: policy.max,
          organisationId: access.organisationId,
          windowSeconds: policy.windowSeconds,
        }),
      );
      res.setHeader("RateLimit-Limit", String(result.limit));
      res.setHeader("RateLimit-Remaining", String(result.remaining));
      res.setHeader(
        "RateLimit-Reset",
        String(Math.ceil(result.resetAt.getTime() / 1_000)),
      );
      if (!result.allowed) {
        const retryAfter = Math.max(
          1,
          Math.ceil((result.resetAt.getTime() - Date.now()) / 1_000),
        );
        res.setHeader("Retry-After", String(retryAfter));
        res.setHeader("Cache-Control", "private, no-store");
        res.status(429).json({ error: "Too many authenticated requests" });
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

export const authenticatedRateLimiter = createAuthenticatedRateLimiter();

type ActorConsume = typeof consumeAuthenticatedActorRateLimit;

/**
 * A tenant-free hard cap for every authenticated mutation. This runs before
 * tenant selection so organisation bootstrap and control-plane writers cannot
 * bypass the durable boundary. The tenant limiter below remains a second,
 * more granular control after authority resolution.
 */
export function createAuthenticatedActorMutationRateLimiter(options?: {
  consume?: ActorConsume;
  policy?: AuthenticatedRateLimitPolicy;
}): RequestHandler {
  const consume = options?.consume ?? consumeAuthenticatedActorRateLimit;
  const policy = options?.policy ?? authenticatedActorRateLimitPolicy();
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!MUTATING_METHODS.has(req.method.toUpperCase())) {
      next();
      return;
    }
    const user = getLocalUser(req);
    if (!user) {
      res
        .status(403)
        .json({ error: "Authenticated rate-limit context missing" });
      return;
    }
    try {
      const result = await consume({
        bucketKeySha256: authenticatedActorRateLimitKey(user.id),
        max: policy.max,
        windowSeconds: policy.windowSeconds,
      });
      res.setHeader("RateLimit-Limit", String(result.limit));
      res.setHeader("RateLimit-Remaining", String(result.remaining));
      res.setHeader(
        "RateLimit-Reset",
        String(Math.ceil(result.resetAt.valueOf() / 1_000)),
      );
      if (!result.allowed) {
        res.setHeader(
          "Retry-After",
          String(
            Math.max(
              1,
              Math.ceil((result.resetAt.valueOf() - Date.now()) / 1_000),
            ),
          ),
        );
        res.setHeader("Cache-Control", "private, no-store");
        res.status(429).json({ error: "Too many authenticated requests" });
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

export const authenticatedActorMutationRateLimiter =
  createAuthenticatedActorMutationRateLimiter();
