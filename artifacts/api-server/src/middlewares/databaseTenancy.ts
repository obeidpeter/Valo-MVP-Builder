import type { NextFunction, Request, Response } from "express";
import { withTenantDatabase } from "@workspace/db";
import { getOrganisationId } from "./tenancy";

const TENANT_WORK_CONTROL = Symbol("tenant-work-control");

interface TenantWorkControl {
  holds: number;
  terminal: "finish" | "close" | null;
  terminalError: Error | null;
  settle: (error?: Error) => void;
}

type ControlledRequest = Request & {
  [TENANT_WORK_CONTROL]?: TenantWorkControl;
};

/**
 * Keep the request transaction (and its advisory locks) alive if the client
 * disconnects while critical server work is still running. The returned
 * release is idempotent; pass an error to force rollback. Normal requests keep
 * the existing finish/close behavior.
 */
export function holdTenantDatabaseUntilComplete(
  req: Request,
): (error?: unknown) => void {
  const control = (req as ControlledRequest)[TENANT_WORK_CONTROL];
  if (!control) {
    throw new Error("Tenant database control is unavailable");
  }
  control.holds += 1;
  let released = false;
  return (error?: unknown) => {
    if (released) return;
    released = true;
    if (error) {
      control.terminalError =
        error instanceof Error ? error : new Error(String(error));
    }
    control.holds = Math.max(0, control.holds - 1);
    if (control.terminal && control.holds === 0) {
      control.settle(control.terminalError ?? undefined);
    }
  };
}

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
            delete (req as ControlledRequest)[TENANT_WORK_CONTROL];
            if (error) reject(error);
            else resolve();
          };
          const control: TenantWorkControl = {
            holds: 0,
            terminal: null,
            terminalError: null,
            settle,
          };
          (req as ControlledRequest)[TENANT_WORK_CONTROL] = control;
          const onFinish = () => {
            if (!control.terminal) {
              control.terminal = "finish";
              control.terminalError =
                res.statusCode >= 500
                  ? new Error(`Tenant request failed with ${res.statusCode}`)
                  : null;
            }
            if (control.holds === 0) settle(control.terminalError ?? undefined);
          };
          const onClose = () => {
            if (!control.terminal) {
              control.terminal = "close";
              // A held workflow owns its server-side completion semantics. It
              // commits only after release; an unheld disconnect rolls back as
              // before.
              control.terminalError =
                control.holds > 0
                  ? null
                  : new Error("Tenant request connection closed early");
            }
            if (control.holds === 0) settle(control.terminalError ?? undefined);
          };
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
