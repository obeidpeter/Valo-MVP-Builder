import {
  useGetVaultExpiring,
  useGetWorkflowAlerts,
  useListProjects,
} from "@workspace/api-client-react";
import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import {
  DataErrorPanel,
  LoadingPanel,
  PageHeader,
  QueueCapabilityCard,
  StateBadge,
  StatusPanel,
} from "@/components/platform-states";
import { useOnlineStatus } from "@/hooks/use-online-status";

function compactDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-NG", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Lagos",
  }).format(parsed);
}

export default function OperationsConsole() {
  const online = useOnlineStatus();
  const projectsQuery = useListProjects();
  const alertsQuery = useGetWorkflowAlerts();
  const vaultQuery = useGetVaultExpiring();
  const loading =
    projectsQuery.isLoading || alertsQuery.isLoading || vaultQuery.isLoading;
  const hasError =
    projectsQuery.isError || alertsQuery.isError || vaultQuery.isError;
  const alerts = alertsQuery.data;
  const projects = projectsQuery.data ?? [];
  const expiring = vaultQuery.data;

  const retry = () => {
    void projectsQuery.refetch();
    void alertsQuery.refetch();
    void vaultQuery.refetch();
  };

  return (
    <div className="mx-auto w-full max-w-7xl space-y-7 p-5 sm:p-8">
      <PageHeader
        eyebrow="Reviewer and administration console"
        title="Operations queues"
        description="Live operational signals are separated from queue capabilities that still need dedicated server contracts."
        state={!online ? "offline" : hasError ? "partial" : "active"}
      />

      {!online ? (
        <StatusPanel
          state="offline"
          title="Operations data may be stale"
          description="Do not make deadline, assignment or release decisions from cached information. Reconnect and refresh first."
        />
      ) : null}

      {loading ? <LoadingPanel label="Loading operational queues" /> : null}
      {hasError ? (
        <DataErrorPanel
          title="Some operational queues could not be loaded"
          description="Available sections may be incomplete. Refresh before treating an empty queue as clear."
          onRetry={retry}
        />
      ) : null}

      {!loading ? (
        <section
          aria-labelledby="connected-queues-heading"
          className="space-y-4"
        >
          <div>
            <h2
              id="connected-queues-heading"
              className="font-serif text-xl font-semibold"
            >
              Connected signals
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Counts below come from current project, workflow-alert and Vault
              endpoints.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <QueueCapabilityCard
              title="Tracked engagements"
              description="Projects visible to the current server-authorised role."
              state={
                projectsQuery.isError
                  ? "error"
                  : projects.length === 0
                    ? "empty"
                    : "active"
              }
              value={projectsQuery.isError ? "—" : projects.length}
            />
            <QueueCapabilityCard
              title="SLA breaches"
              description="Review windows reported as breached by deterministic workflow alerts."
              state={
                alertsQuery.isError
                  ? "error"
                  : (alerts?.slaBreaches.length ?? 0) > 0
                    ? "blocked"
                    : "empty"
              }
              value={
                alertsQuery.isError ? "—" : (alerts?.slaBreaches.length ?? 0)
              }
            />
            <QueueCapabilityCard
              title="Red-team due"
              description="Projects whose red-team review window is open."
              state={
                alertsQuery.isError
                  ? "error"
                  : (alerts?.redTeamDue.length ?? 0) > 0
                    ? "pending"
                    : "empty"
              }
              value={
                alertsQuery.isError ? "—" : (alerts?.redTeamDue.length ?? 0)
              }
            />
            <QueueCapabilityCard
              title="Expired evidence"
              description="Vault artefacts already past their recorded expiry date."
              state={
                vaultQuery.isError
                  ? "error"
                  : (expiring?.buckets.expired ?? 0) > 0
                    ? "expired"
                    : "empty"
              }
              value={
                vaultQuery.isError ? "—" : (expiring?.buckets.expired ?? 0)
              }
            />
          </div>
        </section>
      ) : null}

      {alerts &&
      (alerts.slaBreaches.length > 0 || alerts.redTeamDue.length > 0) ? (
        <section aria-labelledby="attention-heading" className="space-y-3">
          <h2
            id="attention-heading"
            className="font-serif text-xl font-semibold"
          >
            Requires attention
          </h2>
          <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
            {alerts.slaBreaches.map((alert) => (
              <Link
                key={"sla-" + alert.projectId}
                href={"/projects/" + alert.projectId}
                className="flex min-h-16 items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-medium">
                      {alert.tenderTitle}
                    </p>
                    <StateBadge state="blocked" label="SLA breached" />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Due {compactDate(alert.dueAt)} WAT
                  </p>
                </div>
                <ArrowRight aria-hidden="true" className="size-4 shrink-0" />
              </Link>
            ))}
            {alerts.redTeamDue.map((alert) => (
              <Link
                key={"red-team-" + alert.projectId}
                href={"/projects/" + alert.projectId}
                className="flex min-h-16 items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-medium">
                      {alert.tenderTitle}
                    </p>
                    <StateBadge state="pending" label="Red-team due" />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Opened {compactDate(alert.dueAt)} WAT
                  </p>
                </div>
                <ArrowRight aria-hidden="true" className="size-4 shrink-0" />
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section
        aria-labelledby="specialised-queues-heading"
        className="space-y-4"
      >
        <div>
          <h2
            id="specialised-queues-heading"
            className="font-serif text-xl font-semibold"
          >
            Specialised queue coverage
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Project-level tools remain available, but these cross-project queues
            must not be inferred from unrelated data.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <QueueCapabilityCard
            title="Intake and extraction review"
            description="Available inside each project; a dedicated reviewer queue is not connected."
            state="partial"
          />
          <QueueCapabilityCard
            title="Conflict decisions"
            description="Conflict state is project-scoped; cross-tender conflict assignment needs a server queue."
            state="partial"
          />
          <QueueCapabilityCard
            title="Evidence approval"
            description="Vault records exist; independent approval and renewal work queues are not available globally."
            state="partial"
          />
          <QueueCapabilityCard
            title="BOQ exceptions and sign-off"
            description="Checks and readiness gates are project-scoped."
            state="partial"
          />
          <QueueCapabilityCard
            title="Billing and notification exceptions"
            description="Global commercial and delivery-failure queues are not connected."
            state="unavailable"
          />
          <QueueCapabilityCard
            title="Model and prompt evaluations"
            description="No promotion or regression-evaluation queue is exposed to this frontend."
            state="unavailable"
          />
        </div>
      </section>
    </div>
  );
}
