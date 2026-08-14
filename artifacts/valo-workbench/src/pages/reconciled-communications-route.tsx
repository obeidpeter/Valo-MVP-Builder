import { useRef } from "react";
import { useSearchParams } from "wouter";
import {
  customFetch,
  getListProjectsQueryKey,
  useListProjects,
} from "@workspace/api-client-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  adaptCommunicationReferences,
  adaptCommunicationSnapshot,
  type CommunicationMutation,
  type CommunicationReferenceSet,
  type CommunicationSnapshot,
} from "@/components/reconciled-communications/communications-contract";
import { CommunicationsHub } from "@/components/reconciled-communications/communications-hub";
import {
  LoadingPanel,
  PageGatePanel,
  PageHeader,
  StatusPanel,
} from "@/components/platform-states";
import { Button } from "@/components/ui/button";
import { useOrganisationAccess } from "@/contexts/organisation-context";
import { useToast } from "@/hooks/use-toast";

const QUERY_ROOT = "reconciled-communications";

async function getSnapshot(
  projectId: string,
  organisationId: string,
): Promise<CommunicationSnapshot> {
  const value = await customFetch<unknown>(
    `/api/projects/${encodeURIComponent(projectId)}/communications`,
    { responseType: "json", cache: "no-store" },
  );
  return adaptCommunicationSnapshot(value, projectId, organisationId);
}

async function getReferences(
  projectId: string,
  organisationId: string,
): Promise<CommunicationReferenceSet> {
  const value = await customFetch<unknown>(
    `/api/projects/${encodeURIComponent(projectId)}/communications/references`,
    { responseType: "json", cache: "no-store" },
  );
  return adaptCommunicationReferences(value, projectId, organisationId);
}

export default function ReconciledCommunicationsRoute() {
  const [searchParams, setSearchParams] = useSearchParams();
  const access = useOrganisationAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const organisationId = access?.activeOrganisation?.id ?? "";
  const permissions = access?.effectivePermissions ?? [];
  const directMembership =
    access?.activeOrganisation?.accessSource === "membership" &&
    access.activeOrganisation.membershipOrganisationId === organisationId;
  const canAccess = Boolean(
    organisationId && directMembership && permissions.includes("project:read"),
  );
  const activeOrganisationId = useRef(organisationId);
  activeOrganisationId.current = organisationId;
  const projectsQuery = useListProjects(undefined, {
    query: {
      queryKey: [...getListProjectsQueryKey(), organisationId],
      enabled: canAccess,
      select: (projects) => {
        if (activeOrganisationId.current !== organisationId) {
          throw new Error("Organisation changed while pursuits loaded");
        }
        return projects;
      },
    },
  });
  const projects = projectsQuery.data ?? [];
  const requestedProjectId = searchParams.get("project")?.trim() ?? "";
  const selectedProject =
    projects.find(({ id }) => id === requestedProjectId) ?? projects[0];
  const projectId = selectedProject?.id ?? "";
  const canManage = canAccess && permissions.includes("project:update");
  const canView = Boolean(projectId && canAccess);
  const activeScope = useRef({ organisationId, projectId });
  activeScope.current = { organisationId, projectId };
  const queryKey = [QUERY_ROOT, organisationId, projectId] as const;
  const referenceKey = [
    QUERY_ROOT,
    "references",
    organisationId,
    projectId,
  ] as const;

  const snapshotQuery = useQuery({
    queryKey,
    queryFn: async () => {
      const requestedScope = { organisationId, projectId };
      const result = await getSnapshot(projectId, organisationId);
      if (
        activeScope.current.organisationId !== requestedScope.organisationId ||
        activeScope.current.projectId !== requestedScope.projectId
      ) {
        throw new Error("Communication scope changed while the ledger loaded");
      }
      return result;
    },
    enabled: canView,
  });
  const referencesQuery = useQuery({
    queryKey: referenceKey,
    queryFn: async () => {
      const requestedScope = { organisationId, projectId };
      const result = await getReferences(projectId, organisationId);
      if (
        activeScope.current.organisationId !== requestedScope.organisationId ||
        activeScope.current.projectId !== requestedScope.projectId
      ) {
        throw new Error("Communication scope changed while choices loaded");
      }
      return result;
    },
    enabled: Boolean(canManage && projectId),
  });

  const mutation = useMutation({
    mutationFn: async (input: CommunicationMutation) => {
      const requestedScope = { organisationId, projectId };
      const release = access?.beginCriticalWorkflow();
      try {
        const result = await customFetch(
          `/api/projects/${encodeURIComponent(projectId)}/communications/${input.path}`,
          {
            method: "POST",
            body: JSON.stringify(input.body),
            responseType: "json",
            cache: "no-store",
          },
        );
        if (
          activeScope.current.organisationId !==
            requestedScope.organisationId ||
          activeScope.current.projectId !== requestedScope.projectId
        ) {
          throw new Error(
            "Communication scope changed while the action completed",
          );
        }
        return { input, result };
      } finally {
        release?.();
      }
    },
    onSuccess: ({ input }) => {
      toast({
        title:
          input.kind === "queue"
            ? "Communication intent queued"
            : input.kind === "attempt"
              ? "Delivery attempt reconciled to the ledger"
              : "Provider receipt checked",
        description:
          input.kind === "attempt"
            ? "Provider acceptance, if any, remains pending until a trusted delivery receipt is verified."
            : undefined,
      });
      void queryClient.invalidateQueries({ queryKey });
      void queryClient.invalidateQueries({ queryKey: referenceKey });
    },
    onError: () => {
      toast({
        variant: "destructive",
        title: "Communication action could not be verified",
        description:
          "Reload this pursuit before retrying. Do not infer that a message was sent or delivered.",
      });
      void queryClient.invalidateQueries({ queryKey });
      void queryClient.invalidateQueries({ queryKey: referenceKey });
    },
  });

  if (!canAccess) {
    return (
      <PageGatePanel
        state="blocked"
        title="Direct membership required"
        description="The communications ledger is unavailable through partner-derived or emergency access."
      />
    );
  }
  if (projectsQuery.isLoading) {
    return (
      <div className="p-5 sm:p-8">
        <LoadingPanel label="Loading available pursuits" />
      </div>
    );
  }
  if (projectsQuery.isError) {
    return (
      <PageGatePanel
        state="error"
        title="Available pursuits could not be verified"
        description="No communication scope or delivery state has been inferred."
      />
    );
  }
  if (!canView) {
    return (
      <PageGatePanel
        state="empty"
        title="No pursuit is available"
        description="Select an authorised pursuit before recording a communication intent."
      />
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-7 p-5 sm:p-8">
      <section
        aria-labelledby="communications-project-heading"
        className="flex flex-col gap-3 rounded-lg border bg-card p-4 sm:flex-row sm:items-end sm:justify-between"
      >
        <div>
          <h2
            id="communications-project-heading"
            className="text-sm font-semibold"
          >
            Active pursuit
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Intents, attempts, consent, and receipts remain scoped to this exact
            project.
          </p>
        </div>
        <label
          className="grid gap-1.5 text-xs font-medium"
          htmlFor="communications-project"
        >
          Pursuit
          <select
            id="communications-project"
            className="min-h-11 min-w-64 rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={projectId}
            disabled={mutation.isPending}
            onChange={(event) => {
              const next = new URLSearchParams(searchParams);
              next.set("project", event.currentTarget.value);
              setSearchParams(next, { replace: true });
            }}
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.tenderTitle}
              </option>
            ))}
          </select>
        </label>
      </section>

      <PageHeader
        eyebrow="Reconciled communications"
        title="Human-controlled delivery, backed by receipts"
        description="Queue content-minimised approved templates, record every external attempt before effect, and reconcile provider receipts without ever treating acceptance as delivery."
        state={
          snapshotQuery.isError
            ? "error"
            : snapshotQuery.isLoading
              ? "pending"
              : "active"
        }
      />

      {snapshotQuery.isLoading ? (
        <LoadingPanel label="Loading the communication ledger" />
      ) : null}
      {snapshotQuery.isError || !snapshotQuery.data ? (
        <StatusPanel
          state="error"
          title="Communication ledger is unavailable"
          description="Do not interpret this as an empty queue or a completed delivery."
        >
          <Button
            type="button"
            variant="outline"
            onClick={() => void snapshotQuery.refetch()}
          >
            Retry
          </Button>
        </StatusPanel>
      ) : null}
      {snapshotQuery.data ? (
        <CommunicationsHub
          key={`${organisationId}:${projectId}`}
          snapshot={snapshotQuery.data}
          references={referencesQuery.data ?? null}
          referencesLoading={referencesQuery.isLoading}
          canManage={canManage}
          pending={mutation.isPending}
          onMutate={(input) => mutation.mutate(input)}
        />
      ) : null}
    </div>
  );
}
