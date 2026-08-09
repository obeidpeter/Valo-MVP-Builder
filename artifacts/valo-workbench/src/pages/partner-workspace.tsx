import {
  getGetVaultExpiringQueryKey,
  getListPartnerRelationshipsQueryKey,
  getListProjectsQueryKey,
  useGetVaultExpiring,
  useListPartnerRelationships,
  useListProjects,
  type PartnerRelationship,
  type ProjectSummary,
} from "@workspace/api-client-react";
import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DataErrorPanel,
  LoadingPanel,
  PageHeader,
  QueueCapabilityCard,
  StateBadge,
  StatusPanel,
  type SurfaceState,
} from "@/components/platform-states";
import { platformFeatureFlags } from "@/lib/platform-access";
import { useOnlineStatus } from "@/hooks/use-online-status";

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "Not recorded";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return `${new Intl.DateTimeFormat("en-NG", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Lagos",
  }).format(parsed)} WAT`;
}

function relationshipState(relationship: PartnerRelationship): {
  state: SurfaceState;
  label: string;
} {
  const rawStatus = String(relationship.status);
  if (rawStatus === "pending") return { state: "pending", label: "Pending" };
  if (rawStatus === "suspended") {
    return { state: "blocked", label: "Suspended" };
  }
  if (rawStatus === "revoked") {
    return { state: "unavailable", label: "Revoked" };
  }
  if (rawStatus !== "active") {
    return { state: "unavailable", label: "Unknown lifecycle state" };
  }

  const now = Date.now();
  if (
    relationship.accessStartsAt &&
    new Date(relationship.accessStartsAt).getTime() > now
  ) {
    return { state: "pending", label: "Scheduled" };
  }
  if (
    relationship.accessExpiresAt &&
    new Date(relationship.accessExpiresAt).getTime() <= now
  ) {
    return { state: "expired", label: "Expired" };
  }
  return { state: "active", label: "Active" };
}

function projectState(project: ProjectSummary): {
  state: SurfaceState;
  label: string;
} {
  if (
    (project.fatalDefectCount ?? 0) > 0 ||
    project.conflictStatus === "blocked" ||
    project.conflictStatus === "declined"
  ) {
    return { state: "blocked", label: "Recorded blocker" };
  }
  if (project.status === "archived") {
    return { state: "unavailable", label: "Archived" };
  }
  if (project.status === "signed_off" || project.status === "exported") {
    return {
      state: "active",
      label: project.status === "signed_off" ? "Signed off" : "Exported",
    };
  }
  return { state: "partial", label: project.status.replaceAll("_", " ") };
}

export default function PartnerWorkspace() {
  const enabled = platformFeatureFlags().partnerWorkspace;
  const online = useOnlineStatus();
  const relationshipsQuery = useListPartnerRelationships({
    query: {
      queryKey: getListPartnerRelationshipsQueryKey(),
      enabled,
    },
  });
  const projectsQuery = useListProjects(undefined, {
    query: {
      queryKey: getListProjectsQueryKey(),
      enabled,
    },
  });
  const vaultQuery = useGetVaultExpiring({
    query: {
      queryKey: getGetVaultExpiringQueryKey(),
      enabled,
    },
  });

  if (!enabled) {
    return (
      <div className="mx-auto w-full max-w-7xl space-y-7 p-5 sm:p-8">
        <PageHeader
          eyebrow="Consultancy channel"
          title="Partner workspace"
          description="Delegated consultancy operations with client-retained ownership and server-attributed access."
          state="pending"
        />
        <StatusPanel
          state="pending"
          title="Partner workspace requires activation"
          description="The partner edition is commercially gated for this deployment. No partner relationship, client assignment, branding change or revenue event is being simulated while activation is pending."
        />
        <StatusPanel
          state="active"
          title="Quality controls remain invariant"
          description="Activation and partner branding never change evidence validity, conflict controls, fatal blockers or named sign-off requirements."
        />
      </div>
    );
  }

  const loading =
    relationshipsQuery.isLoading ||
    projectsQuery.isLoading ||
    vaultQuery.isLoading;
  const hasError =
    relationshipsQuery.isError || projectsQuery.isError || vaultQuery.isError;
  const relationships = relationshipsQuery.data ?? [];
  const projects = projectsQuery.data ?? [];
  const activeRelationships = relationships.filter(
    (relationship) => relationshipState(relationship).state === "active",
  );
  const blockedProjects = projects.filter(
    (project) =>
      (project.fatalDefectCount ?? 0) > 0 ||
      project.conflictStatus === "blocked" ||
      project.conflictStatus === "declined",
  );
  const atRiskEvidence = vaultQuery.data
    ? vaultQuery.data.buckets.expired +
      vaultQuery.data.buckets.critical +
      vaultQuery.data.buckets.warning +
      vaultQuery.data.buckets.upcoming
    : 0;

  const retry = () => {
    void relationshipsQuery.refetch();
    void projectsQuery.refetch();
    void vaultQuery.refetch();
  };

  return (
    <div className="mx-auto w-full max-w-7xl space-y-7 p-5 sm:p-8">
      <PageHeader
        eyebrow="Consultancy channel"
        title="Partner workspace"
        description="Read-only relationship, selected-tenant pursuit and evidence-expiry summaries returned for the current server-authorised partner membership."
        state={!online ? "offline" : loading ? "pending" : "partial"}
        actions={
          <Button asChild variant="outline">
            <Link href="/evidence-readiness">
              Review evidence library
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          </Button>
        }
      />

      <StatusPanel
        state="partial"
        title="Client ownership remains explicit"
        description="This relationship register intentionally returns identifiers, lifecycle, QA responsibility and co-signing policy. The separate organisation selector exposes a named client context only after the server validates the active relationship and partner-edition activation; this page never infers client project data from an identifier."
      />
      <StatusPanel
        state="active"
        title="Quality controls remain invariant"
        description="Partner membership never changes evidence validity, requirement status, conflict controls, fatal blockers or named sign-off requirements."
      />

      {!online ? (
        <StatusPanel
          state="offline"
          title="Partner workspace data may be stale"
          description="Reconnect before relying on relationship lifecycle, pursuit or evidence-expiry records."
        />
      ) : null}

      {loading ? (
        <LoadingPanel label="Loading partner workspace records" />
      ) : null}
      {hasError ? (
        <DataErrorPanel
          title="Some partner workspace records could not be loaded"
          description="Available sections may be incomplete. Missing relationship, pursuit or evidence rows must not be interpreted as no access or no risk."
          onRetry={retry}
        />
      ) : null}

      {!loading ? (
        <section
          aria-labelledby="partner-signals-heading"
          className="space-y-4"
        >
          <div>
            <h2 id="partner-signals-heading" className="text-xl font-semibold">
              Connected partner signals
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Each count remains scoped to the selected organisation and the
              current server-authorised relationship context.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <QueueCapabilityCard
              title="Relationship records"
              description="Partner/client relationships visible to this tenant."
              state={
                relationshipsQuery.isError
                  ? "error"
                  : relationships.length > 0
                    ? "partial"
                    : "empty"
              }
              value={
                relationshipsQuery.isError
                  ? "Unavailable"
                  : relationships.length
              }
            />
            <QueueCapabilityCard
              title="Active client relationships"
              description="Relationships currently active within their recorded access window."
              state={
                relationshipsQuery.isError
                  ? "error"
                  : activeRelationships.length > 0
                    ? "active"
                    : "empty"
              }
              value={
                relationshipsQuery.isError
                  ? "Unavailable"
                  : activeRelationships.length
              }
            />
            <QueueCapabilityCard
              title="Selected-tenant blockers"
              description="Partner-tenant pursuits with fatal or conflict blockers."
              state={
                projectsQuery.isError
                  ? "error"
                  : blockedProjects.length > 0
                    ? "blocked"
                    : "empty"
              }
              value={
                projectsQuery.isError ? "Unavailable" : blockedProjects.length
              }
            />
            <QueueCapabilityCard
              title="Evidence in expiry window"
              description="Partner-tenant Vault artefacts expired or approaching expiry."
              state={
                vaultQuery.isError
                  ? "error"
                  : (vaultQuery.data?.buckets.expired ?? 0) > 0
                    ? "expired"
                    : atRiskEvidence > 0
                      ? "pending"
                      : "empty"
              }
              value={vaultQuery.isError ? "Unavailable" : atRiskEvidence}
            />
          </div>
        </section>
      ) : null}

      {relationshipsQuery.isSuccess ? (
        <section
          aria-labelledby="managed-clients-heading"
          className="space-y-3"
        >
          <div>
            <h2 id="managed-clients-heading" className="text-xl font-semibold">
              Assigned client relationships
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Client names are not in this API contract; identifiers are shown
              without enrichment or inference.
            </p>
          </div>
          {relationships.length === 0 ? (
            <StatusPanel
              state="empty"
              title="No partner relationships returned"
              description="The selected partner tenant has no visible relationship records. This does not create or imply client access."
            />
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {relationships.map((relationship) => {
                const status = relationshipState(relationship);
                return (
                  <article
                    key={relationship.id}
                    className="rounded-lg border border-border bg-card p-5"
                    aria-labelledby={`relationship-${relationship.id}`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3
                          id={`relationship-${relationship.id}`}
                          className="text-sm font-semibold"
                        >
                          Client organisation
                        </h3>
                        <code className="mt-1 block break-all text-xs text-muted-foreground">
                          {relationship.clientOrganisationId}
                        </code>
                      </div>
                      <StateBadge state={status.state} label={status.label} />
                    </div>
                    <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
                      <div>
                        <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Ownership
                        </dt>
                        <dd className="mt-1">Client retained</dd>
                      </div>
                      <div>
                        <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Co-signing
                        </dt>
                        <dd className="mt-1">
                          {relationship.coSigningRequired
                            ? "Required"
                            : "Not recorded as required"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Access starts
                        </dt>
                        <dd className="mt-1">
                          {relationship.accessStartsAt
                            ? formatDateTime(relationship.accessStartsAt)
                            : "Not started"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Access expires
                        </dt>
                        <dd className="mt-1">
                          {relationship.accessExpiresAt
                            ? formatDateTime(relationship.accessExpiresAt)
                            : "No expiry returned"}
                        </dd>
                      </div>
                    </dl>
                    <div className="mt-4 border-t border-border pt-4">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        QA responsibility
                      </p>
                      <p className="mt-1 text-sm leading-6">
                        {relationship.qaResponsibility ||
                          "No QA responsibility text returned"}
                      </p>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      ) : null}

      {projectsQuery.isSuccess ? (
        <section
          aria-labelledby="partner-pursuits-heading"
          className="space-y-3"
        >
          <div>
            <h2 id="partner-pursuits-heading" className="text-xl font-semibold">
              Selected partner-tenant pursuits
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              These rows come from the selected partner tenant. They are not
              presented as projects belonging to relationship client tenants.
            </p>
          </div>
          {projects.length === 0 ? (
            <StatusPanel
              state="empty"
              title="No partner-tenant pursuits returned"
              description="The current project endpoint returned no rows for this partner tenant. Relationship client projects are not inferred."
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border bg-card">
              <table className="w-full min-w-[760px] text-left text-sm">
                <caption className="sr-only">
                  Pursuits stored in the selected partner tenant
                </caption>
                <thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Pursuit
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Status
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Deadline
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Recorded next step
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {projects.map((project) => {
                    const status = projectState(project);
                    return (
                      <tr key={project.id}>
                        <td className="px-4 py-3">
                          <span className="block font-medium">
                            {project.tenderTitle}
                          </span>
                          <span className="mt-1 block text-xs text-muted-foreground">
                            {project.clientName || "Client record not named"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <StateBadge
                            state={status.state}
                            label={status.label}
                          />
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {formatDateTime(project.deadline)}
                        </td>
                        <td className="max-w-72 px-4 py-3 text-muted-foreground">
                          {project.nextAction || "No next step returned"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {vaultQuery.isSuccess ? (
        <section
          aria-labelledby="partner-evidence-heading"
          className="space-y-3"
        >
          <h2 id="partner-evidence-heading" className="text-xl font-semibold">
            Partner-tenant evidence expiry
          </h2>
          {vaultQuery.data.items.length === 0 ? (
            <StatusPanel
              state="empty"
              title="No partner-tenant evidence in the expiry window"
              description="The selected tenant returned no at-risk Vault records. This is not a statement about relationship client evidence."
            />
          ) : (
            <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
              {vaultQuery.data.items.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="text-sm font-medium">{item.artefactType}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {item.clientName || "Client record not named"} - expiry{" "}
                      {item.expiryDate || "not recorded"}
                    </p>
                  </div>
                  <StateBadge
                    state={
                      item.expiryBand === "expired"
                        ? "expired"
                        : item.expiryBand === "critical" ||
                            item.expiryBand === "warning"
                          ? "pending"
                          : "partial"
                    }
                    label={item.expiryBand.replaceAll("_", " ")}
                  />
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}

      <StatusPanel
        state="unavailable"
        title="Unsupported channel operations are omitted"
        description="Relationship writes, configurable branding, co-sign workflow and revenue settlement are not exposed here because the current frontend lacks complete authorised contracts for those operations. Verified client contexts, when available, are selected through the global organisation switcher."
      />
    </div>
  );
}
