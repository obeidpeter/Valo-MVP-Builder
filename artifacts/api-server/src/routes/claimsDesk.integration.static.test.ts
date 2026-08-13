import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";

const routesIndex = new URL("./index.ts", import.meta.url);
const tenancy = new URL("../middlewares/tenancy.ts", import.meta.url);
const retention = new URL("./operations.ts", import.meta.url);

describe("Claims Desk shared integration", () => {
  test("mounts the real route factory only after tenant database and resource guards", async () => {
    const source = await readFile(routesIndex, "utf8");
    assert.match(
      source,
      /import \{ createClaimsDeskRouter \} from "\.\/claimsDesk"/u,
    );
    const databaseBoundary = source.indexOf("router.use(attachTenantDatabase)");
    const resourceBoundary = source.indexOf(
      "router.use(enforceTenantResourceBoundary)",
    );
    const claimsMount = source.indexOf("router.use(claimsDeskRouter)");
    assert.ok(databaseBoundary >= 0 && resourceBoundary > databaseBoundary);
    assert.ok(claimsMount > resourceBoundary);
  });

  test("keeps the human-session durable worker control surface unmounted", async () => {
    const source = await readFile(routesIndex, "utf8");
    assert.doesNotMatch(source, /internal\/worker/u);
    assert.doesNotMatch(source, /createDurableWorkerFoundationRouter/u);
    assert.doesNotMatch(source, /createDurableWorkerService/u);
    assert.doesNotMatch(source, /createTransactionalOutboxService/u);
  });

  test("uses exported released-route exceptions and leaves claims content untouched while retention is gated", async () => {
    const [tenancySource, retentionSource] = await Promise.all([
      readFile(tenancy, "utf8"),
      readFile(retention, "utf8"),
    ]);
    assert.match(
      tenancySource,
      /\.\.\.CLAIMS_DESK_RELEASED_LEDGER_ROUTE_EXCEPTIONS/u,
    );
    assert.match(retentionSource, /RETENTION_COMPLETION_NOT_ACTIVATED/u);
    assert.match(
      retentionSource,
      /durable_two_phase_detach_reconcile_certify/u,
    );
    assert.doesNotMatch(
      retentionSource,
      /CLAIMS_DESK_RETENTION_WORK_TASK_LIKE/u,
    );
    assert.doesNotMatch(retentionSource, /claims_desk_events=/u);
  });
});
