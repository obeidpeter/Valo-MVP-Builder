import { useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import {
  AiShadowProgrammeConsole,
  type AiShadowObservationCreateDraft,
  type AiShadowPlanCreateDraft,
} from "@/components/ai-shadow-programme/ai-shadow-console";
import {
  adaptAiShadowSnapshot,
  type AiShadowPlanSnapshot,
} from "@/components/ai-shadow-programme/ai-shadow-contract";
import { StatusPanel } from "@/components/platform-states";
import { Button } from "@/components/ui/button";
import { useOrganisationAccess } from "@/contexts/organisation-context";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { useToast } from "@/hooks/use-toast";

const READ_ROLES = new Set([
  "valo_operations_administrator",
  "valo_quality_adviser",
  "restricted_platform_administrator",
]);
const MANAGE_ROLES = new Set([
  "valo_operations_administrator",
  "valo_quality_adviser",
]);

function assertSafeMutation(value: unknown, organisationId: string): void {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("AI shadow mutation response is invalid");
  const response = value as Record<string, unknown>;
  if (
    response.productionActivationGranted !== false &&
    !(
      response.authority &&
      typeof response.authority === "object" &&
      (response.authority as Record<string, unknown>)
        .productionActivationGranted === false
    )
  )
    throw new Error(
      "AI shadow mutation did not preserve the activation boundary",
    );
  const record = (response.plan ?? response.observation) as
    | Record<string, unknown>
    | undefined;
  if (!record || record.organisationId !== organisationId)
    throw new Error(
      "AI shadow mutation response escaped the active organisation",
    );
}

export default function AiShadowProgrammePage() {
  const access = useOrganisationAccess();
  const online = useOnlineStatus();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const organisationId = access?.activeOrganisation?.id ?? "";
  const roles = access?.effectiveRoles ?? [];
  const permissions = access?.effectivePermissions ?? [];
  const direct = access?.activeOrganisation?.accessSource === "membership";
  const canRead = Boolean(
    direct &&
    permissions.includes("evaluation:read") &&
    roles.some((role) => READ_ROLES.has(role)),
  );
  const canManage = Boolean(
    canRead &&
    permissions.includes("evaluation:manage") &&
    roles.some((role) => MANAGE_ROLES.has(role)),
  );
  const activeOrganisationId = useRef(organisationId);
  activeOrganisationId.current = organisationId;
  const queryKey = ["ai-shadow-programme", organisationId] as const;

  const snapshot = useQuery({
    queryKey,
    enabled: canRead && online,
    queryFn: async () => {
      const requestedOrganisationId = organisationId;
      const value = await customFetch<unknown>("/api/ai/shadow-programme", {
        responseType: "json",
        cache: "no-store",
      });
      if (activeOrganisationId.current !== requestedOrganisationId)
        throw new Error("Organisation changed while shadow evidence loaded");
      return adaptAiShadowSnapshot(value, requestedOrganisationId);
    },
  });

  const mutation = useMutation({
    mutationFn: async (
      request:
        | { kind: "plan"; body: AiShadowPlanCreateDraft }
        | {
            kind: "observation";
            planId: string;
            body: AiShadowObservationCreateDraft;
          }
        | { kind: "close"; item: AiShadowPlanSnapshot; reason: string },
    ) => {
      const requestedOrganisationId = organisationId;
      const release = access?.beginCriticalWorkflow();
      try {
        const url =
          request.kind === "plan"
            ? "/api/ai/shadow-programme/plans"
            : request.kind === "observation"
              ? `/api/ai/shadow-programme/plans/${request.planId}/observations`
              : `/api/ai/shadow-programme/plans/${request.item.plan.id}/close`;
        const body =
          request.kind === "close"
            ? {
                expectedVersion: request.item.plan.version,
                expectedObservationCount: request.item.observationCount,
                reason: request.reason,
              }
            : request.body;
        const value = await customFetch<unknown>(url, {
          method: "POST",
          body: JSON.stringify(body),
          responseType: "json",
          cache: "no-store",
        });
        if (activeOrganisationId.current !== requestedOrganisationId)
          throw new Error(
            "Organisation changed while shadow evidence was recorded",
          );
        assertSafeMutation(value, requestedOrganisationId);
        return requestedOrganisationId;
      } finally {
        release?.();
      }
    },
    onSuccess: (recordedOrganisationId) => {
      toast({ title: "AI shadow evidence register updated" });
      void queryClient.invalidateQueries({
        queryKey: ["ai-shadow-programme", recordedOrganisationId],
      });
    },
  });

  if (!canRead)
    return (
      <div className="p-5 sm:p-8">
        <StatusPanel
          state="blocked"
          title="Internal evaluation authority required"
          description="The AI Shadow Programme is restricted to direct named quality and operations memberships with evaluation-read authority. Partner-derived and emergency contexts are denied."
        />
      </div>
    );
  if (!online)
    return (
      <div className="p-5 sm:p-8">
        <StatusPanel
          state="offline"
          title="Live shadow evidence is unavailable offline"
          description="Reconnect before reading or recording the append-only evaluation register."
        />
      </div>
    );
  if (snapshot.isLoading)
    return (
      <div className="p-5 sm:p-8">
        <StatusPanel
          state="pending"
          title="Loading AI shadow evidence"
          description="Verifying tenant scope, exact version bindings and cohort coverage."
        />
      </div>
    );
  if (snapshot.isError || !snapshot.data)
    return (
      <div className="p-5 sm:p-8">
        <StatusPanel
          state="error"
          title="AI shadow evidence could not be verified"
          description="No empty, passing or activation state has been inferred."
        >
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            onClick={() => void snapshot.refetch()}
          >
            Retry verification
          </Button>
        </StatusPanel>
      </div>
    );

  return (
    <AiShadowProgrammeConsole
      key={organisationId}
      snapshot={snapshot.data}
      canManage={canManage}
      pending={mutation.isPending}
      onCreatePlan={(body) =>
        mutation.mutateAsync({ kind: "plan", body }).then(() => {})
      }
      onRecordObservation={(planId, body) =>
        mutation
          .mutateAsync({ kind: "observation", planId, body })
          .then(() => {})
      }
      onClosePlan={(item, reason) =>
        mutation.mutateAsync({ kind: "close", item, reason }).then(() => {})
      }
    />
  );
}
