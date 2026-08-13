import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

test("the shared limiter commits before the business tenant transaction", () => {
  const user = source.indexOf("router.use(attachUser)");
  const globalLimiter = source.indexOf(
    "router.use(authenticatedActorMutationRateLimiter)",
  );
  const firstControlPlane = source.indexOf("router.use(meRouter)");
  const access = source.indexOf("router.use(attachTenantContext)");
  const limiter = source.indexOf("router.use(authenticatedRateLimiter)");
  const tenant = source.indexOf("router.use(attachTenantDatabase)");
  const boundary = source.indexOf("router.use(enforceTenantResourceBoundary)");
  const firstDomainRouter = source.indexOf("router.use(usersRouter)");
  assert.ok(user >= 0 && user < globalLimiter);
  assert.ok(globalLimiter < firstControlPlane);
  assert.ok(access >= 0 && access < limiter);
  assert.ok(limiter < tenant);
  assert.ok(tenant < boundary && boundary < firstDomainRouter);
});
