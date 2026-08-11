import { useRef } from "react";
import { useSearchParams } from "wouter";
import {
  customFetch,
  getListPartnerRelationshipsQueryKey,
  getListProjectsQueryKey,
  useGetMe,
  useListPartnerRelationships,
  useListProjects,
} from "@workspace/api-client-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  adaptConsortiumParticipants,
  adaptConsortiumSnapshot,
  type ConsortiumMutation,
  type ConsortiumParticipantDirectory,
  type ConsortiumSnapshot,
} from "@/components/partner-consortium-room/partner-consortium-contract";
import {
  ConsortiumRoomInitializer,
  PartnerConsortiumWorkspace,
} from "@/components/partner-consortium-room/partner-consortium-workspace";
import {
  LoadingPanel,
  PageHeader,
  StatusPanel,
} from "@/components/platform-states";
import { Button } from "@/components/ui/button";
import { useOrganisationAccess } from "@/contexts/organisation-context";
import { useToast } from "@/hooks/use-toast";

const QUERY_ROOT = "partner-consortium-room";
const CONSORTIUM_QUERY_CAPABILITIES = [
  "project:read",
  "requirement:write",
  "partner_relationship:read",
] as const;

function capabilityFingerprint(
  permissions: readonly string[],
  accessSource: string | undefined,
): string {
  return [
    accessSource ?? "none",
    ...CONSORTIUM_QUERY_CAPABILITIES.map((permission) =>
      permissions.includes(permission) ? permission : `!${permission}`,
    ),
  ].join("|");
}

function activeRelationship(relationship: {
  status?: unknown;
  accessStartsAt?: string | null;
  accessExpiresAt?: string | null;
}): boolean {
  const now = Date.now();
  return (
    relationship.status === "active" &&
    (!relationship.accessStartsAt ||
      Date.parse(relationship.accessStartsAt) <= now) &&
    (!relationship.accessExpiresAt ||
      Date.parse(relationship.accessExpiresAt) > now)
  );
}

async function getSnapshot(input: {
  organisationId: string;
  projectId: string;
  relationshipId: string;
}): Promise<ConsortiumSnapshot | null> {
  try {
    const value = await customFetch<unknown>(
      `/api/projects/${encodeURIComponent(input.projectId)}/consortium-rooms/${encodeURIComponent(input.relationshipId)}`,
      { responseType: "json", cache: "no-store" },
    );
    return adaptConsortiumSnapshot(
      value,
      input.organisationId,
      input.projectId,
      input.relationshipId,
    );
  } catch (error) {
    if ((error as { status?: number } | null)?.status === 404) return null;
    throw error;
  }
}

async function getParticipants(input: {
  organisationId: string;
  projectId: string;
  relationshipId: string;
}): Promise<ConsortiumParticipantDirectory> {
  const value = await customFetch<unknown>(
    `/api/projects/${encodeURIComponent(input.projectId)}/consortium-rooms/${encodeURIComponent(input.relationshipId)}/participants`,
    { responseType: "json", cache: "no-store" },
  );
  return adaptConsortiumParticipants(
    value,
    input.organisationId,
    input.projectId,
    input.relationshipId,
  );
}

export default function PartnerConsortiumRoomRoute() {
  const [searchParams, setSearchParams] = useSearchParams();
  const access = useOrganisationAccess();
  const meQuery = useGetMe();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const organisation = access?.activeOrganisation ?? null;
  const organisationId = organisation?.id ?? "";
  const permissions = access?.effectivePermissions ?? [];
  const actorUserId = meQuery.data?.id ?? "";
  const capabilityKey = capabilityFingerprint(
    permissions,
    organisation?.accessSource,
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
      enabled: Boolean(organisationId && actorUserId),
      select: (projects) => {
        if (
          activeActorContext.current.organisationId !== organisationId ||
          activeActorContext.current.actorUserId !== actorUserId ||
          activeActorContext.current.capabilityKey !== capabilityKey
        ) {
          throw new Error("Consortium authority changed while projects loaded");
        }
        return projects;
      },
    },
  });
  const relationshipsQuery = useListPartnerRelationships({
    query: {
      queryKey: [
        ...getListPartnerRelationshipsQueryKey(),
        organisationId,
        actorUserId,
        capabilityKey,
      ],
      enabled: Boolean(organisationId && actorUserId),
      select: (relationships) => {
        if (
          activeActorContext.current.organisationId !== organisationId ||
          activeActorContext.current.actorUserId !== actorUserId ||
          activeActorContext.current.capabilityKey !== capabilityKey
        ) {
          throw new Error(
            "Consortium authority changed while relationships loaded",
          );
        }
        return relationships;
      },
    },
  });
  const projects = projectsQuery.data ?? [];
  const requestedProjectId = searchParams.get("project")?.trim() ?? "";
  const selectedProject =
    projects.find(({ id }) => id === requestedProjectId) ?? projects[0];
  const projectId = selectedProject?.id ?? "";
  const eligibleRelationships = (relationshipsQuery.data ?? []).filter(
    (relationship) =>
      relationship.clientOrganisationId === organisationId &&
      activeRelationship(relationship),
  );
  const forcedRelationshipId =
    organisation?.accessSource === "partner"
      ? organisation.partnerRelationshipId
      : null;
  const requestedRelationshipId =
    searchParams.get("relationship")?.trim() ?? "";
  const selectedRelationship = forcedRelationshipId
    ? eligibleRelationships.find(({ id }) => id === forcedRelationshipId)
    : (eligibleRelationships.find(({ id }) => id === requestedRelationshipId) ??
      eligibleRelationships[0]);
  const relationshipId = forcedRelationshipId ?? selectedRelationship?.id ?? "";
  const exactAccess = Boolean(
    organisation &&
    ((organisation.accessSource === "membership" &&
      organisation.membershipOrganisationId === organisationId &&
      organisation.partnerRelationshipId === null) ||
      (organisation.accessSource === "partner" &&
        organisation.partnerRelationshipId === relationshipId)),
  );
  const canRead = exactAccess && permissions.includes("project:read");
  const projectIsReleased =
    selectedProject?.status === "signed_off" ||
    selectedProject?.status === "exported" ||
    selectedProject?.status === "archived";
  const canWrite =
    canRead && permissions.includes("requirement:write") && !projectIsReleased;
  const canView = Boolean(
    canRead && organisationId && projectId && relationshipId,
  );
  const activeScope = useRef({
    organisationId,
    projectId,
    relationshipId,
    actorUserId,
    capabilityKey,
  });
  activeScope.current = {
    organisationId,
    projectId,
    relationshipId,
    actorUserId,
    capabilityKey,
  };
  const queryKey = [
    QUERY_ROOT,
    organisationId,
    projectId,
    relationshipId,
    actorUserId,
    capabilityKey,
  ] as const;
  const snapshotQuery = useQuery({
    queryKey,
    queryFn: async () => {
      const requestedScope = {
        organisationId,
        projectId,
        relationshipId,
        actorUserId,
        capabilityKey,
      };
      const result = await getSnapshot(requestedScope);
      if (
        activeScope.current.organisationId !== requestedScope.organisationId ||
        activeScope.current.projectId !== requestedScope.projectId ||
        activeScope.current.relationshipId !== requestedScope.relationshipId ||
        activeScope.current.actorUserId !== requestedScope.actorUserId ||
        activeScope.current.capabilityKey !== requestedScope.capabilityKey
      ) {
        throw new Error("Consortium scope changed while the room loaded");
      }
      return result;
    },
    enabled: canView && Boolean(actorUserId),
  });
  const participantQueryKey = [
    QUERY_ROOT,
    "participants",
    organisationId,
    projectId,
    relationshipId,
    actorUserId,
    capabilityKey,
  ] as const;
  const participantsQuery = useQuery({
    queryKey: participantQueryKey,
    queryFn: async () => {
      const requestedScope = {
        organisationId,
        projectId,
        relationshipId,
        actorUserId,
        capabilityKey,
      };
      const result = await getParticipants(requestedScope);
      if (
        activeScope.current.organisationId !== requestedScope.organisationId ||
        activeScope.current.projectId !== requestedScope.projectId ||
        activeScope.current.relationshipId !== requestedScope.relationshipId ||
        activeScope.current.actorUserId !== requestedScope.actorUserId ||
        activeScope.current.capabilityKey !== requestedScope.capabilityKey
      ) {
        throw new Error("Consortium scope changed while participants loaded");
      }
      return result;
    },
    enabled: canView && canWrite && Boolean(actorUserId),
  });

  const mutation = useMutation({
    mutationFn: async (input: ConsortiumMutation) => {
      const requestedScope = {
        organisationId,
        projectId,
        relationshipId,
        actorUserId,
        capabilityKey,
      };
      const release = access?.beginCriticalWorkflow();
      try {
        const base = `/api/projects/${encodeURIComponent(projectId)}/consortium-rooms/${encodeURIComponent(relationshipId)}`;
        const result = await customFetch(
          input.path ? `${base}/${input.path}` : base,
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
          activeScope.current.relationshipId !==
            requestedScope.relationshipId ||
          activeScope.current.actorUserId !== requestedScope.actorUserId ||
          activeScope.current.capabilityKey !== requestedScope.capabilityKey
        ) {
          throw new Error(
            "Consortium scope changed while the action completed",
          );
        }
        return result;
      } finally {
        release?.();
      }
    },
    onSuccess: () => {
      toast({ title: "Consortium coordination receipt recorded" });
      void queryClient.invalidateQueries({ queryKey });
    },
    onError: () => {
      toast({
        variant: "destructive",
        title: "Consortium action could not be recorded",
        description:
          "Reload the exact relationship room before retrying. No message, agreement, payment, release, or external action was performed.",
      });
      void queryClient.invalidateQueries({ queryKey });
    },
  });

  if (!canRead) {
    return (
      <div className="p-5 sm:p-8">
        <StatusPanel
          state="blocked"
          title="Exact relationship access required"
          description="Use a direct client membership or the active partner-authorised client context for this relationship."
        />
      </div>
    );
  }
  if (
    projectsQuery.isLoading ||
    relationshipsQuery.isLoading ||
    meQuery.isLoading
  ) {
    return (
      <div className="p-5 sm:p-8">
        <LoadingPanel label="Verifying relationship, project, and named actor" />
      </div>
    );
  }
  if (projectsQuery.isError || relationshipsQuery.isError || meQuery.isError) {
    return (
      <div className="p-5 sm:p-8">
        <StatusPanel
          state="error"
          title="Consortium authority could not be verified"
          description="No relationship, responsibility, acceptance, or QA state has been inferred."
        />
      </div>
    );
  }
  if (!projectId || !relationshipId || !selectedRelationship) {
    return (
      <div className="p-5 sm:p-8">
        <StatusPanel
          state="empty"
          title="No active relationship project is available"
          description="The room requires both an authorised project and an active exact partner relationship."
        />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-7 p-5 sm:p-8">
      <section className="grid gap-4 rounded-xl border bg-card p-4 md:grid-cols-2">
        <label className="grid gap-1.5 text-xs font-medium">
          Project
          <select
            className="min-h-11 rounded-md border border-input bg-background px-3 py-2 text-sm"
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
        <label className="grid gap-1.5 text-xs font-medium">
          Exact partner relationship
          <select
            className="min-h-11 rounded-md border border-input bg-background px-3 py-2 font-mono text-sm"
            value={relationshipId}
            disabled={Boolean(forcedRelationshipId) || mutation.isPending}
            onChange={(event) => {
              const next = new URLSearchParams(searchParams);
              next.set("relationship", event.currentTarget.value);
              setSearchParams(next, { replace: true });
            }}
          >
            {eligibleRelationships.map((relationship) => (
              <option key={relationship.id} value={relationship.id}>
                {relationship.id}
              </option>
            ))}
          </select>
        </label>
      </section>

      <PageHeader
        eyebrow="Partner and consortium room"
        title="Assign, accept, and independently check shared work"
        description="A bounded coordination ledger for one active relationship and one client-owned project, with bilateral ownership and immutable content-free receipts."
        state={
          snapshotQuery.isError
            ? "error"
            : snapshotQuery.isLoading
              ? "pending"
              : snapshotQuery.data
                ? "active"
                : "partial"
        }
      />

      {projectIsReleased ? (
        <StatusPanel
          state="unavailable"
          title="Released pursuit is read-only"
          description="Signed-off, exported, and archived pursuits cannot initialize or change consortium coordination. Existing records remain available for review."
        />
      ) : null}

      {snapshotQuery.isLoading ? (
        <LoadingPanel label="Loading the exact consortium room" />
      ) : null}
      {snapshotQuery.isError ? (
        <StatusPanel
          state="error"
          title="Consortium room is unavailable"
          description="Do not interpret this as an empty matrix, completed acceptance, or passed QA."
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
      {canWrite && participantsQuery.isError ? (
        <StatusPanel
          state="error"
          title="Named participant choices are unavailable"
          description="No coordinator or owner identifiers are inferred. Existing acceptance actions remain available, but initialization and ownership changes require a current server-authorized directory."
        >
          <Button
            type="button"
            variant="outline"
            onClick={() => void participantsQuery.refetch()}
          >
            Retry participant directory
          </Button>
        </StatusPanel>
      ) : null}
      {snapshotQuery.data === null &&
      canWrite &&
      participantsQuery.isLoading ? (
        <LoadingPanel label="Loading current named relationship participants" />
      ) : null}
      {snapshotQuery.data === null &&
      canWrite &&
      participantsQuery.isSuccess ? (
        <ConsortiumRoomInitializer
          participants={participantsQuery.data.items}
          pending={mutation.isPending}
          onMutate={(input) => mutation.mutate(input)}
        />
      ) : null}
      {snapshotQuery.data === null && !canWrite ? (
        <StatusPanel
          state="empty"
          title={
            projectIsReleased
              ? "No consortium room was recorded before release"
              : "Consortium room has not been initialized"
          }
          description={
            projectIsReleased
              ? "The released pursuit remains immutable; this page will not create a room retroactively."
              : "Requirement write permission is required to name both coordinators and create the bounded room."
          }
        />
      ) : null}
      {snapshotQuery.data && actorUserId ? (
        <PartnerConsortiumWorkspace
          key={`${organisationId}:${projectId}:${relationshipId}:${actorUserId}:${capabilityKey}`}
          snapshot={snapshotQuery.data}
          participants={participantsQuery.data?.items ?? []}
          actorUserId={actorUserId}
          canWrite={canWrite}
          pending={mutation.isPending}
          onMutate={(input) => mutation.mutate(input)}
        />
      ) : null}
    </div>
  );
}
