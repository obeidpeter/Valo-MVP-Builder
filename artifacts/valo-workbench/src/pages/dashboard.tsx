import { useGetDashboardMetrics, useListProjects } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { ArrowRight, Loader2, AlertTriangle, FileText, CheckCircle2 } from "lucide-react";
import { format } from "date-fns";

export default function Dashboard() {
  const { data: metrics, isLoading: loadingMetrics } = useGetDashboardMetrics();
  const { data: projects, isLoading: loadingProjects } = useListProjects();

  if (loadingMetrics || loadingProjects) {
    return (
      <div className="p-8 flex justify-center items-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-8 max-w-7xl mx-auto w-full space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-serif tracking-tight font-semibold">Portfolio Overview</h1>
          <p className="text-muted-foreground mt-1">Valo operations summary and key performance indicators.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="shadow-xs border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-widest font-mono">Active Projects</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">{metrics?.openProjects ?? 0}</div>
            <p className="text-xs text-muted-foreground mt-1">Out of {metrics?.totalProjects ?? 0} total intake</p>
          </CardContent>
        </Card>

        <Card className="shadow-xs border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-widest font-mono">Material Defect Rate</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">
              {metrics?.materialDefectRate !== undefined ? `${(metrics.materialDefectRate * 100).toFixed(1)}%` : "0%"}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Bids with fatal or likely fatal risks</p>
          </CardContent>
        </Card>

        <Card className="shadow-xs border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-widest font-mono">Packages Shared</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">{metrics?.packagesShared ?? 0}</div>
            <p className="text-xs text-muted-foreground mt-1">Docx reports exported & signed off</p>
          </CardContent>
        </Card>

        <Card className="shadow-xs border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-widest font-mono">Paid Mandates</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold text-emerald-600">{metrics?.paidMandates ?? 0}</div>
            <p className="text-xs text-muted-foreground mt-1">Converted from autopsy or retainer</p>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-serif tracking-tight font-medium">Recent Active Projects</h2>
          <Link href="/projects">
            <div className="text-sm text-primary hover:underline cursor-pointer flex items-center gap-1 font-medium">
              View all <ArrowRight className="w-4 h-4" />
            </div>
          </Link>
        </div>

        <div className="bg-card border border-border rounded-lg shadow-xs overflow-hidden">
          {projects && projects.length > 0 ? (
            <div className="divide-y divide-border">
              {projects.map(project => (
                <Link key={project.id} href={`/projects/${project.id}`}>
                  <div className="p-4 hover:bg-muted/50 transition-colors cursor-pointer group flex items-center justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-3">
                        <span className="font-semibold text-foreground group-hover:text-primary transition-colors">{project.tenderTitle}</span>
                        {project.riskBand === 'critical' || project.riskBand === 'high' ? (
                          <Badge variant="destructive" className="uppercase text-[10px] tracking-wider py-0 leading-tight">High Risk</Badge>
                        ) : project.riskBand === 'medium' ? (
                          <Badge variant="secondary" className="uppercase text-[10px] tracking-wider py-0 leading-tight text-amber-600 bg-amber-100 border-amber-200">Medium Risk</Badge>
                        ) : project.riskBand === 'low' ? (
                          <Badge variant="outline" className="uppercase text-[10px] tracking-wider py-0 leading-tight text-emerald-600 border-emerald-200 bg-emerald-50">Low Risk</Badge>
                        ) : null}
                      </div>
                      <div className="text-sm text-muted-foreground flex items-center gap-2">
                        <span>{project.clientName}</span>
                        <span>&bull;</span>
                        <span className="capitalize">{project.status.replace("_", " ")}</span>
                        {project.deadline && (
                          <>
                            <span>&bull;</span>
                            <span>Due {format(new Date(project.deadline), 'MMM d, yyyy')}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-6">
                      <div className="flex gap-4 text-xs text-muted-foreground text-right">
                        <div className="flex flex-col items-end">
                          <span className="font-mono">{project.requirementCount ?? 0}</span>
                          <span className="uppercase tracking-wider text-[9px]">Reqs</span>
                        </div>
                        <div className="flex flex-col items-end">
                          <span className="font-mono">{project.defectCount ?? 0}</span>
                          <span className="uppercase tracking-wider text-[9px]">Defects</span>
                        </div>
                      </div>
                      <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-transform group-hover:translate-x-1" />
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="p-8 text-center text-muted-foreground flex flex-col items-center">
              <FileText className="w-12 h-12 mb-3 text-muted" />
              <p>No active projects found.</p>
              <Link href="/projects/new">
                <div className="mt-4 text-primary hover:underline cursor-pointer text-sm font-medium">Create a project</div>
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}