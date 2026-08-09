import { Button } from "@/components/ui/button";
import {
  FeatureActivationNotice,
  PageHeader,
  QueueCapabilityCard,
  StatusPanel,
} from "@/components/platform-states";
import { platformFeatureFlags } from "@/lib/platform-access";

export default function BillingEntitlements() {
  const enabled = platformFeatureFlags().billingEntitlements;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-7 p-5 sm:p-8">
      <PageHeader
        eyebrow="Commercial controls"
        title="Billing & entitlements"
        description="A transparent control surface for versioned products, service access, usage limits, invoices, payments and exceptions."
        state={enabled ? "partial" : "pending"}
        actions={
          <Button
            type="button"
            disabled
            title="Versioned price-book API is not connected"
          >
            Create order
          </Button>
        }
      />

      <FeatureActivationNotice
        enabled={enabled}
        feature="Billing and entitlements"
        detail={
          enabled
            ? "The commercial surface is enabled, but no complete price-book, order, subscription, invoice, reconciliation or entitlement decision contract is connected."
            : "Commercial activation is pending. Prices are not hard-coded and this screen does not create orders, invoices, payments or access grants."
        }
      />

      <StatusPanel
        state="partial"
        title="Project payment gates are not a billing ledger"
        description="Existing project-level payment confirmation can block operational progress, but it must not be interpreted as an invoice, reconciled payment, subscription or entitlement record."
      />

      <section
        aria-labelledby="commercial-capabilities-heading"
        className="space-y-4"
      >
        <h2
          id="commercial-capabilities-heading"
          className="font-serif text-xl font-semibold"
        >
          Commercial capability status
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <QueueCapabilityCard
            title="Versioned price book"
            description="One-off Autopsy, Assisted Bid, prequalification, subscription, retainer and partner products need effective-dated configuration."
            state="unavailable"
          />
          <QueueCapabilityCard
            title="Entitlement decisions"
            description="Server-side product, organisation, usage and expiry rules must return an explainable allow or deny decision."
            state="blocked"
          />
          <QueueCapabilityCard
            title="Orders and subscriptions"
            description="Creation, cancellation, renewal and state-transition APIs are not connected."
            state="unavailable"
          />
          <QueueCapabilityCard
            title="Invoices and payments"
            description="Payment-provider reconciliation and billing exceptions require idempotent provider adapters."
            state="unavailable"
          />
          <QueueCapabilityCard
            title="Usage and fair-use limits"
            description="Model cost telemetry exists separately; customer metering and auditable limit decisions are not available."
            state="partial"
          />
          <QueueCapabilityCard
            title="Partner arrangements"
            description="Revenue share and partner-specific entitlements require an active, versioned agreement."
            state="pending"
          />
        </div>
      </section>
    </div>
  );
}
