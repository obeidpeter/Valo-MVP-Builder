import app from "./app";
import { logger } from "./lib/logger";
import { initializeProductionAdapterReadiness } from "./lib/productionReadiness";
import { parseBootstrapOrganisationConfig } from "./lib/bootstrap";
import {
  assertRuntimeDatabaseSecurity,
  closeDatabasePool,
  databasePoolSnapshot,
} from "@workspace/db";
import { startOperationalSignalHeartbeat } from "./lib/observability";
import {
  createGracefulShutdown,
  installGracefulShutdown,
  runtimeReadiness,
  shutdownTimeouts,
} from "./lib/runtimeLifecycle";

const adapterReadiness = initializeProductionAdapterReadiness();
parseBootstrapOrganisationConfig({
  enabled: process.env.VALO_BOOTSTRAP_ORGANISATION_ENABLED,
  name: process.env.VALO_BOOTSTRAP_ORGANISATION_NAME,
  slug: process.env.VALO_BOOTSTRAP_ORGANISATION_SLUG,
});
for (const [feature, issues] of Object.entries(
  adapterReadiness.featureIssues,
)) {
  if (issues.length > 0) {
    logger.warn(
      {
        feature,
        issues: issues.map((issue) => ({
          kind: issue.kind,
          code: issue.code,
        })),
      },
      "Production feature disabled by adapter readiness",
    );
  }
}

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function start(): Promise<void> {
  await assertRuntimeDatabaseSecurity();
  const stopOperationalSignals = startOperationalSignalHeartbeat({
    getDatabasePool: databasePoolSnapshot,
    getLifecycle: () => runtimeReadiness.current(),
    intervalMillis: Number(
      process.env.VALO_OPERATIONAL_SIGNAL_INTERVAL_MS || 60_000,
    ),
    logger,
  });
  const server = app.listen(port, () => {
    runtimeReadiness.markAccepting();
    logger.info({ port }, "Server listening");
  });
  const timeouts = shutdownTimeouts(process.env);
  const graceful = createGracefulShutdown({
    beforeDrain: stopOperationalSignals,
    closeDatabase: closeDatabasePool,
    logger,
    readiness: runtimeReadiness,
    server,
    ...timeouts,
  });
  installGracefulShutdown(graceful);
  server.once("error", (error) => {
    runtimeReadiness.beginDrain();
    stopOperationalSignals();
    logger.fatal({ err: error }, "HTTP server failed");
    void closeDatabasePool().finally(() => process.exit(1));
  });
}

start().catch((error: unknown) => {
  logger.fatal({ err: error }, "API startup failed");
  void closeDatabasePool().finally(() => process.exit(1));
});
