import type { NextFunction, Request, Response } from "express";
import { withTenantDatabase } from "@workspace/db";
import { getOrganisationId } from "./tenancy";

const TENANT_WORK_CONTROL = Symbol("tenant-work-control");

interface TenantWorkControl {
  holds: number;
  terminal: "finish" | "close" | "commit" | null;
  terminalError: Error | null;
  settle: (error?: Error) => void;
  commitRequested: boolean;
  committed: Promise<void>;
  resolveCommitted: () => void;
  rejectCommitted: (error: Error) => void;
}

type TenantDatabaseRunner = (
  organisationId: string,
  work: () => Promise<void>,
) => Promise<unknown>;

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
 * Commit the active tenant transaction before exposing an irreversible
 * capability or authoritative receipt in the HTTP response. This consumes all
 * outstanding holds for the request, settles the transaction callback, and
 * resolves only after node-postgres has acknowledged COMMIT. Callers must not
 * perform further database work after awaiting it.
 */
export function commitTenantDatabaseBeforeResponse(
  req: Request,
): Promise<void> {
  const control = (req as ControlledRequest)[TENANT_WORK_CONTROL];
  if (!control) {
    throw new Error("Tenant database control is unavailable");
  }
  if (control.commitRequested) return control.committed;
  control.commitRequested = true;
  control.terminal = "commit";
  control.terminalError = null;
  control.holds = 0;
  control.settle();
  return control.committed;
}

/**
 * Keeps the RLS context and one pooled connection scoped to the full Express
 * request. A server error or aborted response rolls back; successful 2xx-4xx
 * responses commit. Long-lived download routes should move object streaming
 * after their database query so a future optimisation can commit earlier.
 */
async function runTenantDatabaseMiddleware(
  runWithTenantDatabase: TenantDatabaseRunner,
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const organisationId = getOrganisationId(req);
  if (!organisationId) {
    res.status(403).json({ error: "Organisation database context missing" });
    return;
  }

  let requestControl: TenantWorkControl | undefined;
  try {
    await runWithTenantDatabase(
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
          let resolveCommitted!: () => void;
          let rejectCommitted!: (error: Error) => void;
          const committed = new Promise<void>((resolve, reject) => {
            resolveCommitted = resolve;
            rejectCommitted = reject;
          });
          // A normal finish/close request never awaits this promise. Attach a
          // rejection observer so a rollback cannot become an unhandled
          // rejection when no route requested commit-before-response.
          void committed.catch(() => {});
          const control: TenantWorkControl = {
            holds: 0,
            terminal: null,
            terminalError: null,
            settle,
            commitRequested: false,
            committed,
            resolveCommitted,
            rejectCommitted,
          };
          requestControl = control;
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
    if (requestControl?.commitRequested) {
      requestControl.resolveCommitted();
      const cleanup = () => {
        if (
          (req as ControlledRequest)[TENANT_WORK_CONTROL] === requestControl
        ) {
          delete (req as ControlledRequest)[TENANT_WORK_CONTROL];
        }
      };
      res.once("finish", cleanup);
      res.once("close", cleanup);
    } else if (
      (req as ControlledRequest)[TENANT_WORK_CONTROL] === requestControl
    ) {
      delete (req as ControlledRequest)[TENANT_WORK_CONTROL];
    }
  } catch (error) {
    req.log?.error({ err: error }, "tenant database transaction failed");
    const failure =
      error instanceof Error
        ? error
        : new Error("Tenant request could not be completed");
    if (requestControl?.commitRequested) {
      requestControl.rejectCommitted(failure);
    } else if (!res.headersSent) {
      res.status(500).json({ error: "Tenant request could not be completed" });
    }
    if ((req as ControlledRequest)[TENANT_WORK_CONTROL] === requestControl) {
      delete (req as ControlledRequest)[TENANT_WORK_CONTROL];
    }
  }
}

export function createAttachTenantDatabase(
  runWithTenantDatabase: TenantDatabaseRunner = withTenantDatabase,
) {
  return (req: Request, res: Response, next: NextFunction): Promise<void> =>
    runTenantDatabaseMiddleware(runWithTenantDatabase, req, res, next);
}

export async function attachTenantDatabase(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  return runTenantDatabaseMiddleware(withTenantDatabase, req, res, next);
}
