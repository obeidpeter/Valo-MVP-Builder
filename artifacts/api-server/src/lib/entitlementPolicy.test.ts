import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateEntitlement,
  selectEffectivePrice,
  type EntitlementGrant,
} from "./entitlementPolicy";

const grant: EntitlementGrant = {
  id: "grant-1",
  tenantId: "tenant-a",
  productKind: "autopsy_order",
  status: "active",
  startsAt: "2026-01-01T00:00:00Z",
  endsAt: "2026-12-31T23:59:59Z",
  usageLimit: 5,
  usageConsumed: 2,
  paymentState: "settled",
  commercialFeatureEnabled: true,
};

const decide = (
  overrides: Partial<EntitlementGrant> = {},
  tenantId = "tenant-a",
  requestedUnits = 1,
) =>
  evaluateEntitlement({
    tenantId,
    grant: { ...grant, ...overrides },
    at: "2026-08-08T12:00:00Z",
    requestedUnits,
  });

test("an active paid grant consumes configured usage", () => {
  const result = decide();
  assert.equal(result.allowed, true);
  assert.equal(result.remainingUsage, 2);
});

test("tenant, commercial, status, time, payment, and usage gates are fail-closed", () => {
  assert.equal(decide({}, "tenant-b").code, "tenant_mismatch");
  assert.equal(
    decide({ commercialFeatureEnabled: false }).code,
    "commercial_gate_disabled",
  );
  assert.equal(decide({ status: "suspended" }).code, "entitlement_inactive");
  assert.equal(
    decide({ startsAt: "2027-01-01T00:00:00Z" }).code,
    "entitlement_not_started",
  );
  assert.equal(
    decide({ endsAt: "2026-01-01T00:00:00Z" }).code,
    "entitlement_expired",
  );
  assert.equal(decide({ paymentState: "pending" }).code, "payment_unsettled");
  assert.equal(decide({}, "tenant-a", 4).code, "usage_exhausted");
});

test("unlimited approved retainers report no synthetic limit", () => {
  const result = decide({
    productKind: "service_retainer",
    usageLimit: null,
    paymentState: "not_required",
  });
  assert.equal(result.allowed, true);
  assert.equal(result.remainingUsage, null);
});

test("price selection is effective-dated, versioned, and contains no domain default", () => {
  const entries = [
    {
      id: "old",
      version: 1,
      productKind: "autopsy_order" as const,
      currency: "NGN",
      amountMinor: "10000",
      effectiveFrom: "2026-01-01T00:00:00Z",
      effectiveTo: "2026-06-30T23:59:59Z",
      active: true,
    },
    {
      id: "new",
      version: 2,
      productKind: "autopsy_order" as const,
      currency: "NGN",
      amountMinor: "15000",
      effectiveFrom: "2026-07-01T00:00:00Z",
      active: true,
    },
  ];
  assert.equal(
    selectEffectivePrice(
      entries,
      "autopsy_order",
      "NGN",
      "2026-08-08T00:00:00Z",
    )?.id,
    "new",
  );
  assert.equal(
    selectEffectivePrice(
      entries,
      "autopsy_order",
      "USD",
      "2026-08-08T00:00:00Z",
    ),
    null,
  );
});
