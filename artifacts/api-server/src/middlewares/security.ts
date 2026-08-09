import type { NextFunction, Request, RequestHandler, Response } from "express";

export function parseAllowedOrigins(
  configured: string | undefined,
  nodeEnv = process.env.NODE_ENV,
): ReadonlySet<string> {
  const origins = new Set(
    (configured ?? "")
      .split(",")
      .map((origin) => origin.trim().replace(/\/$/, ""))
      .filter((origin) => origin.length > 0 && origin !== "*"),
  );
  if (nodeEnv !== "production" && origins.size === 0) {
    origins.add("http://localhost:3000");
    origins.add("http://localhost:5173");
    origins.add("http://127.0.0.1:5173");
  }
  return origins;
}

/** API-safe response headers without adding a middleware dependency. */
export function securityHeaders(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  );
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");
  res.setHeader(
    "Strict-Transport-Security",
    "max-age=31536000; includeSubDomains",
  );
  next();
}

export interface RateLimiterOptions {
  windowMs: number;
  max: number;
  maxEntries?: number;
  now?: () => number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Baseline single-process abuse control. Production deployments with multiple
 * replicas should replace the store with their shared gateway/Redis limiter.
 */
export function createRateLimiter(options: RateLimiterOptions): RequestHandler {
  const buckets = new Map<string, Bucket>();
  const windowMs =
    Number.isFinite(options.windowMs) && options.windowMs > 0
      ? options.windowMs
      : 60_000;
  const max =
    Number.isSafeInteger(options.max) && options.max > 0 ? options.max : 300;
  const maxEntries =
    Number.isSafeInteger(options.maxEntries) && (options.maxEntries ?? 0) > 0
      ? options.maxEntries!
      : 10_000;
  const clock = options.now ?? Date.now;

  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.method === "OPTIONS" || req.path === "/healthz") {
      next();
      return;
    }
    const now = clock();
    const key = req.ip || req.socket.remoteAddress || "unknown";
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      if (buckets.size >= maxEntries) {
        for (const [candidate, value] of buckets) {
          if (value.resetAt <= now) buckets.delete(candidate);
        }
      }
      // Fail closed if a spoofed-address flood exhausts the bounded store.
      if (!buckets.has(key) && buckets.size >= maxEntries) {
        res.status(429).setHeader("Retry-After", "1");
        res.json({ error: "Too many requests" });
        return;
      }
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }

    bucket.count += 1;
    const remaining = Math.max(0, max - bucket.count);
    res.setHeader("RateLimit-Limit", String(max));
    res.setHeader("RateLimit-Remaining", String(remaining));
    res.setHeader("RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));
    if (bucket.count > max) {
      res.setHeader(
        "Retry-After",
        String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))),
      );
      res.status(429).json({ error: "Too many requests" });
      return;
    }
    next();
  };
}
