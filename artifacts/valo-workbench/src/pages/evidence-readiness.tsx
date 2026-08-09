import {
  useGetVaultExpiring,
  useListProjects,
} from "@workspace/api-client-react";
import {
  DataErrorPanel,
  LoadingPanel,
  PageHeader,
  QueueCapabilityCard,
  StateBadge,
  StatusPanel,
} from "@/components/platform-states";
import { useOnlineStatus } from "@/hooks/use-online-status";

export default function EvidenceReadiness() {
  const online = useOnlineStatus();
  const vaultQuery = useGetVaultExpiring();
  const projectsQuery = useListProjects();
  const loading = vaultQuery.isLoading || projectsQuery.isLoading;
  const hasError = vaultQuery.isError || projectsQuery.isError;
  const expiring = vaultQuery.data;
  const projects = projectsQuery.data ?? [];
  const fatalProjects = projects.filter(
    (project) => (project.fatalDefectCount ?? 0) > 0,
  );
  const pendingPayment = projects.filter(
    (project) => project.paymentStatus === "pending",
  );
  const blockedConflict = projects.filter(
    (project) =>
      project.conflictStatus === "blocked" ||
      project.conflictStatus === "declined",
  );

  return (
    <div className="mx-auto w-full max-w-7xl space-y-7 p-5 sm:p-8">
      <PageHeader
        eyebrow="Evidence controls"
        title="Evidence & readiness"
        description="A cross-workspace view of recorded blockers and expiry signals. Final readiness remains a project-level, server-enforced decision."
        state={!online ? "offline" : hasError ? "partial" : "active"}
      />

      <StatusPanel
        state="partial"
        title="Portfolio signals are not a release decision"
        description="This page does not mark any package submission-ready. Open each project to review citations, evidence mapping, BOQ exceptions, named approvals and every deterministic gate."
      />

      {loading ? (
        <LoadingPanel label="Loading evidence and readiness signals" />
      ) : null}
      {hasError ? (
        <DataErrorPanel
          description="At least one evidence or project source failed. Empty counts must not be treated as cleared controls."
          onRetry={() => {
            void vaultQuery.refetch();
            void projectsQuery.refetch();
          }}
        />
      ) : null}

      {!loading ? (
        <section
          aria-labelledby="readiness-signals-heading"
          className="space-y-4"
        >
          <h2
            id="readiness-signals-heading"
            className="font-serif text-xl font-semibold"
          >
            Recorded blocker signals
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <QueueCapabilityCard
              title="Fatal-defect projects"
              description="Projects with at least one recorded fatal defect in their summary."
              state={
                projectsQuery.isError
                  ? "error"
                  : fatalProjects.length > 0
                    ? "blocked"
                    : "empty"
              }
              value={projectsQuery.isError ? "—" : fatalProjects.length}
            />
            <QueueCapabilityCard
              title="Conflict-blocked projects"
              description="Projects whose current conflict state blocks or declines work."
              state={
                projectsQuery.isError
                  ? "error"
                  : blockedConflict.length > 0
                    ? "blocked"
                    : "empty"
              }
              value={projectsQuery.isError ? "—" : blockedConflict.length}
            />
            <QueueCapabilityCard
              title="Pending payment gates"
              description="Operational payment gates still awaiting the required confirmation."
              state={
                projectsQuery.isError
                  ? "error"
                  : pendingPayment.length > 0
                    ? "pending"
                    : "empty"
              }
              value={projectsQuery.isError ? "—" : pendingPayment.length}
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

      {expiring && expiring.items.length > 0 ? (
        <section
          aria-labelledby="expiry-register-heading"
          className="space-y-3"
        >
          <div>
            <h2
              id="expiry-register-heading"
              className="font-serif text-xl font-semibold"
            >
              Evidence renewal register
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Showing records returned by the server expiry window.
            </p>
          </div>
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full min-w-[680px] text-left text-sm">
              <caption className="sr-only">
                Vault evidence currently expired or approaching expiry
              </caption>
              <thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Artefact
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Organisation
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Expiry date
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Validity
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {expiring.items.map((item) => (
                  <tr key={item.id}>
                    <td className="px-4 py-3 font-medium">
                      {item.artefactType}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {item.clientName ?? "Organisation name unavailable"}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {item.expiryDate ?? "Not recorded"}
                    </td>
                    <td className="px-4 py-3">
                      <StateBadge
                        state={
                          item.expiryBand === "expired"
                            ? "expired"
                            : item.expiryBand === "critical" ||
                                item.expiryBand === "warning"
                              ? "pending"
                              : "partial"
                        }
                        label={item.expiryBand.replace("_", " ")}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : !loading && !vaultQuery.isError ? (
        <StatusPanel
          state="empty"
          title="No evidence in the expiry window"
          description="This only means the expiry endpoint returned no records. It does not prove every requirement has approved, current evidence."
        />
      ) : null}
    </div>
  );
}
