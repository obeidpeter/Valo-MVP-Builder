import type { NextFunction, Request, RequestHandler, Response } from "express";

export type BoundedJsonBodyDomain =
  | "client-action"
  | "communications"
  | "consortium-room"
  | "evidence-renewal"
  | "opportunity-handoff"
  | "operations"
  | "retention-completion";

/**
 * Applies a second, domain-specific bound after Express has parsed JSON.
 * JSON.stringify is intentional: the bound measures the UTF-8 representation
 * that the domain service is about to inspect, not the original wire payload.
 */
export function createBoundedJsonBody(
  maximumBytes: number,
  domain: BoundedJsonBodyDomain,
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.method === "GET" || req.method === "HEAD") {
      next();
      return;
    }

    let bytes: number;
    try {
      bytes = Buffer.byteLength(JSON.stringify(req.body ?? {}), "utf8");
    } catch {
      res
        .status(400)
        .json({ error: "Request body must be JSON serializable." });
      return;
    }

    if (bytes > maximumBytes) {
      res.status(413).json({
        error: `Request body exceeds the ${domain} bound.`,
      });
      return;
    }
    next();
  };
}
