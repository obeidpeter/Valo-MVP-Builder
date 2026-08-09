import app from "./app";
import { logger } from "./lib/logger";
import { initializeProductionAdapterReadiness } from "./lib/productionReadiness";
import { parseBootstrapOrganisationConfig } from "./lib/bootstrap";

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

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
