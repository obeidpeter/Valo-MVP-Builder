import { useParams } from "wouter";
import { 
  useGetProject, 
  useUpdateProject,
  getGetProjectQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Briefcase, FileText, CheckSquare, Layers, AlertOctagon, FileBarChart, History, Activity, Calculator, ShieldAlert } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";

import { DocumentsTab } from "./project-tabs/documents-tab";
import { RequirementsTab } from "./project-tabs/requirements-tab";
import { EvidenceTab } from "./project-tabs/evidence-tab";
import { DefectsTab } from "./project-tabs/defects-tab";
import { ReportsTab } from "./project-tabs/reports-tab";
import { BoqTab } from "./project-tabs/boq-tab";
import { RiskTab } from "./project-tabs/risk-tab";
import { AuditTab } from "./project-tabs/audit-tab";

export default function ProjectDetails() {
  const { id } = useParams<{ id: string }>();
  const { data: project, isLoading } = useGetProject(id);

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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-card border border-border p-6 rounded-xl shadow-xs">
                <h3 className="font-serif text-lg font-medium mb-4">Project Metadata</h3>
                <dl className="space-y-4 text-sm">
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
            </div>
          </TabsContent>
          <TabsContent value="documents" className="m-0">
             <DocumentsTab projectId={id} />
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