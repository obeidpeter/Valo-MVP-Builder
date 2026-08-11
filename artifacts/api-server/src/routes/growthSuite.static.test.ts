import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routes = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const adapter = readFileSync(
  new URL("../lib/growthSuite/drizzleRepository.ts", import.meta.url),
  "utf8",
);

test("mounts the durable growth adapter inside the authenticated tenant boundary", () => {
  const userBoundary = routes.indexOf("router.use(attachUser)");
  const databaseBoundary = routes.indexOf("router.use(attachTenantDatabase)");
  const resourceBoundary = routes.indexOf(
    "router.use(enforceTenantResourceBoundary)",
  );
  const growthMount = routes.indexOf("router.use(growthSuiteRouter)");

  assert.ok(userBoundary >= 0);
  assert.ok(userBoundary < databaseBoundary);
  assert.ok(databaseBoundary < resourceBoundary);
  assert.ok(resourceBoundary < growthMount);
  assert.match(routes, /createDrizzleGrowthSuiteRepository\(\)/u);
  assert.match(routes, /createDrizzleOnboardingProgressRepository\(\)/u);
  assert.match(routes, /createGrowthSuiteRouter\(\{/u);
});

test("keeps public lead contact data outside bulk durable reads", () => {
  const bulkQueueRead = adapter.slice(
    adapter.indexOf("async listQueue("),
    adapter.indexOf("async loadLeadEvents("),
  );
  for (const forbidden of [
    "contact_name",
    "business_email",
    "business_telephone",
  ]) {
    assert.equal(bulkQueueRead.includes(forbidden), false, forbidden);
  }
  for (const forbidden of ["business_email", "business_telephone"]) {
    assert.equal(adapter.includes(forbidden), false, forbidden);
  }
  assert.match(adapter, /list_bid_autopsy_work_queue/u);
  assert.match(adapter, /transition_bid_autopsy_work_queue/u);
  assert.match(adapter, /get_bid_autopsy_contact_handoff/u);
  assert.match(adapter, /roleGrants/u);
  assert.match(adapter, /valo_operations_administrator/u);
  assert.match(adapter, /valo_analyst/u);
  assert.match(adapter, /writeAuditTx/u);
});
