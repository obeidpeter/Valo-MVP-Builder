import { useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import {
  adaptPrivacyOperationsAssignees,
  adaptPrivacyOperationsDashboard,
  assertPrivacyWorkflowResponse,
  type PrivacyConsentWithdrawalDraft,
  type PrivacyDsrTriageDraft,
  type PrivacyHoldReviewDraft,
} from "@/components/privacy-operations/privacy-operations-contract";
import { PrivacyOperationsDashboardView } from "@/components/privacy-operations/privacy-operations-dashboard";
import { PrivacyWorkflowPanel } from "@/components/privacy-operations/privacy-workflow-panel";
import { StatusPanel } from "@/components/platform-states";
import { Button } from "@/components/ui/button";
import { useOrganisationAccess } from "@/contexts/organisation-context";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { useToast } from "@/hooks/use-toast";

const QUERY_ROOT = "privacy-operations";

interface WorkflowMutation {
  path: string;
  objectId: string;
  expectedEventType:
    | "privacy.dsr_triage_recorded"
    | "privacy.consent_withdrawal_recorded"
    | "privacy.legal_hold_review_recorded";
  version: number;
  body:
    | PrivacyDsrTriageDraft
    | PrivacyConsentWithdrawalDraft
    | PrivacyHoldReviewDraft;
}

export default function PrivacyOperationsPage() {
  const access = useOrganisationAccess();
  const online = useOnlineStatus();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const organisationId = access?.activeOrganisation?.id ?? "";
  const permissions = access?.effectivePermissions ?? [];
  const directMembership =
    access?.activeOrganisation?.accessSource === "membership";
  const canRead = Boolean(
    organisationId && directMembership && permissions.includes("privacy:read"),
  );
  const canManage = Boolean(
    organisationId &&
    directMembership &&
    permissions.includes("privacy:manage"),
  );
  const activeOrganisationId = useRef(organisationId);
  activeOrganisationId.current = organisationId;
  const queryKey = [QUERY_ROOT, organisationId] as const;

  const assigneesQuery = useQuery({
    queryKey: [QUERY_ROOT, "assignees", organisationId],
    enabled: canManage && online,
    queryFn: async () => {
      const requestedOrganisationId = organisationId;
      const payload = await customFetch<unknown>(
        "/api/privacy-operations/assignees",
        { responseType: "json", cache: "no-store" },
      );
      if (activeOrganisationId.current !== requestedOrganisationId) {
        throw new Error("Organisation changed while assignees loaded");
      }
      return adaptPrivacyOperationsAssignees(payload, requestedOrganisationId);
    },
  });

  const dashboardQuery = useQuery({
    queryKey,
    enabled: canRead && online,
    queryFn: async () => {
      const requestedOrganisationId = organisationId;
      const payload = await customFetch<unknown>(
        "/api/privacy-operations?limit=25",
        { responseType: "json", cache: "no-store" },
      );
      if (activeOrganisationId.current !== requestedOrganisationId) {
        throw new Error("Organisation changed while privacy evidence loaded");
      }
      return adaptPrivacyOperationsDashboard(payload, requestedOrganisationId);
    },
  });

  const workflowMutation = useMutation({
    mutationFn: async (workflow: WorkflowMutation) => {
      const requestedOrganisationId = organisationId;
      const releaseCriticalWorkflow = access?.beginCriticalWorkflow();
      try {
        const payload = await customFetch<unknown>(workflow.path, {
          method: "POST",
          headers: { "If-Match": `"${workflow.version}"` },
          body: JSON.stringify(workflow.body),
          responseType: "json",
          cache: "no-store",
        });
        if (activeOrganisationId.current !== requestedOrganisationId) {
          throw new Error(
            "Organisation changed while privacy evidence was recorded",
          );
        }
        assertPrivacyWorkflowResponse(
          payload,
          workflow.objectId,
          workflow.expectedEventType,
        );
        return {
          organisationId: requestedOrganisationId,
          receiptSha256: payload.receipt.receiptSha256,
        };
      } finally {
        releaseCriticalWorkflow?.();
      }
    },
    onSuccess: ({ organisationId: recordedOrganisationId, receiptSha256 }) => {
      toast({
        title: "Privacy workflow evidence recorded",
        description: `Receipt ${receiptSha256.slice(0, 12)}…`,
      });
      void queryClient.invalidateQueries({
        queryKey: [QUERY_ROOT, recordedOrganisationId],
      });
    },
    onError: () => {
      toast({
        title: "Privacy workflow was not recorded",
        description:
          "Reload the tenant view and verify the named-human evidence before retrying.",
        variant: "destructive",
      });
    },
  });

  if (!canRead) {
    return (
      <div className="p-5 sm:p-8">
        <StatusPanel
          state="blocked"
          title="Direct privacy-read membership required"
          description="This centre rejects partner-derived and emergency access. A direct tenant membership with privacy:read is required."
        />
      </div>
    );
  }

  if (!online) {
    return (
      <div className="p-5 sm:p-8">
        <StatusPanel
          state="offline"
          title="Live privacy evidence is unavailable offline"
          description="No cached dashboard or legal posture is inferred. Reconnect to load the tenant-RLS registers."
        />
      </div>
    );
  }

  if (dashboardQuery.isLoading) {
    return (
      <div className="p-5 sm:p-8">
        <StatusPanel
          state="pending"
          title="Loading minimised privacy evidence"
          description="Checking tenant scope, due dates, evidence digests and audit receipts."
        />
      </div>
    );
  }

  if (dashboardQuery.isError || !dashboardQuery.data) {
    return (
      <div className="p-5 sm:p-8">
        <StatusPanel
          state="error"
          title="Privacy evidence could not be verified"
          description="The interface has failed closed and does not infer compliance or a legal conclusion."
        >
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            onClick={() => void dashboardQuery.refetch()}
          >
            Retry verification
          </Button>
        </StatusPanel>
      </div>
    );
  }

  const run = (workflow: WorkflowMutation) =>
    workflowMutation.mutateAsync(workflow).then(() => {});

  return (
    <PrivacyOperationsDashboardView
      dashboard={dashboardQuery.data}
      workflowPanel={
        canManage ? (
          <PrivacyWorkflowPanel
            dashboard={dashboardQuery.data}
            assigneeOptions={
              assigneesQuery.data?.items.map(({ userId, name }) => ({
                id: userId,
                name,
              })) ?? []
            }
            busy={workflowMutation.isPending}
            onTriage={(id, version, body) =>
              run({
                path: `/api/privacy-operations/data-subject-requests/${id}/triage`,
                objectId: id,
                expectedEventType: "privacy.dsr_triage_recorded",
                version,
                body,
              })
            }
            onWithdraw={(id, version, body) =>
              run({
                path: `/api/privacy-operations/consent-records/${id}/withdrawal`,
                objectId: id,
                expectedEventType: "privacy.consent_withdrawal_recorded",
                version,
                body,
              })
            }
            onReviewHold={(id, version, body) =>
              run({
                path: `/api/privacy-operations/legal-holds/${id}/reviews`,
                objectId: id,
                expectedEventType: "privacy.legal_hold_review_recorded",
                version,
                body,
              })
            }
          />
        ) : undefined
      }
    />
  );
}
