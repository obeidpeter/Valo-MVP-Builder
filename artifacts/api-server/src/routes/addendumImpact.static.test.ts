import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(
  new URL("./addendumImpact.ts", import.meta.url),
  "utf8",
);
const routeIndex = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

test("addendum review and controlled reopening remain separate endpoints", () => {
  assert.match(route, /"\/projects\/:id\/addendum-impact\/review"/u);
  assert.match(route, /"\/projects\/:id\/addendum-impact\/apply"/u);
  assert.match(route, /service\.review/u);
  assert.match(route, /service\.apply/u);
  assert.doesNotMatch(
    route,
    /service\.review[\s\S]{0,400}service\.apply/u,
    "the review handler must not call apply",
  );
});

test("production route defaults to the Drizzle persistence adapter", () => {
  assert.match(route, /createDrizzleAddendumImpactRepository/u);
  assert.doesNotMatch(route, /unavailableAddendumImpactRepository/u);
  assert.match(route, /AddendumImpactRepositoryUnavailableError/u);
  assert.match(route, /status\(503\)/u);
});

test("write authority excludes partner and emergency contexts", () => {
  assert.match(route, /context\?\.source === "membership"/u);
  assert.match(route, /intelligence:review/u);
  assert.match(route, /project:update/u);
  assert.match(route, /requirement:review/u);
  assert.match(route, /resolveCurrentDirectAuthority/u);
  assert.match(route, /authority\.membershipId !== context\.membershipId/u);
});

test("review and apply commit before exposing authoritative receipts", () => {
  for (const [path, method] of [
    ['"/projects/:id/addendum-impact/review"', "review"],
    ['"/projects/:id/addendum-impact/apply"', "apply"],
  ] as const) {
    const start = route.indexOf(path);
    const end = route.indexOf("router.", start + path.length);
    const handler = route.slice(start, end < 0 ? undefined : end);
    const serviceCall = handler.indexOf(`await service.${method}`);
    const commit = handler.indexOf("await commitBeforeResponse(request)");
    const response = handler.indexOf("response.json(result)");
    assert.ok(serviceCall >= 0, method);
    assert.ok(commit > serviceCall, method);
    assert.ok(response > commit, method);
  }
});

test("the router is mounted only after tenant and database boundaries", () => {
  assert.match(routeIndex, /createAddendumImpactRouter/u);
  const databaseBoundary = routeIndex.indexOf(
    "router.use(attachTenantDatabase)",
  );
  const tenantBoundary = routeIndex.indexOf(
    "router.use(enforceTenantResourceBoundary)",
  );
  const addendumRoute = routeIndex.indexOf("router.use(addendumImpactRouter)");
  assert.ok(databaseBoundary >= 0);
  assert.ok(tenantBoundary > databaseBoundary);
  assert.ok(addendumRoute > tenantBoundary);
});
