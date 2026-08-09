export type ProductKind =
  | "autopsy_order"
  | "assisted_bid"
  | "prequalification"
  | "platform_subscription"
  | "service_retainer"
  | "partner_arrangement";

export interface PriceBookEntry {
  id: string;
  version: number;
  productKind: ProductKind;
  currency: string;
  amountMinor: string;
  effectiveFrom: string;
  effectiveTo?: string | null;
  active: boolean;
}

export interface EntitlementGrant {
  id: string;
  tenantId: string;
  productKind: ProductKind;
  status: "pending" | "active" | "suspended" | "expired" | "cancelled";
  startsAt: string;
  endsAt?: string | null;
  usageLimit?: number | null;
  usageConsumed: number;
  paymentState: "not_required" | "pending" | "settled" | "failed" | "refunded";
  commercialFeatureEnabled: boolean;
}

export type EntitlementDenialCode =
  | "tenant_mismatch"
  | "commercial_gate_disabled"
  | "entitlement_inactive"
  | "entitlement_not_started"
  | "entitlement_expired"
  | "payment_unsettled"
  | "usage_exhausted";

export interface EntitlementDecision {
  allowed: boolean;
  code?: EntitlementDenialCode;
  message: string;
  remainingUsage: number | null;
}

/** No prices are embedded here; this policy evaluates persisted grants only. */
export function evaluateEntitlement(input: {
  tenantId: string;
  grant: EntitlementGrant;
  at: string;
  requestedUnits?: number;
}): EntitlementDecision {
  const requested = Math.max(1, Math.trunc(input.requestedUnits ?? 1));
  const remaining =
    input.grant.usageLimit == null
      ? null
      : Math.max(0, input.grant.usageLimit - input.grant.usageConsumed);

  if (input.grant.tenantId !== input.tenantId) {
    return {
      allowed: false,
      code: "tenant_mismatch",
      message: "Entitlements are tenant-scoped.",
      remainingUsage: remaining,
    };
  }
  if (!input.grant.commercialFeatureEnabled) {
    return {
      allowed: false,
      code: "commercial_gate_disabled",
      message: "Commercial activation is disabled by feature policy.",
      remainingUsage: remaining,
    };
  }
  if (input.grant.status !== "active") {
    return {
      allowed: false,
      code: "entitlement_inactive",
      message: `Entitlement is ${input.grant.status}.`,
      remainingUsage: remaining,
    };
  }

  const at = Date.parse(input.at);
  const startsAt = Date.parse(input.grant.startsAt);
  const endsAt = input.grant.endsAt ? Date.parse(input.grant.endsAt) : null;
  if (Number.isFinite(at) && Number.isFinite(startsAt) && at < startsAt) {
    return {
      allowed: false,
      code: "entitlement_not_started",
      message: "Entitlement is not yet effective.",
      remainingUsage: remaining,
    };
  }
  if (
    Number.isFinite(at) &&
    endsAt !== null &&
    Number.isFinite(endsAt) &&
    at > endsAt
  ) {
    return {
      allowed: false,
      code: "entitlement_expired",
      message: "Entitlement has expired.",
      remainingUsage: remaining,
    };
  }
  if (!new Set(["settled", "not_required"]).has(input.grant.paymentState)) {
    return {
      allowed: false,
      code: "payment_unsettled",
      message: "Payment or an approved no-payment basis is required.",
      remainingUsage: remaining,
    };
  }
  if (remaining !== null && requested > remaining) {
    return {
      allowed: false,
      code: "usage_exhausted",
      message: "The requested usage exceeds the remaining entitlement.",
      remainingUsage: remaining,
    };
  }

  return {
    allowed: true,
    message: "Entitlement permits the requested operation.",
    remainingUsage: remaining === null ? null : remaining - requested,
  };
}

export function selectEffectivePrice(
  entries: PriceBookEntry[],
  productKind: ProductKind,
  currency: string,
  at: string,
): PriceBookEntry | null {
  const moment = Date.parse(at);
  return (
    entries
      .filter((entry) => {
        const from = Date.parse(entry.effectiveFrom);
        const to = entry.effectiveTo ? Date.parse(entry.effectiveTo) : null;
        return (
          entry.active &&
          entry.productKind === productKind &&
          entry.currency === currency &&
          Number.isFinite(moment) &&
          moment >= from &&
          (to === null || moment <= to)
        );
      })
      .sort((a, b) => b.version - a.version)[0] ?? null
  );
}
