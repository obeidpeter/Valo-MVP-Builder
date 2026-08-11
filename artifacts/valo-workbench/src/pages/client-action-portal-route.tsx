import { useRef } from "react";
import { useSearchParams } from "wouter";
import {
  customFetch,
  getListProjectsQueryKey,
  useGetMe,
  useListProjects,
} from "@workspace/api-client-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  adaptClientActionAuthorities,
  adaptClientActionSnapshot,
  type ClientActionAuthorityDirectory,
  type ClientActionSnapshot,
} from "@/components/client-action-portal/client-action-contract";
import {
  ClientActionWorkspace,
  type ClientActionMutation,
} from "@/components/client-action-portal/client-action-workspace";
import {
  LoadingPanel,
  PageHeader,
  StatusPanel,
} from "@/components/platform-states";
import { Button } from "@/components/ui/button";
import { useOrganisationAccess } from "@/contexts/organisation-context";
import { useToast } from "@/hooks/use-toast";

const QUERY_ROOT = "client-action-portal";
const CLIENT_ACTION_QUERY_CAPABILITIES = [
  "project:read",
  "evidence:write",
  "evidence:approve",
  "document:upload",
  "package:export",
] as const;

function capabilityFingerprint(permissions: readonly string[]): string {
  return CLIENT_ACTION_QUERY_CAPABILITIES.map((permission) =>
    permissions.includes(permission) ? permission : `!${permission}`,
  ).join("|");
}

async function getSnapshot(
  projectId: string,
  organisationId: string,
): Promise<ClientActionSnapshot> {
  const value = await customFetch<unknown>(
    `/api/projects/${encodeURIComponent(projectId)}/client-actions`,
    { responseType: "json", cache: "no-store" },
  );
  return adaptClientActionSnapshot(value, projectId, organisationId);
}

async function getAuthorities(input: {
  organisationId: string;
  projectId: string;
  currentUserId: string;
}): Promise<ClientActionAuthorityDirectory> {
  const value = await customFetch<unknown>(
    `/api/projects/${encodeURIComponent(input.projectId)}/client-actions/authorities`,
    { responseType: "json", cache: "no-store" },
  );
  return adaptClientActionAuthorities(
    value,
    input.organisationId,
    input.projectId,
    input.currentUserId,
  );
}

export default function ClientActionPortalRoute() {
  const [searchParams, setSearchParams] = useSearchParams();
  const access = useOrganisationAccess();
  const meQuery = useGetMe();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const organisationId = access?.activeOrganisation?.id ?? "";
  const directMembership =
    access?.activeOrganisation?.accessSource === "membership" &&
    access.activeOrganisation.membershipOrganisationId === organisationId;
  const permissions = access?.effectivePermissions ?? [];
  const actorUserId = meQuery.data?.id ?? "";
  const capabilityKey = capabilityFingerprint(permissions);
  const canAccess = Boolean(
    organisationId && directMembership && permissions.includes("project:read"),
  );
  const activeActorContext = useRef({
    organisationId,
    actorUserId,
    capabilityKey,
  });
  activeActorContext.current = {
    organisationId,
    actorUserId,
    capabilityKey,
  };
  const projectsQuery = useListProjects(undefined, {
    query: {
      queryKey: [
        ...getListProjectsQueryKey(),
        organisationId,
        actorUserId,
        capabilityKey,
      ],
      enabled: canAccess && Boolean(actorUserId),
      select: (projects) => {
        if (
          activeActorContext.current.organisationId !== organisationId ||
          activeActorContext.current.actorUserId !== actorUserId ||
          activeActorContext.current.capabilityKey !== capabilityKey
        ) {
          throw new Error(
            "Client action authority changed while pursuits loaded",
          );
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
  const canView = Boolean(projectId && canAccess);
  const canCreateEvidenceRequest =
    canView &&
    permissions.includes("evidence:write") &&
    selectedProject?.status !== "signed_off" &&
    selectedProject?.status !== "exported" &&
    selectedProject?.status !== "archived";
  const activeScope = useRef({
    organisationId,
    projectId,
    actorUserId,
    capabilityKey,
  });
  activeScope.current = {
    organisationId,
    projectId,
    actorUserId,
    capabilityKey,
  };
  const queryKey = [
    QUERY_ROOT,
    organisationId,
    projectId,
    actorUserId,
    capabilityKey,
  ] as const;
  const snapshotQuery = useQuery({
    queryKey,
    queryFn: async () => {
      const requestedScope = {
        organisationId,
        projectId,
        actorUserId,
        capabilityKey,
      };
      const result = await getSnapshot(projectId, organisationId);
      if (
        activeScope.current.organisationId !== requestedScope.organisationId ||
        activeScope.current.projectId !== requestedScope.projectId ||
        activeScope.current.actorUserId !== requestedScope.actorUserId ||
        activeScope.current.capabilityKey !== requestedScope.capabilityKey
      ) {
        throw new Error("Client action authority changed while records loaded");
      }
      return result;
    },
    enabled: canView && Boolean(actorUserId),
  });
  const authorityQueryKey = [
    QUERY_ROOT,
    "authorities",
    organisationId,
    projectId,
    actorUserId,
    capabilityKey,
  ] as const;
  const authoritiesQuery = useQuery({
    queryKey: authorityQueryKey,
    queryFn: async () => {
      const currentUserId = actorUserId;
      if (!currentUserId) throw new Error("Named actor is unavailable");
      const requestedScope = {
        organisationId,
        projectId,
        actorUserId,
        capabilityKey,
      };
      const result = await getAuthorities({
        ...requestedScope,
        currentUserId,
      });
      if (
        activeScope.current.organisationId !== requestedScope.organisationId ||
        activeScope.current.projectId !== requestedScope.projectId ||
        activeScope.current.actorUserId !== requestedScope.actorUserId ||
        activeScope.current.capabilityKey !== requestedScope.capabilityKey
      ) {
        throw new Error("Client action scope changed while authorities loaded");
      }
      return result;
    },
    enabled: canCreateEvidenceRequest && Boolean(actorUserId),
  });
  const mutation = useMutation({
    mutationFn: async (input: ClientActionMutation) => {
      const requestedScope = {
        organisationId,
        projectId,
        actorUserId,
        capabilityKey,
      };
      const release = access?.beginCriticalWorkflow();
      try {
        const result = await customFetch(
          `/api/projects/${encodeURIComponent(projectId)}/client-actions/${input.path}`,
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
          activeScope.current.projectId !== requestedScope.projectId ||
          activeScope.current.actorUserId !== requestedScope.actorUserId ||
          activeScope.current.capabilityKey !== requestedScope.capabilityKey
        ) {
          throw new Error("Client action scope changed while action completed");
        }
        return result;
      } finally {
        release?.();
      }
    },
    onSuccess: () => {
      toast({ title: "Client action recorded" });
      void queryClient.invalidateQueries({ queryKey });
    },
    onError: () => {
      toast({
        variant: "destructive",
        title: "Client action could not be recorded",
        description:
          "Reload the current pursuit before retrying. No message, file upload or package transfer was performed by this action.",
      });
      void queryClient.invalidateQueries({ queryKey });
    },
  });

  if (!canAccess) {
    return (
      <div className="p-5 sm:p-8">
        <StatusPanel
          state="blocked"
          title="Direct client membership required"
          description="Client actions are not available through partner-derived or emergency access."
        />
      </div>
    );
  }
  if (meQuery.isLoading || projectsQuery.isLoading) {
    return (
      <div className="p-5 sm:p-8">
        <LoadingPanel label="Loading available pursuits" />
      </div>
    );
  }
  if (meQuery.isError || !meQuery.data || projectsQuery.isError) {
    return (
      <div className="p-5 sm:p-8">
        <StatusPanel
          state="error"
          title="Available pursuits could not be verified"
          description="No project or client action has been inferred."
        />
      </div>
    );
  }
  if (!canView) {
    return (
      <div className="p-5 sm:p-8">
        <StatusPanel
          state="empty"
          title="No pursuit is available"
          description="An authorised bid lead must create or share a pursuit before client actions can be recorded."
        />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-7 p-5 sm:p-8">
      <section
        aria-labelledby="client-action-project-heading"
        className="flex flex-col gap-3 rounded-lg border bg-card p-4 sm:flex-row sm:items-end sm:justify-between"
      >
        <div>
          <h2
            id="client-action-project-heading"
            className="text-sm font-semibold"
          >
            Active pursuit
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Requests and acknowledgements are limited to this exact project.
          </p>
        </div>
        <label
          className="grid gap-1.5 text-xs font-medium"
          htmlFor="client-action-project"
        >
          Pursuit
          <select
            id="client-action-project"
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
        eyebrow="Client action workspace"
        title="Provide evidence and acknowledge delivery"
        description="A purpose-bound, named-human workspace for controlled evidence responses, corrections and exact released-package acknowledgements."
        state={
          snapshotQuery.isError
            ? "error"
            : snapshotQuery.isLoading
              ? "pending"
              : "active"
        }
      />
      {permissions.includes("evidence:write") &&
      (selectedProject?.status === "signed_off" ||
        selectedProject?.status === "exported" ||
        selectedProject?.status === "archived") ? (
        <StatusPanel
          state="unavailable"
          title="Evidence-request creation is closed"
          description="This pursuit is signed off, exported, or archived. Existing client-action records remain reviewable, but new evidence requests cannot be added to released content."
        />
      ) : null}
      {snapshotQuery.isLoading ? (
        <LoadingPanel label="Loading controlled client actions" />
      ) : null}
      {snapshotQuery.isError || !snapshotQuery.data ? (
        <StatusPanel
          state="error"
          title="Client actions are unavailable"
          description="Do not interpret this as an empty request list or a completed delivery."
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
      {snapshotQuery.data && actorUserId ? (
        <ClientActionWorkspace
          key={`${organisationId}:${projectId}:${actorUserId}:${capabilityKey}`}
          snapshot={snapshotQuery.data}
          currentUserId={actorUserId}
          canReview={permissions.includes("evidence:approve")}
          canCreateEvidenceRequest={canCreateEvidenceRequest}
          authorityOptions={authoritiesQuery.data?.items ?? []}
          authorityState={
            authoritiesQuery.isError
              ? "error"
              : authoritiesQuery.isLoading || authoritiesQuery.isPending
                ? "loading"
                : "ready"
          }
          pending={mutation.isPending}
          onMutate={(input) => mutation.mutate(input)}
        />
      ) : null}
    </div>
  );
}
