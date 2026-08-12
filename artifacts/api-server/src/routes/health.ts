import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { checkRuntimeDatabaseReadiness } from "@workspace/db";
import { operationsDeliveryStatus } from "../lib/observability";
import { runtimeReadiness } from "../lib/runtimeLifecycle";

export interface HealthRouterDependencies {
  checkDatabase: (timeoutMillis: number) => Promise<boolean>;
  delivery: () => {
    metrics: "connected" | "disconnected";
    paging: "connected" | "disconnected";
  };
  isAccepting: () => boolean;
  readinessTimeoutMillis?: number;
}

async function dependencyReady(
  check: (timeoutMillis: number) => Promise<boolean>,
  timeoutMillis: number,
): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      check(timeoutMillis).catch(() => false),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMillis);
        timer.unref();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function createHealthRouter(
  dependencies: HealthRouterDependencies,
): IRouter {
  const router: IRouter = Router();
  const readinessTimeoutMillis = dependencies.readinessTimeoutMillis ?? 1_500;

  router.get("/healthz", (_req, res) => {
    const data = HealthCheckResponse.parse({ status: "ok" });
    res.json(data);
  });

  router.get("/readyz", async (_req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    const delivery = dependencies.delivery();
    if (!dependencies.isAccepting()) {
      res.status(503).json({
        status: "not_ready",
        checks: { lifecycle: "not_ready", database: "not_checked" },
        delivery,
      });
      return;
    }
    const databaseReady = await dependencyReady(
      dependencies.checkDatabase,
      readinessTimeoutMillis,
    );
    // Shutdown may begin while the dependency probe is in flight. Re-check
    // admission after awaiting so readiness can never turn green during drain.
    const accepting = dependencies.isAccepting();
    const ready = accepting && databaseReady;
    res.status(ready ? 200 : 503).json({
      status: ready ? "ready" : "not_ready",
      checks: {
        lifecycle: accepting ? "ready" : "not_ready",
        database: accepting
          ? databaseReady
            ? "ready"
            : "not_ready"
          : "not_checked",
      },
      delivery,
    });
  });

  return router;
}

export default createHealthRouter({
  checkDatabase: checkRuntimeDatabaseReadiness,
  delivery: operationsDeliveryStatus,
  isAccepting: () => runtimeReadiness.isReady(),
});
