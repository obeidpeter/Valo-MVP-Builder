import { customFetch } from "@workspace/api-client-react";
import { useMutation, useQuery } from "@tanstack/react-query";

export interface WorkflowSlaBreach {
  projectId: string;
  tenderTitle: string;
  dueAt: string;
  breached: boolean;
}

export interface WorkflowRedTeamDue {
  projectId: string;
  tenderTitle: string;
  dueAt: string;
}

export interface WorkflowVaultExpiry {
  vaultItemId: string;
  clientId: string;
  clientName: string | null;
  artefactType: string;
  expiry: {
    band: "expired" | "critical" | "warning" | "upcoming" | "ok" | "unknown";
    daysToExpiry: number | null;
    renewalLeadDays?: number | null;
  };
}

export interface WorkflowAlerts {
  slaBreaches: WorkflowSlaBreach[];
  redTeamDue: WorkflowRedTeamDue[];
  vaultExpiring: WorkflowVaultExpiry[];
}

export interface NotificationEvent {
  id: string;
  projectId: string | null;
  clientId: string | null;
  vaultItemId: string | null;
  channel: string;
  template: string;
  recipient: string | null;
  payload: string | null;
  status: string;
  createdAt: string;
}

export interface NotificationCreate {
  template: string;
  channel?: string;
  recipient?: string;
  payload?: unknown;
  status?: string;
}

export interface RetentionRequest {
  id: string;
  projectId: string;
  reason: string | null;
  dueAt: string;
  completedAt: string | null;
  certificateText: string | null;
  status: string;
  createdAt: string;
}

export interface RetentionRequestCreate {
  reason?: string;
  dueAt?: string;
}

export function useWorkflowAlerts() {
  return useQuery({
    queryKey: ["workflow-alerts"],
    queryFn: () => customFetch<WorkflowAlerts>("/api/workflow/alerts"),
  });
}

export function useProjectNotifications(projectId: string | undefined) {
  return useQuery({
    queryKey: ["project-notifications", projectId],
    enabled: Boolean(projectId),
    queryFn: () => customFetch<NotificationEvent[]>(`/api/projects/${projectId}/notifications`),
  });
}

export function useCreateProjectNotification(projectId: string) {
  return useMutation({
    mutationFn: (data: NotificationCreate) =>
      customFetch<NotificationEvent>(`/api/projects/${projectId}/notifications`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
  });
}

export function useCreateRetentionRequest(projectId: string) {
  return useMutation({
    mutationFn: (data: RetentionRequestCreate) =>
      customFetch<RetentionRequest>(`/api/projects/${projectId}/retention-requests`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
  });
}

export function useRetentionRequests() {
  return useQuery({
    queryKey: ["retention-requests"],
    queryFn: () => customFetch<RetentionRequest[]>("/api/retention-requests"),
  });
}

export function useCompleteRetentionRequest() {
  return useMutation({
    mutationFn: (id: string) =>
      customFetch<RetentionRequest>(`/api/retention-requests/${id}/complete`, {
        method: "POST",
      }),
  });
}
