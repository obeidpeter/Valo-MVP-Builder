import type { NextFunction, Request, Response } from "express";
import { withTenantDatabase } from "@workspace/db";
import { getOrganisationId } from "./tenancy";

/**
 * Keeps the RLS context and one pooled connection scoped to the full Express
 * request. A server error or aborted response rolls back; successful 2xx-4xx
 * responses commit. Long-lived download routes should move object streaming
 * after their database query so a future optimisation can commit earlier.
 */
export async function attachTenantDatabase(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const organisationId = getOrganisationId(req);
  if (!organisationId) {
    res.status(403).json({ error: "Organisation database context missing" });
    return;
  }

  try {
    await withTenantDatabase(
      organisationId,
      () =>
        new Promise<void>((resolve, reject) => {
          let settled = false;
          const settle = (error?: Error) => {
            if (settled) return;
            settled = true;
            res.off("finish", onFinish);
            res.off("close", onClose);
            if (error) reject(error);
            else resolve();
          };
          const onFinish = () => {
            if (res.statusCode >= 500) {
              settle(new Error(`Tenant request failed with ${res.statusCode}`));
            } else {
              settle();
            }
          };
          const onClose = () =>
            settle(new Error("Tenant request connection closed early"));
          res.once("finish", onFinish);
          res.once("close", onClose);
          try {
            next();
          } catch (error) {
            settle(
              error instanceof Error
                ? error
                : new Error("Tenant request failed"),
            );
          }
        }),
    );
  } catch (error) {
    req.log?.error({ err: error }, "tenant database transaction failed");
    if (!res.headersSent) {
      res.status(500).json({ error: "Tenant request could not be completed" });
    }
  }
}
