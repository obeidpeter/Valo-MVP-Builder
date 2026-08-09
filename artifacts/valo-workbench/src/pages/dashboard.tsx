import {
  type Gate0Metric,
  type ProjectSummary,
  type VaultExpiringItem,
  useGetDashboardMetrics,
  useGetVaultExpiring,
  useGetWorkflowAlerts,
  useListProjects,
} from "@workspace/api-client-react";
import { ArrowRight, Check, FileCheck2, Target, X } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DataErrorPanel,
  LoadingPanel,
  PageHeader,
  StateBadge,
  StatusPanel,
  type SurfaceState,
} from "@/components/platform-states";

const TERMINAL_STATUSES = new Set(["signed_off", "exported", "archived"]);
const WAT_TIME_ZONE = "Africa/Lagos";
const LOADING_VALUE = "\u2026";
const UNAVAILABLE_VALUE = "\u2014";

const watDateTimeFormatter = new Intl.DateTimeFormat("en-NG", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: WAT_TIME_ZONE,
});

const watDateFormatter = new Intl.DateTimeFormat("en-NG", {
  dateStyle: "medium",
  timeZone: WAT_TIME_ZONE,
});

const countFormatter = new Intl.NumberFormat("en-NG");

function parseRecordedDate(value: string): Date {
  // Project deadlines originate from a datetime-local field. When the stored
  // value has no explicit offset, treat it as the product's WAT business time
  // instead of silently applying the viewer's device timezone.
  const hasTime = value.includes("T");
  const hasExplicitZone = /(?:z|[+-]\d{2}:?\d{2})$/i.test(value);
  return new Date(hasTime && !hasExplicitZone ? `${value}+01:00` : value);
}

function formatWatDateTime(value: string): string {
  const parsed = parseRecordedDate(value);
  if (Number.isNaN(parsed.getTime())) return "Invalid recorded date";
  return `${watDateTimeFormatter.format(parsed)} WAT`;
}

function formatWatDate(value: string): string {
  const parsed = parseRecordedDate(value);
  if (Number.isNaN(parsed.getTime())) return "Invalid recorded date";
  return watDateFormatter.format(parsed);
}

function deadlineTime(project: ProjectSummary): number | null {
  if (!project.deadline) return null;
  const timestamp = parseRecordedDate(project.deadline).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

function formatGate0Value(value: number, unit: Gate0Metric["unit"]): string {
  return unit === "ratio"
    ? `${(value * 100).toFixed(0)}%`
    : countFormatter.format(value);
}

function projectDecisionReasons(
  project: ProjectSummary,
  slaProjectIds: Set<string>,
  redTeamProjectIds: Set<string>,
): Array<{ label: string; state: SurfaceState }> {
  const reasons: Array<{ label: string; state: SurfaceState }> = [];

  if (slaProjectIds.has(project.id)) {
    reasons.push({ label: "Review SLA breached", state: "blocked" });
  }
  if (redTeamProjectIds.has(project.id)) {
    reasons.push({ label: "Red-team review due", state: "pending" });
  }
  if (
    project.conflictStatus === "blocked" ||
    project.conflictStatus === "declined"
  ) {
    reasons.push({
      label: "Conflict decision blocks intake",
      state: "blocked",
    });
  }
  if ((project.fatalDefectCount ?? 0) > 0) {
    reasons.push({
      label: `${countFormatter.format(project.fatalDefectCount ?? 0)} fatal or likely-fatal finding${project.fatalDefectCount === 1 ? "" : "s"} recorded`,
      state: "pending",
    });
  }
  if (project.paymentStatus === "pending") {
    reasons.push({ label: "Payment confirmation pending", state: "pending" });
  }
  if (project.riskBand === "critical" || project.riskBand === "high") {
    reasons.push({
      label: `${project.riskBand === "critical" ? "Critical" : "High"} recorded risk`,
      state: "pending",
    });
  }

  return reasons;
}

function projectPriority(
  project: ProjectSummary,
  slaProjectIds: Set<string>,
  redTeamProjectIds: Set<string>,
): number {
  let score = 0;
  if (slaProjectIds.has(project.id)) score += 100;
  if (
    project.conflictStatus === "blocked" ||
    project.conflictStatus === "declined"
  ) {
    score += 90;
  }
  if ((project.fatalDefectCount ?? 0) > 0) score += 80;
  if (redTeamProjectIds.has(project.id)) score += 70;
  if (project.riskBand === "critical") score += 60;
  else if (project.riskBand === "high") score += 50;
  if (project.paymentStatus === "pending") score += 40;

  const deadline = deadlineTime(project);
  if (deadline !== null) {
    score += deadline < Date.now() ? 30 : 10;
  }
  return score;
}

function vaultState(item: VaultExpiringItem): SurfaceState {
  if (item.expiryBand === "expired" || item.expiryBand === "critical") {
    return "expired";
  }
  if (item.expiryBand === "warning" || item.expiryBand === "upcoming") {
    return "pending";
  }
  return "partial";
}

function vaultStateLabel(item: VaultExpiringItem): string {
  const days = item.daysToExpiry;
  if (item.expiryBand === "expired") {
    return days === null || days === undefined
      ? "Expired"
      : `Expired ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ago`;
  }
  if (item.expiryBand === "critical" && days === 0) return "Expires today";
  if (days !== null && days !== undefined) {
    return `${days} day${days === 1 ? "" : "s"} remaining`;
  }
  return "Expiry needs review";
}

function SignalCard({
  title,
  value,
  description,
  state,
}: {
  title: string;
  value: string | number;
  description: string;
  state: SurfaceState;
}) {
  return (
    <Card className="shadow-none">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold">{title}</h2>
            <p
              className="mt-3 text-3xl font-semibold tracking-tight"
              aria-label={`${title}: ${value}`}
            >
              {value}
            </p>
          </div>
          <StateBadge state={state} />
        </div>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      </CardContent>
    </Card>
  );
}

function SectionHeading({
  id,
  title,
  description,
  action,
}: {
  id: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h2 id={id} className="text-xl font-semibold tracking-tight">
          {title}
        </h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      </div>
      {action}
    </div>
  );
}

export default function Dashboard() {
  const metricsQuery = useGetDashboardMetrics();
  const projectsQuery = useListProjects();
  const vaultQuery = useGetVaultExpiring();
  const alertsQuery = useGetWorkflowAlerts();

  const metrics = metricsQuery.data;
  const projects = projectsQuery.data ?? [];
  const expiring = vaultQuery.data;
  const workflowAlerts = alertsQuery.data;
  const activeProjects = projects.filter(
    (project) => !TERMINAL_STATUSES.has(project.status),
  );
  const slaProjectIds = new Set(
    workflowAlerts?.slaBreaches.map((alert) => alert.projectId) ?? [],
  );
  const redTeamProjectIds = new Set(
    workflowAlerts?.redTeamDue.map((alert) => alert.projectId) ?? [],
  );

  const decisionProjects = [...activeProjects]
    .sort(
      (left, right) =>
        projectPriority(right, slaProjectIds, redTeamProjectIds) -
          projectPriority(left, slaProjectIds, redTeamProjectIds) ||
        new Date(right.createdAt).getTime() -
          new Date(left.createdAt).getTime(),
    )
    .slice(0, 6);

  const activeDeadlineProjects = activeProjects
    .filter((project) => deadlineTime(project) !== null)
    .sort(
      (left, right) =>
        (deadlineTime(left) ?? Number.POSITIVE_INFINITY) -
        (deadlineTime(right) ?? Number.POSITIVE_INFINITY),
    );
  const deadlineProjects = activeDeadlineProjects.slice(0, 6);

  const now = Date.now();
  const recordedDeadlinesPassed = activeDeadlineProjects.filter(
    (project) => (deadlineTime(project) ?? Number.POSITIVE_INFINITY) < now,
  ).length;
  const conflictBlocked = activeProjects.filter(
    (project) =>
      project.conflictStatus === "blocked" ||
      project.conflictStatus === "declined",
  ).length;
  const materialFindingProjects = activeProjects.filter(
    (project) => (project.fatalDefectCount ?? 0) > 0,
  ).length;

  const sources = [
    { name: "portfolio measures", query: metricsQuery },
    { name: "pursuit register", query: projectsQuery },
    { name: "evidence validity", query: vaultQuery },
    { name: "workflow alerts", query: alertsQuery },
  ];
  const unavailableSources = sources.filter(
    ({ query }) =>
      query.isError || (!query.isLoading && query.data === undefined),
  );
  const allLoading = sources.every(({ query }) => query.isLoading);
  const anyLoading = sources.some(({ query }) => query.isLoading);
  const allUnavailable = unavailableSources.length === sources.length;
  const pageState: SurfaceState = allLoading
    ? "pending"
    : allUnavailable
      ? "error"
      : unavailableSources.length > 0 || anyLoading
        ? "partial"
        : "active";
  const alertsUnavailable =
    alertsQuery.isError || (!alertsQuery.isLoading && !workflowAlerts);
  const projectsUnavailable =
    projectsQuery.isError ||
    (!projectsQuery.isLoading && projectsQuery.data === undefined);

  const retryAll = () => {
    void metricsQuery.refetch();
    void projectsQuery.refetch();
    void vaultQuery.refetch();
    void alertsQuery.refetch();
  };

  return (
    <main className="mx-auto w-full max-w-7xl space-y-8 p-5 sm:p-8">
      <PageHeader
        title="Command Centre"
        description="Review deadline, decision and exception signals before opening a pursuit. Dates and times are shown in West Africa Time (WAT)."
        state={pageState}
        actions={
          <Button asChild variant="outline">
            <Link href="/projects">Open all pursuits</Link>
          </Button>
        }
      />

      {allLoading ? (
        <LoadingPanel label="Loading Command Centre signals" />
      ) : null}

      {allUnavailable && !allLoading ? (
        <DataErrorPanel
          title="Command Centre data could not be loaded"
          description="No decision, deadline or readiness conclusion can be drawn until the connected sources respond."
          onRetry={retryAll}
        />
      ) : null}

      {!allUnavailable && unavailableSources.length > 0 ? (
        <StatusPanel
          state="partial"
          title="Some Command Centre signals are unavailable"
          description={`Available sections remain visible, but ${unavailableSources.map((source) => source.name).join(", ")} could not be verified. Do not interpret an unavailable count as zero.`}
        >
          <Button type="button" variant="outline" onClick={retryAll}>
            Retry unavailable signals
          </Button>
        </StatusPanel>
      ) : null}

      {!allLoading && !allUnavailable ? (
        <section
          aria-labelledby="attention-snapshot-heading"
          className="space-y-4"
        >
          <SectionHeading
            id="attention-snapshot-heading"
            title="Attention snapshot"
            description="Counts are exception signals, not automatic release or submission decisions. Open the relevant pursuit to verify its current control state."
          />
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <SignalCard
              title="Review SLA breaches"
              value={
                alertsQuery.isLoading
                  ? LOADING_VALUE
                  : alertsUnavailable
                    ? UNAVAILABLE_VALUE
                    : (workflowAlerts?.slaBreaches.length ?? 0)
              }
              state={
                alertsQuery.isLoading
                  ? "pending"
                  : alertsUnavailable
                    ? "error"
                    : (workflowAlerts?.slaBreaches.length ?? 0) > 0
                      ? "blocked"
                      : "empty"
              }
              description="Deterministic workflow alerts whose review due time has elapsed."
            />
            <SignalCard
              title="Recorded deadlines passed"
              value={
                projectsQuery.isLoading
                  ? LOADING_VALUE
                  : projectsUnavailable
                    ? UNAVAILABLE_VALUE
                    : recordedDeadlinesPassed
              }
              state={
                projectsQuery.isLoading
                  ? "pending"
                  : projectsUnavailable
                    ? "error"
                    : recordedDeadlinesPassed > 0
                      ? "pending"
                      : "empty"
              }
              description="Active pursuits whose recorded submission time is in the past; this does not assert submission status."
            />
            <SignalCard
              title="Conflict blocks"
              value={
                projectsQuery.isLoading
                  ? LOADING_VALUE
                  : projectsUnavailable
                    ? UNAVAILABLE_VALUE
                    : conflictBlocked
              }
              state={
                projectsQuery.isLoading
                  ? "pending"
                  : projectsUnavailable
                    ? "error"
                    : conflictBlocked > 0
                      ? "blocked"
                      : "empty"
              }
              description="Active pursuits with a blocked or declined conflict decision."
            />
            <SignalCard
              title="Material findings recorded"
              value={
                projectsQuery.isLoading
                  ? LOADING_VALUE
                  : projectsUnavailable
                    ? UNAVAILABLE_VALUE
                    : materialFindingProjects
              }
              state={
                projectsQuery.isLoading
                  ? "pending"
                  : projectsUnavailable
                    ? "error"
                    : materialFindingProjects > 0
                      ? "pending"
                      : "empty"
              }
              description="Pursuits containing fatal or likely-fatal findings. Their current resolution status must be checked in the pursuit readiness gate."
            />
          </div>
        </section>
      ) : null}

      {!allLoading && !allUnavailable ? (
        <section aria-labelledby="decisions-heading" className="space-y-4">
          <SectionHeading
            id="decisions-heading"
            title="Pursuit decisions and next actions"
            description="Prioritised from current workflow alerts and project summaries. Valo does not infer clearance from a missing or failed source."
            action={
              <Link
                href="/projects"
                className="inline-flex items-center gap-2 rounded-sm text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                View pursuit register
                <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
            }
          />

          {projectsQuery.isLoading ? (
            <LoadingPanel label="Loading pursuit decisions" />
          ) : projectsQuery.isError || projectsQuery.data === undefined ? (
            <StatusPanel
              state="error"
              title="Pursuit decisions are unavailable"
              description="The project register did not load, so no project-level exception or next action can be verified."
            />
          ) : decisionProjects.length === 0 ? (
            <StatusPanel
              state="empty"
              title="No active pursuits returned"
              description="The selected organisation has no active pursuit summaries. This is an empty register, not a readiness verdict."
            />
          ) : (
            <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
              {decisionProjects.map((project) => {
                const reasons = projectDecisionReasons(
                  project,
                  slaProjectIds,
                  redTeamProjectIds,
                );
                return (
                  <Link
                    key={project.id}
                    href={`/projects/${project.id}?tab=overview`}
                    aria-label={`Open pursuit next actions: ${project.tenderTitle}`}
                    className="flex min-h-24 items-center justify-between gap-4 px-4 py-4 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-5"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold text-foreground">
                          {project.tenderTitle}
                        </h3>
                        <StateBadge
                          state={
                            reasons.some((reason) => reason.state === "blocked")
                              ? "blocked"
                              : reasons.length > 0
                                ? "pending"
                                : "active"
                          }
                          label={
                            reasons.length > 0
                              ? `${reasons.length} attention signal${reasons.length === 1 ? "" : "s"}`
                              : "No summary exception"
                          }
                        />
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {project.clientName ?? "Client name unavailable"}
                        {project.reviewerName
                          ? ` · Reviewer: ${project.reviewerName}`
                          : " · Reviewer not recorded"}
                      </p>
                      <p className="mt-2 text-sm font-medium">
                        Next action:{" "}
                        {project.nextAction ?? "Review pursuit state"}
                      </p>
                      {reasons.length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {reasons.map((reason) => (
                            <StateBadge
                              key={reason.label}
                              state={reason.state}
                              label={reason.label}
                            />
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <ArrowRight
                      aria-hidden="true"
                      className="size-5 shrink-0 text-muted-foreground"
                    />
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      ) : null}

      {!allLoading && !allUnavailable ? (
        <div className="grid gap-8 xl:grid-cols-2">
          <section
            aria-labelledby="deadline-register-heading"
            className="space-y-4"
          >
            <SectionHeading
              id="deadline-register-heading"
              title="Submission deadline register"
              description="Recorded tender deadlines for active pursuits, ordered by timestamp in WAT."
            />
            {projectsQuery.isLoading ? (
              <LoadingPanel label="Loading recorded deadlines" />
            ) : projectsQuery.isError || projectsQuery.data === undefined ? (
              <StatusPanel
                state="error"
                title="Deadlines are unavailable"
                description="The project register did not load. Do not treat the deadline queue as clear."
              />
            ) : deadlineProjects.length === 0 ? (
              <StatusPanel
                state="empty"
                title="No active pursuit deadlines recorded"
                description="Active pursuits were returned, but none contains a valid recorded deadline."
              />
            ) : (
              <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
                {deadlineProjects.map((project) => {
                  const timestamp = deadlineTime(project);
                  const passed = timestamp !== null && timestamp < now;
                  return (
                    <Link
                      key={project.id}
                      href={`/projects/${project.id}?tab=overview`}
                      aria-label={`Open deadline details: ${project.tenderTitle}`}
                      className="flex min-h-20 items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    >
                      <div className="min-w-0">
                        <p className="font-medium">{project.tenderTitle}</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {formatWatDateTime(project.deadline ?? "")}
                        </p>
                      </div>
                      <StateBadge
                        state="pending"
                        label={passed ? "Recorded time passed" : "Upcoming"}
                      />
                    </Link>
                  );
                })}
              </div>
            )}
          </section>

          <section
            aria-labelledby="workflow-exceptions-heading"
            className="space-y-4"
          >
            <SectionHeading
              id="workflow-exceptions-heading"
              title="Workflow exceptions"
              description="Server-reported SLA breaches and red-team review windows."
            />
            {alertsQuery.isLoading ? (
              <LoadingPanel label="Loading workflow exceptions" />
            ) : alertsQuery.isError || !workflowAlerts ? (
              <StatusPanel
                state="error"
                title="Workflow exceptions are unavailable"
                description="The workflow-alert endpoint did not return a verified queue."
              />
            ) : workflowAlerts.slaBreaches.length === 0 &&
              workflowAlerts.redTeamDue.length === 0 ? (
              <StatusPanel
                state="empty"
                title="No workflow exceptions reported"
                description="The alert endpoint returned no SLA breach or red-team-due records. Project readiness controls still apply."
              />
            ) : (
              <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
                {workflowAlerts.slaBreaches.slice(0, 4).map((alert) => (
                  <Link
                    key={`sla-${alert.projectId}`}
                    href={`/projects/${alert.projectId}?tab=overview`}
                    aria-label={`Open SLA breach: ${alert.tenderTitle}`}
                    className="flex min-h-20 items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <div className="min-w-0">
                      <p className="font-medium">{alert.tenderTitle}</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Review due {formatWatDateTime(alert.dueAt)}
                      </p>
                    </div>
                    <StateBadge state="blocked" label="SLA breached" />
                  </Link>
                ))}
                {workflowAlerts.redTeamDue.slice(0, 4).map((alert) => (
                  <Link
                    key={`red-team-${alert.projectId}`}
                    href={`/projects/${alert.projectId}?tab=defects`}
                    aria-label={`Open red-team review: ${alert.tenderTitle}`}
                    className="flex min-h-20 items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <div className="min-w-0">
                      <p className="font-medium">{alert.tenderTitle}</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Review window opened {formatWatDateTime(alert.dueAt)}
                      </p>
                    </div>
                    <StateBadge state="pending" label="Red-team due" />
                  </Link>
                ))}
              </div>
            )}
          </section>
        </div>
      ) : null}

      {!allLoading && !allUnavailable ? (
        <section
          aria-labelledby="evidence-validity-heading"
          className="space-y-4"
        >
          <SectionHeading
            id="evidence-validity-heading"
            title="Evidence validity exceptions"
            description="Expired and approaching-expiry client artefacts from the connected evidence Vault."
            action={
              <Link
                href="/evidence-readiness"
                className="inline-flex items-center gap-2 rounded-sm text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                Open evidence readiness
                <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
            }
          />
          {vaultQuery.isLoading ? (
            <LoadingPanel label="Loading evidence validity" />
          ) : vaultQuery.isError || !expiring ? (
            <StatusPanel
              state="error"
              title="Evidence validity is unavailable"
              description="Vault expiry records could not be verified. Do not infer that evidence is current."
            />
          ) : expiring.items.length === 0 ? (
            <StatusPanel
              state="empty"
              title="No expiry exceptions returned"
              description="The Vault endpoint returned no artefacts in its expiry window."
            />
          ) : (
            <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
              {expiring.items.slice(0, 6).map((item) => (
                <Link
                  key={item.id}
                  href={`/clients/${item.clientId}`}
                  aria-label={`Open evidence record: ${item.artefactType} for ${item.clientName ?? "client"}`}
                  className="flex min-h-20 items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <div className="min-w-0">
                    <p className="font-medium">{item.artefactType}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {item.clientName ?? "Client name unavailable"}
                      {item.expiryDate
                        ? ` · Recorded expiry ${formatWatDate(item.expiryDate)}`
                        : " · Expiry date unavailable"}
                    </p>
                  </div>
                  <StateBadge
                    state={vaultState(item)}
                    label={vaultStateLabel(item)}
                  />
                </Link>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {!allLoading && !allUnavailable ? (
        <section aria-labelledby="gate-zero-heading" className="space-y-4">
          <SectionHeading
            id="gate-zero-heading"
            title="Gate 0 readiness"
            description="Business validation thresholds from the connected dashboard metrics. These measures do not replace pursuit-level quality or release gates."
          />
          {metricsQuery.isLoading ? (
            <LoadingPanel label="Loading Gate 0 measures" />
          ) : metricsQuery.isError || !metrics ? (
            <StatusPanel
              state="error"
              title="Gate 0 measures are unavailable"
              description="The metrics source did not return a verified Gate 0 position."
            />
          ) : !metrics.gate0 ? (
            <StatusPanel
              state="unavailable"
              title="Gate 0 measures are not present"
              description="Portfolio metrics loaded, but this response did not include the Gate 0 threshold set."
            />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-4">
                <Target aria-hidden="true" className="size-5 text-primary" />
                <p className="font-semibold">
                  {metrics.gate0.metCount} of {metrics.gate0.totalCount}{" "}
                  thresholds met
                </p>
                <StateBadge
                  state={
                    metrics.gate0.metCount === metrics.gate0.totalCount
                      ? "active"
                      : "pending"
                  }
                  label={
                    metrics.gate0.metCount === metrics.gate0.totalCount
                      ? "Thresholds met"
                      : "Thresholds outstanding"
                  }
                />
              </div>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {metrics.gate0.metrics.map((metric) => (
                  <Card key={metric.key} className="shadow-none">
                    <CardContent className="p-5">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <h3 className="text-sm font-semibold">
                            {metric.label}
                          </h3>
                          {metric.description ? (
                            <p className="mt-1 text-sm leading-6 text-muted-foreground">
                              {metric.description}
                            </p>
                          ) : null}
                        </div>
                        <span
                          className={`flex size-8 shrink-0 items-center justify-center rounded-full border ${metric.met ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-900"}`}
                          role="img"
                          aria-label={
                            metric.met
                              ? "Threshold met"
                              : "Threshold outstanding"
                          }
                        >
                          {metric.met ? (
                            <Check aria-hidden="true" className="size-4" />
                          ) : (
                            <X aria-hidden="true" className="size-4" />
                          )}
                        </span>
                      </div>
                      <p className="mt-4 text-2xl font-semibold">
                        {formatGate0Value(metric.value, metric.unit)}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Target:{" "}
                        {formatGate0Value(metric.threshold, metric.unit)} or
                        more
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </>
          )}
        </section>
      ) : null}

      <aside className="flex gap-3 rounded-lg border border-border bg-muted/30 p-4 text-sm leading-6 text-muted-foreground">
        <FileCheck2 aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
        <p>
          Command Centre signals support triage only. Named reviewers must still
          confirm evidence, resolve blocking findings and complete the
          pursuit-level readiness checks before sign-off or export.
        </p>
      </aside>
    </main>
  );
}
