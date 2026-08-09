import { Button } from "@/components/ui/button";
import {
  FeatureActivationNotice,
  PageHeader,
  QueueCapabilityCard,
  StatusPanel,
} from "@/components/platform-states";
import { platformFeatureFlags } from "@/lib/platform-access";

export default function NotificationsConsole() {
  const enabled = platformFeatureFlags().notificationAdapters;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-7 p-5 sm:p-8">
      <PageHeader
        eyebrow="Delivery operations"
        title="Notifications"
        description="Channel configuration, delivery state, retry visibility and failure handling without implying that a queued event reached its recipient."
        state={enabled ? "partial" : "pending"}
        actions={
          <Button
            type="button"
            disabled
            title="Global notification dispatcher is not connected"
          >
            Send notification
          </Button>
        }
      />

      <FeatureActivationNotice
        enabled={enabled}
        feature="Notification adapters"
        detail={
          enabled
            ? "Notification feature flags are enabled. Production channel credentials, provider health, reconciliation and the global failure queue must still be confirmed by server status."
            : "Only project-scoped notification records currently exist. No email, WhatsApp or in-app delivery is claimed from this console."
        }
      />

      <StatusPanel
        state="partial"
        title="Queued is not delivered"
        description="A notification remains pending until the provider response and any required reconciliation update the server-side delivery state. Failed and uncertain deliveries need explicit operator handling."
      />

      <section
        aria-labelledby="notification-channels-heading"
        className="space-y-4"
      >
        <h2
          id="notification-channels-heading"
          className="font-serif text-xl font-semibold"
        >
          Channel and queue status
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <QueueCapabilityCard
            title="Manual record"
            description="Project-level manual notification events can be attributed, but do not prove an external message was delivered."
            state="active"
          />
          <QueueCapabilityCard
            title="Email adapter"
            description="Provider health, idempotency keys, retry policy and delivery reconciliation are not exposed to this console."
            state="unavailable"
          />
          <QueueCapabilityCard
            title="WhatsApp Business"
            description="An approved Business integration and message-template status are required before activation."
            state="unavailable"
          />
          <QueueCapabilityCard
            title="In-app notifications"
            description="Recipient inbox, read state and tenant-scoped preference APIs are not connected."
            state="pending"
          />
          <QueueCapabilityCard
            title="Failure queue"
            description="There is no global failed-delivery endpoint available to this frontend."
            state="blocked"
          />
          <QueueCapabilityCard
            title="Digest and escalation rules"
            description="SLA and expiry alert sources exist; scheduling, suppression and recipient policy remain unconfigured."
            state="partial"
          />
        </div>
      </section>
    </div>
  );
}
