import assert from "node:assert/strict";
import test from "node:test";
import { assertIndependentTenantContext } from "./tenantContext";

const TENANT_A = "00000000-0000-4000-8000-000000000001";
const TENANT_B = "00000000-0000-4000-8000-000000000002";

test("independent evidence work permits no ambient context or the same tenant", () => {
  assert.doesNotThrow(() =>
    assertIndependentTenantContext(undefined, TENANT_A),
  );
  assert.doesNotThrow(() => assertIndependentTenantContext(TENANT_A, TENANT_A));
});

test("independent evidence work rejects cross-tenant nesting", () => {
  assert.throws(
    () => assertIndependentTenantContext(TENANT_A, TENANT_B),
    /Cross-tenant database context nesting is prohibited/,
  );
});
