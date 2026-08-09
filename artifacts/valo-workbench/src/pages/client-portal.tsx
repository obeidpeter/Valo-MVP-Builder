import { Button } from "@/components/ui/button";
import {
  DeadlineCaution,
  FeatureActivationNotice,
  PageHeader,
  QueueCapabilityCard,
} from "@/components/platform-states";
import { platformFeatureFlags } from "@/lib/platform-access";

export default function ClientPortal() {
  const enabled = platformFeatureFlags().clientPortal;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-7 p-5 sm:p-8">
      <PageHeader
        eyebrow="Client workspace"
        title="Client portal"
        description="A role-scoped view for onboarding, secure exchange, assigned actions, evidence validity, and controlled deliverables."
        state={enabled ? "partial" : "pending"}
        actions={
          <Button
            type="button"
            disabled
            title="Requires the client intake and entitlement APIs"
          >
            Start secure intake
          </Button>
        }
      />

      <FeatureActivationNotice
        enabled={enabled}
        feature="Client portal"
        detail={
          enabled
            ? "The portal shell is enabled. Organisation-scoped intake, orders, billing, package delivery, and support must each report a connected server capability before their actions become available."
            : "Commercial activation is pending. No client order, upload, payment, or package action is being simulated on this screen."
        }
      />

      <DeadlineCaution>
        Readiness is evidence-led. An unresolved fatal requirement, expired
        evidence, missing approval, or incomplete entitlement remains a blocker
        regardless of deadline pressure.
      </DeadlineCaution>

      <section
        aria-labelledby="client-capabilities-heading"
        className="space-y-4"
      >
        <div>
          <h2
            id="client-capabilities-heading"
            className="font-serif text-xl font-semibold"
          >
            Workspace capability status
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Statuses describe actual integration readiness; they are not client
            records or completion claims.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <QueueCapabilityCard
            title="Organisation onboarding"
            description="Identity, NDA, privacy acknowledgement, membership and delegated administration need the organisation onboarding contract."
            state="unavailable"
          />
          <QueueCapabilityCard
            title="Tender status and actions"
            description="Current project services exist, but the client-scoped summary and assigned-action contract is not connected here."
            state="partial"
          />
          <QueueCapabilityCard
            title="Secure uploads"
            description="Upload actions stay blocked until client permissions, entitlement checks, quarantine and malware status are returned by the server."
            state="blocked"
          />
          <QueueCapabilityCard
            title="Vault and evidence"
            description="Evidence validity can be reviewed in the shared readiness surface; client self-management remains review-gated."
            state="partial"
          />
          <QueueCapabilityCard
            title="Autopsy and packages"
            description="Downloads require a signed, server-authorised release and an expiring delivery link. That delivery contract is not connected."
            state="blocked"
          />
          <QueueCapabilityCard
            title="Billing, usage and support"
            description="Entitlement, invoice, metering and support endpoints have not been connected to this portal."
            state="unavailable"
          />
        </div>
      </section>
    </div>
  );
}
