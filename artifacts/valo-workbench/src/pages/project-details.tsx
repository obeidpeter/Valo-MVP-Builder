import { useParams } from "wouter";
import { 
  useGetProject, 
  useUpdateProject,
  getGetProjectQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Loader2, FileText, CheckSquare, Layers, AlertOctagon, FileBarChart, History, Activity, Calculator, ShieldAlert, Bell, Archive, Save } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  useCreateProjectNotification,
  useCreateRetentionRequest,
  useProjectNotifications,
} from "@/lib/operations-api";

import { DocumentsTab } from "./project-tabs/documents-tab";
import { RequirementsTab } from "./project-tabs/requirements-tab";
import { EvidenceTab } from "./project-tabs/evidence-tab";
import { DefectsTab } from "./project-tabs/defects-tab";
import { ReportsTab } from "./project-tabs/reports-tab";
import { BoqTab } from "./project-tabs/boq-tab";
import { RiskTab } from "./project-tabs/risk-tab";
import { AuditTab } from "./project-tabs/audit-tab";

const STATUS_OPTIONS = ["intake", "extraction", "review", "defects", "reporting", "signed_off", "exported", "archived"] as const;
const CONFLICT_OPTIONS = ["clear", "blocked", "consented", "declined"] as const;
type ProjectStatus = (typeof STATUS_OPTIONS)[number];
type SlaClass = "standard" | "live";
type PaymentStatus = "not_required" | "pending" | "confirmed";
type ConflictStatus = (typeof CONFLICT_OPTIONS)[number];

function errorMessage(err: unknown, fallback: string): string {
  const data = (err as { data?: unknown })?.data;
  if (data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string") {
    return (data as { error: string }).error;
  }
  return err instanceof Error ? err.message : fallback;
}

export default function ProjectDetails() {
  const { id } = useParams<{ id: string }>();
  const { data: project, isLoading } = useGetProject(id);
  const updateProject = useUpdateProject();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: notifications } = useProjectNotifications(id);
  const createNotification = useCreateProjectNotification(id ?? "");
  const createRetentionRequest = useCreateRetentionRequest(id ?? "");
  const [governance, setGovernance] = useState<{
    status: ProjectStatus;
    slaClass: SlaClass;
    paymentStatus: PaymentStatus;
    paymentConfirmedByFounder: boolean;
    paymentConfirmedByAdvisor: boolean;
    conflictStatus: ConflictStatus;
    conflictDecision: string;
    conflictRationale: string;
    physicalArchiveInstruction: string;
    redactionScope: string;
    restrictedMode: boolean;
  }>({
    status: "intake",
    slaClass: "standard",
    paymentStatus: "not_required",
    paymentConfirmedByFounder: false,
    paymentConfirmedByAdvisor: false,
    conflictStatus: "clear",
    conflictDecision: "",
    conflictRationale: "",
    physicalArchiveInstruction: "",
    redactionScope: "",
    restrictedMode: false,
  });
  const [notificationForm, setNotificationForm] = useState({
    template: "deadline_reminder",
    channel: "manual",
    recipient: "",
  });
  const [retentionReason, setRetentionReason] = useState("");

  useEffect(() => {
    if (!project) return;
    setGovernance({
      status: project.status as ProjectStatus,
      slaClass: (project.slaClass ?? "standard") as SlaClass,
      paymentStatus: (project.paymentStatus ?? "not_required") as PaymentStatus,
      paymentConfirmedByFounder: Boolean(project.paymentConfirmedByFounder),
      paymentConfirmedByAdvisor: Boolean(project.paymentConfirmedByAdvisor),
      conflictStatus: (project.conflictStatus ?? "clear") as ConflictStatus,
      conflictDecision: project.conflictDecision ?? "",
      conflictRationale: project.conflictRationale ?? "",
      physicalArchiveInstruction: project.physicalArchiveInstruction ?? "",
      redactionScope: project.redactionScope ?? "",
      restrictedMode: Boolean(project.restrictedMode),
    });
  }, [project]);

  const refreshProject = () => {
    if (id) queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(id) });
  };

  const handleSaveGovernance = () => {
    if (!id) return;
    updateProject.mutate(
      {
        id,
        data: {
          status: governance.status,
          slaClass: governance.slaClass,
          paymentStatus: governance.paymentStatus,
          paymentConfirmedByFounder: governance.paymentConfirmedByFounder,
          paymentConfirmedByAdvisor: governance.paymentConfirmedByAdvisor,
          conflictStatus: governance.conflictStatus,
          conflictDecision: governance.conflictDecision.trim() || null,
          conflictRationale: governance.conflictRationale.trim() || null,
          physicalArchiveInstruction: governance.physicalArchiveInstruction.trim() || null,
          redactionScope: governance.redactionScope.trim() || null,
          restrictedMode: governance.restrictedMode,
        },
      },
      {
        onSuccess: () => {
          refreshProject();
          toast({ title: "Governance controls updated" });
        },
        onError: (err) =>
          toast({
            variant: "destructive",
            title: "Update blocked",
            description: errorMessage(err, "The project transition or governance update was rejected."),
          }),
      },
    );
  };

  const handleCreateNotification = () => {
    createNotification.mutate(
      {
        template: notificationForm.template,
        channel: notificationForm.channel,
        recipient: notificationForm.recipient.trim() || undefined,
      },
      {
        onSuccess: () => {
          setNotificationForm({ ...notificationForm, recipient: "" });
          queryClient.invalidateQueries({ queryKey: ["project-notifications", id] });
          toast({ title: "Notification logged" });
        },
        onError: (err) =>
          toast({ variant: "destructive", title: "Notification failed", description: errorMessage(err, "") }),
      },
    );
  };

  const handleRetentionRequest = () => {
    createRetentionRequest.mutate(
      { reason: retentionReason.trim() || undefined },
      {
        onSuccess: () => {
          setRetentionReason("");
          toast({ title: "Retention request opened" });
        },
        onError: (err) =>
          toast({ variant: "destructive", title: "Retention request failed", description: errorMessage(err, "") }),
      },
    );
  };

  if (isLoading) {
    return (
      <div className="p-8 flex justify-center items-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!project || !id) {
    return (
      <div className="p-8 max-w-7xl mx-auto text-center">
        <h1 className="text-2xl font-serif text-destructive">Project not found</h1>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-[1600px] mx-auto w-full space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <Badge variant="outline" className="capitalize text-xs font-mono tracking-wider">
              {project.status.replace("_", " ")}
            </Badge>
            {project.riskBand && (
              <Badge variant={project.riskBand === 'critical' || project.riskBand === 'high' ? 'destructive' : 'secondary'} className="capitalize text-xs font-mono tracking-wider">
                {project.riskBand} Risk
              </Badge>
            )}
            {project.outcome && project.outcome !== 'none' && (
              <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 capitalize text-xs font-mono tracking-wider">
                {project.outcome.replace(/_/g, " ")}
              </Badge>
            )}
          </div>
          <h1 className="text-3xl font-serif tracking-tight font-semibold text-foreground">{project.tenderTitle}</h1>
          <p className="text-muted-foreground mt-1 text-sm flex items-center gap-2">
            <span className="font-medium text-foreground">{project.clientName}</span>
            {project.issuingEntity && (
              <>
                <span>&bull;</span>
                <span>{project.issuingEntity}</span>
              </>
            )}
            {project.tenderRef && (
              <>
                <span>&bull;</span>
                <span className="font-mono text-xs">{project.tenderRef}</span>
              </>
            )}
          </p>
        </div>
      </div>

      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="w-full justify-start border-b border-border rounded-none bg-transparent h-auto p-0 space-x-6 overflow-x-auto">
          <TabsTrigger value="overview" className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 py-3 font-medium">
            <Activity className="w-4 h-4 mr-2" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="documents" className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 py-3 font-medium">
            <FileText className="w-4 h-4 mr-2" />
            Documents
          </TabsTrigger>
          <TabsTrigger value="requirements" className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 py-3 font-medium">
            <CheckSquare className="w-4 h-4 mr-2" />
            Requirements
          </TabsTrigger>
          <TabsTrigger value="evidence" className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 py-3 font-medium">
            <Layers className="w-4 h-4 mr-2" />
            Evidence
          </TabsTrigger>
          <TabsTrigger value="boq" className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 py-3 font-medium">
            <Calculator className="w-4 h-4 mr-2" />
            BOQ Lite
          </TabsTrigger>
          <TabsTrigger value="defects" className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 py-3 font-medium">
            <AlertOctagon className="w-4 h-4 mr-2" />
            Defects
          </TabsTrigger>
          <TabsTrigger value="risk" className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 py-3 font-medium">
            <ShieldAlert className="w-4 h-4 mr-2" />
            Risk
          </TabsTrigger>
          <TabsTrigger value="reports" className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 py-3 font-medium">
            <FileBarChart className="w-4 h-4 mr-2" />
            Reports
          </TabsTrigger>
          <TabsTrigger value="audit" className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 py-3 font-medium">
            <History className="w-4 h-4 mr-2" />
            Audit
          </TabsTrigger>
        </TabsList>
        
        <div className="pt-6 pb-20">
          <TabsContent value="overview" className="m-0">
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
              <div className="bg-card border border-border p-6 rounded-xl shadow-xs">
                <h3 className="font-serif text-lg font-medium mb-4">Project Metadata</h3>
                <dl className="space-y-4 text-sm">
                  <div>
                    <dt className="text-muted-foreground uppercase text-[10px] tracking-wider font-mono">Reviewer</dt>
                    <dd className="mt-1">{project.reviewerName || "-"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground uppercase text-[10px] tracking-wider font-mono">Lot</dt>
                    <dd className="mt-1">{project.lot || "-"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground uppercase text-[10px] tracking-wider font-mono">Scope</dt>
                    <dd className="mt-1">{project.scope || "-"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground uppercase text-[10px] tracking-wider font-mono">Limitations</dt>
                    <dd className="mt-1">{project.limitations || "-"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground uppercase text-[10px] tracking-wider font-mono">Created</dt>
                    <dd className="mt-1">{new Date(project.createdAt).toLocaleString()}</dd>
                  </div>
                </dl>
              </div>
              <div className="bg-card border border-border p-6 rounded-xl shadow-xs xl:col-span-2 space-y-5">
                <div className="flex items-center justify-between">
                  <h3 className="font-serif text-lg font-medium">Governance & Gates</h3>
                  <Button size="sm" onClick={handleSaveGovernance} disabled={updateProject.isPending}>
                    {updateProject.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                    Save
                  </Button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label>Status</Label>
                    <Select value={governance.status} onValueChange={(status) => setGovernance({ ...governance, status: status as ProjectStatus })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {STATUS_OPTIONS.map((status) => (
                          <SelectItem key={status} value={status}>{status.replace(/_/g, " ")}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>SLA Class</Label>
                    <Select value={governance.slaClass} onValueChange={(slaClass) => setGovernance({ ...governance, slaClass: slaClass as SlaClass })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="standard">Standard</SelectItem>
                        <SelectItem value="live">Live tender</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Payment Gate</Label>
                    <Select value={governance.paymentStatus} onValueChange={(paymentStatus) => setGovernance({ ...governance, paymentStatus: paymentStatus as PaymentStatus })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="not_required">Not required</SelectItem>
                        <SelectItem value="pending">Pending</SelectItem>
                        <SelectItem value="confirmed">Confirmed</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <label className="flex items-center justify-between rounded-md border border-border p-3 text-sm">
                    <span>Founder confirmed</span>
                    <Switch
                      checked={governance.paymentConfirmedByFounder}
                      onCheckedChange={(paymentConfirmedByFounder) => setGovernance({ ...governance, paymentConfirmedByFounder })}
                    />
                  </label>
                  <label className="flex items-center justify-between rounded-md border border-border p-3 text-sm">
                    <span>Advisor confirmed</span>
                    <Switch
                      checked={governance.paymentConfirmedByAdvisor}
                      onCheckedChange={(paymentConfirmedByAdvisor) => setGovernance({ ...governance, paymentConfirmedByAdvisor })}
                    />
                  </label>
                  <label className="flex items-center justify-between rounded-md border border-border p-3 text-sm">
                    <span>Restricted mode</span>
                    <Switch
                      checked={governance.restrictedMode}
                      onCheckedChange={(restrictedMode) => setGovernance({ ...governance, restrictedMode })}
                    />
                  </label>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label>Conflict Status</Label>
                    <Select value={governance.conflictStatus} onValueChange={(conflictStatus) => setGovernance({ ...governance, conflictStatus: conflictStatus as ConflictStatus })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {CONFLICT_OPTIONS.map((status) => (
                          <SelectItem key={status} value={status}>{status}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label>Conflict Decision</Label>
                    <Input
                      value={governance.conflictDecision}
                      onChange={(e) => setGovernance({ ...governance, conflictDecision: e.target.value })}
                      placeholder="Consent, decline, or mitigation decision"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label>Conflict Rationale</Label>
                    <Textarea
                      value={governance.conflictRationale}
                      onChange={(e) => setGovernance({ ...governance, conflictRationale: e.target.value })}
                      className="min-h-[88px]"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Physical Archive</Label>
                    <Textarea
                      value={governance.physicalArchiveInstruction}
                      onChange={(e) => setGovernance({ ...governance, physicalArchiveInstruction: e.target.value })}
                      className="min-h-[88px]"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Redaction Scope</Label>
                    <Textarea
                      value={governance.redactionScope}
                      onChange={(e) => setGovernance({ ...governance, redactionScope: e.target.value })}
                      className="min-h-[88px]"
                    />
                  </div>
                </div>
              </div>
              <div className="bg-card border border-border p-6 rounded-xl shadow-xs space-y-4">
                <div className="flex items-center gap-2">
                  <Bell className="w-4 h-4 text-muted-foreground" />
                  <h3 className="font-serif text-lg font-medium">Notifications</h3>
                </div>
                <div className="space-y-3">
                  <Select value={notificationForm.template} onValueChange={(template) => setNotificationForm({ ...notificationForm, template })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="deadline_reminder">Deadline reminder</SelectItem>
                      <SelectItem value="payment_confirmation">Payment confirmation</SelectItem>
                      <SelectItem value="certificate_renewal">Certificate renewal</SelectItem>
                      <SelectItem value="report_ready">Report ready</SelectItem>
                    </SelectContent>
                  </Select>
                  <div className="grid grid-cols-2 gap-3">
                    <Select value={notificationForm.channel} onValueChange={(channel) => setNotificationForm({ ...notificationForm, channel })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="manual">Manual</SelectItem>
                        <SelectItem value="email">Email</SelectItem>
                        <SelectItem value="whatsapp">WhatsApp</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      value={notificationForm.recipient}
                      onChange={(e) => setNotificationForm({ ...notificationForm, recipient: e.target.value })}
                      placeholder="Recipient"
                    />
                  </div>
                  <Button variant="outline" className="w-full" onClick={handleCreateNotification} disabled={createNotification.isPending}>
                    {createNotification.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    Log Notification
                  </Button>
                </div>
                <div className="divide-y divide-border border border-border rounded-md">
                  {(notifications ?? []).slice(0, 4).map((event) => (
                    <div key={event.id} className="p-3 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{event.template.replace(/_/g, " ")}</span>
                        <Badge variant="outline" className="text-[10px]">{event.status}</Badge>
                      </div>
                      <p className="text-muted-foreground mt-1">{event.channel} {event.recipient ? `to ${event.recipient}` : ""}</p>
                    </div>
                  ))}
                  {(!notifications || notifications.length === 0) && (
                    <div className="p-3 text-xs text-muted-foreground">No notification events yet.</div>
                  )}
                </div>
              </div>
              <div className="bg-card border border-border p-6 rounded-xl shadow-xs space-y-4 xl:col-span-2">
                <div className="flex items-center gap-2">
                  <Archive className="w-4 h-4 text-muted-foreground" />
                  <h3 className="font-serif text-lg font-medium">Retention Request</h3>
                </div>
                <Textarea
                  value={retentionReason}
                  onChange={(e) => setRetentionReason(e.target.value)}
                  placeholder="Reason for deletion or retention workflow"
                  className="min-h-[88px]"
                />
                <Button variant="outline" onClick={handleRetentionRequest} disabled={createRetentionRequest.isPending}>
                  {createRetentionRequest.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Open Retention Workflow
                </Button>
              </div>
            </div>
          </TabsContent>
          <TabsContent value="documents" className="m-0">
             <DocumentsTab
               projectId={id}
               ndaStatus={project.ndaStatus}
               conflictStatus={project.conflictStatus}
               restrictedMode={project.restrictedMode}
             />
          </TabsContent>
          <TabsContent value="requirements" className="m-0">
             <RequirementsTab projectId={id} />
          </TabsContent>
          <TabsContent value="evidence" className="m-0">
             <EvidenceTab projectId={id} />
          </TabsContent>
          <TabsContent value="boq" className="m-0">
             <BoqTab projectId={id} />
          </TabsContent>
          <TabsContent value="defects" className="m-0">
             <DefectsTab projectId={id} />
          </TabsContent>
          <TabsContent value="risk" className="m-0">
             <RiskTab projectId={id} />
          </TabsContent>
          <TabsContent value="reports" className="m-0">
             <ReportsTab projectId={id} />
          </TabsContent>
          <TabsContent value="audit" className="m-0">
             <AuditTab projectId={id} />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
