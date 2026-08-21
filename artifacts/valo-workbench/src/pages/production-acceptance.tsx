import { useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { ProductionAcceptanceConsole } from "@/components/production-acceptance/production-acceptance-console";
import {
  adaptProductionAcceptanceAuthorities,
  adaptProductionAcceptanceSnapshot,
  assertProductionAcceptanceRecordResponse,
  type ProductionAcceptanceEvidenceDraft,
} from "@/components/production-acceptance/production-acceptance-contract";
import { ProductionAcceptanceEvidenceForm } from "@/components/production-acceptance/production-acceptance-evidence-form";
import { PageGatePanel, StatusPanel } from "@/components/platform-states";
import { Button } from "@/components/ui/button";
import { useOrganisationAccess } from "@/contexts/organisation-context";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { useToast } from "@/hooks/use-toast";

const QUERY_ROOT = "production-acceptance";
const READ_ROLES = new Set([
  "valo_operations_administrator",
  "restricted_platform_administrator",
  "valo_quality_adviser",
]);
const RECORD_ROLES = new Set([
  "valo_operations_administrator",
  "valo_quality_adviser",
]);

export default function ProductionAcceptancePage() {
  const access = useOrganisationAccess();
  const online = useOnlineStatus();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const organisationId = access?.activeOrganisation?.id ?? "";
  const roles = access?.effectiveRoles ?? [];
  const permissions = access?.effectivePermissions ?? [];
  const directMembership =
    access?.activeOrganisation?.accessSource === "membership";
  const canRead = Boolean(
    organisationId &&
    directMembership &&
    permissions.includes("audit:read") &&
    roles.some((role) => READ_ROLES.has(role)),
  );
  const canRecord = Boolean(
    canRead &&
    roles.some((role) => RECORD_ROLES.has(role)) &&
    (permissions.includes("configuration:manage") ||
      permissions.includes("evaluation:manage")),
  );
  const activeOrganisationId = useRef(organisationId);
  activeOrganisationId.current = organisationId;
  const queryKey = [QUERY_ROOT, organisationId] as const;

  const authoritiesQuery = useQuery({
    queryKey: [QUERY_ROOT, "authorities", organisationId],
    enabled: canRecord && online,
    queryFn: async () => {
      const requestedOrganisationId = organisationId;
      const payload = await customFetch<unknown>(
        "/api/production-acceptance/authorities",
        {
          responseType: "json",
          cache: "no-store",
        },
      );
      if (activeOrganisationId.current !== requestedOrganisationId) {
        throw new Error(
          "Organisation changed while acceptance authorities loaded",
        );
      }
      return adaptProductionAcceptanceAuthorities(
        payload,
        requestedOrganisationId,
      );
    },
  });
  const ownerOptions =
    authoritiesQuery.data?.items.map(({ userId, name }) => ({
      id: userId,
      name,
    })) ?? [];

  const snapshotQuery = useQuery({
    queryKey,
    enabled: canRead && online,
    queryFn: async () => {
      const requestedOrganisationId = organisationId;
      const payload = await customFetch<unknown>("/api/production-acceptance", {
        responseType: "json",
        cache: "no-store",
      });
      if (activeOrganisationId.current !== requestedOrganisationId) {
        throw new Error(
          "Organisation changed while acceptance evidence loaded",
        );
      }
      return adaptProductionAcceptanceSnapshot(
        payload,
        requestedOrganisationId,
      );
    },
  });

  const evidenceMutation = useMutation({
    mutationFn: async (draft: ProductionAcceptanceEvidenceDraft) => {
      const requestedOrganisationId = organisationId;
      const releaseCriticalWorkflow = access?.beginCriticalWorkflow();
      try {
        const payload = await customFetch<unknown>(
          "/api/production-acceptance/evidence",
          {
            method: "POST",
            body: JSON.stringify(draft),
            responseType: "json",
            cache: "no-store",
          },
        );
        if (activeOrganisationId.current !== requestedOrganisationId) {
          throw new Error(
            "Organisation changed while acceptance evidence recorded",
          );
        }
        assertProductionAcceptanceRecordResponse(
          payload,
          requestedOrganisationId,
        );
        return requestedOrganisationId;
      } finally {
        releaseCriticalWorkflow?.();
      }
    },
    onSuccess: (recordedOrganisationId) => {
      toast({ title: "Acceptance evidence reference recorded" });
      void queryClient.invalidateQueries({
        queryKey: [QUERY_ROOT, recordedOrganisationId],
      });
    },
  });

  if (!canRead) {
    return (
      <PageGatePanel
        state="blocked"
        title="Internal audit membership required"
        description="Production acceptance evidence is available only to named Valo operations, restricted-platform and quality roles with direct membership and audit-read authority. Partner-derived and emergency access are denied."
      />
    );
  }

  if (!online) {
    return (
      <PageGatePanel
        state="offline"
        title="Live acceptance evidence is unavailable offline"
        description="Do not infer a go decision from cached or absent evidence. Reconnect and refresh the server-verified register."
      />
    );
  }

  if (snapshotQuery.isLoading) {
    return (
      <PageGatePanel
        state="pending"
        title="Loading production acceptance evidence"
        description="Verifying tenant scope, immutable digests, release binding and expiry windows."
      />
    );
  }

  if (snapshotQuery.isError || !snapshotQuery.data) {
    return (
      <PageGatePanel
        state="error"
        title="Production acceptance evidence could not be verified"
        description="The safe state is no-go. No empty or successful release state has been inferred."
      >
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          onClick={() => void snapshotQuery.refetch()}
        >
          Retry verification
        </Button>
      </PageGatePanel>
    );
  }

  return (
    <ProductionAcceptanceConsole
      snapshot={snapshotQuery.data}
      evidenceRecorder={
        canRecord ? (
          authoritiesQuery.isLoading ? (
            <StatusPanel
              state="pending"
              title="Loading acceptance authorities"
              description="Evidence recording remains disabled until the current tenant authority directory is verified."
            />
          ) : authoritiesQuery.isError || !authoritiesQuery.data ? (
            <StatusPanel
              state="error"
              title="Acceptance authorities could not be loaded"
              description="The directory state is unknown; this is not evidence that no independent authority exists. Retry before recording evidence."
            >
              <Button
                type="button"
                variant="outline"
                onClick={() => void authoritiesQuery.refetch()}
              >
                Retry authority directory
              </Button>
            </StatusPanel>
          ) : (
            <ProductionAcceptanceEvidenceForm
              releaseSha256={snapshotQuery.data.expectedReleaseSha256}
              ownerOptions={ownerOptions}
              pending={evidenceMutation.isPending}
              onSubmit={(draft) =>
                evidenceMutation.mutateAsync(draft).then(() => {})
              }
            />
          )
        ) : undefined
      }
    />
  );
}
