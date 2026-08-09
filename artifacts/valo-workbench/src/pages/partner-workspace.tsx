import { Button } from "@/components/ui/button";
import {
  FeatureActivationNotice,
  PageHeader,
  QueueCapabilityCard,
  StatusPanel,
} from "@/components/platform-states";
import { platformFeatureFlags } from "@/lib/platform-access";

export default function PartnerWorkspace() {
  const enabled = platformFeatureFlags().partnerWorkspace;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-7 p-5 sm:p-8">
      <PageHeader
        eyebrow="v2.5 channel edition"
        title="Partner workspace"
        description="Delegated consultancy operations with explicit client ownership, co-signing responsibility, branding boundaries, and full audit attribution."
        state={enabled ? "partial" : "pending"}
        actions={
          <Button
            type="button"
            disabled
            title="Partner organisation provisioning is not connected"
          >
            Add managed client
          </Button>
        }
      />

      <FeatureActivationNotice
        enabled={enabled}
        feature="Partner workspace"
        detail={
          enabled
            ? "The partner shell is enabled, but client tenancy, delegated administration, branding, co-signing and revenue reporting remain individually unavailable until their server contracts are connected."
            : "The channel edition is commercially gated. No partner tenant, client assignment, branding change or revenue event is created from this interface."
        }
      />

      <StatusPanel
        state="active"
        title="Quality controls remain invariant"
        description="Partner branding and administration never change evidence validity, requirement status, conflict controls, fatal blockers, or named sign-off requirements."
      />

      <section
        aria-labelledby="partner-capabilities-heading"
        className="space-y-4"
      >
        <h2
          id="partner-capabilities-heading"
          className="font-serif text-xl font-semibold"
        >
          Partner capability status
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <QueueCapabilityCard
            title="Partner tenancy"
            description="Partner organisation membership and delegated administration require server-enforced tenant boundaries."
            state="unavailable"
          />
          <QueueCapabilityCard
            title="Managed client workspaces"
            description="Client ownership, conflict clearance and same-tender assignment controls are not connected to this screen."
            state="blocked"
          />
          <QueueCapabilityCard
            title="Co-signing and QA"
            description="Partner reviewer and Valo quality responsibility require independent approval records."
            state="pending"
          />
          <QueueCapabilityCard
            title="Configurable branding"
            description="No white-label configuration is applied until provenance-preserving templates and branding policies are available."
            state="unavailable"
          />
          <QueueCapabilityCard
            title="Revenue-share reporting"
            description="A versioned commercial agreement and auditable settlement ledger are required."
            state="unavailable"
          />
          <QueueCapabilityCard
            title="Partner audit trail"
            description="Access review exists for internal operations; the partner-scoped audit export is not connected."
            state="partial"
          />
        </div>
      </section>
    </div>
  );
}
