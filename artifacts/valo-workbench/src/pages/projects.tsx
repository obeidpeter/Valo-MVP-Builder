import { useListProjects, useCreateProject, getListProjectsQueryKey, useListClients } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Link, useLocation } from "wouter";
import { Loader2, Plus, Briefcase, ChevronRight, AlertTriangle } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

const createProjectSchema = z.object({
  clientId: z.string().min(1, "Client is required"),
  tenderTitle: z.string().min(1, "Tender Title is required"),
  issuingEntity: z.string().optional(),
  tenderRef: z.string().optional(),
  segment: z.enum(["federal", "nipex_ncdmb", "donor", "other"]).optional(),
});

type CreateProjectForm = z.infer<typeof createProjectSchema>;

export default function Projects() {
  const [location] = useLocation();
  const searchParams = new URLSearchParams(window.location.search);
  const defaultClientId = searchParams.get("clientId") || "";

  const { data: projects, isLoading: loadingProjects } = useListProjects();
  const { data: clients, isLoading: loadingClients } = useListClients();
  const createProject = useCreateProject();
  const queryClient = useQueryClient();
  const [isCreateOpen, setIsCreateOpen] = useState(defaultClientId !== "");

  const form = useForm<CreateProjectForm>({
    resolver: zodResolver(createProjectSchema),
    defaultValues: {
      clientId: defaultClientId,
      tenderTitle: "",
      issuingEntity: "",
      tenderRef: "",
      segment: "other",
    },
  });

  useEffect(() => {
    if (defaultClientId) {
      form.setValue("clientId", defaultClientId);
    }
  }, [defaultClientId, form]);

  const onSubmit = (data: CreateProjectForm) => {
    createProject.mutate({ data }, {
      onSuccess: (newProject) => {
        setIsCreateOpen(false);
        form.reset();
        queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
        // Can't easily navigate directly in wouter here without a hook, 
        // but user will see it in the list. Let's redirect using window for simplicity in this case
        window.location.href = `/projects/${newProject.id}`;
      }
    });
  };

  return (
    <div className="p-8 max-w-7xl mx-auto w-full space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-serif tracking-tight font-semibold">Tender Projects</h1>
          <p className="text-muted-foreground mt-1">Manage active autopsy workflows and historic bids.</p>
        </div>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button className="bg-primary text-primary-foreground">
              <Plus className="w-4 h-4 mr-2" />
              New Project
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>Create New Project</DialogTitle>
              <DialogDescription>
                Start a new forensic review for a tender/bid pair.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label htmlFor="clientId">Client</Label>
                <Select 
                  onValueChange={(val) => form.setValue("clientId", val)} 
                  defaultValue={form.getValues("clientId")}
                  disabled={loadingClients}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select client" />
                  </SelectTrigger>
                  <SelectContent>
                    {clients?.map(client => (
                      <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {form.formState.errors.clientId && (
                  <p className="text-xs text-destructive">{form.formState.errors.clientId.message}</p>
                )}
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="tenderTitle">Tender Title</Label>
                <Input id="tenderTitle" {...form.register("tenderTitle")} />
                {form.formState.errors.tenderTitle && (
                  <p className="text-xs text-destructive">{form.formState.errors.tenderTitle.message}</p>
                )}
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="issuingEntity">Issuing Entity</Label>
                  <Input id="issuingEntity" {...form.register("issuingEntity")} placeholder="e.g. NNPC" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tenderRef">Tender Ref</Label>
                  <Input id="tenderRef" {...form.register("tenderRef")} />
                </div>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="segment">Segment</Label>
                <Select 
                  onValueChange={(val) => form.setValue("segment", val as any)} 
                  defaultValue={form.getValues("segment")}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select segment" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="federal">Federal</SelectItem>
                    <SelectItem value="nipex_ncdmb">NIPEX / NCDMB</SelectItem>
                    <SelectItem value="donor">Donor</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex justify-end pt-4">
                <Button type="submit" disabled={createProject.isPending}>
                  {createProject.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                  Create Project
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="bg-card border border-border rounded-lg shadow-xs overflow-hidden">
        {loadingProjects ? (
          <div className="p-12 flex justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : projects && projects.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead>Tender</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Risk</TableHead>
                <TableHead className="text-right">Metrics</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.map((project) => (
                <TableRow key={project.id} className="group cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => window.location.href = `/projects/${project.id}`}>
                  <TableCell>
                    <div className="font-medium text-foreground group-hover:text-primary transition-colors">{project.tenderTitle}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {project.issuingEntity || 'Unknown entity'}
                      {project.deadline && ` • Due ${new Date(project.deadline).toLocaleDateString()}`}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">{project.clientName}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="capitalize">
                      {project.status.replace('_', ' ')}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {project.riskBand === 'critical' || project.riskBand === 'high' ? (
                      <div className="flex items-center text-destructive text-sm font-medium">
                        <AlertTriangle className="w-3.5 h-3.5 mr-1" />
                        <span className="capitalize">{project.riskBand}</span>
                      </div>
                    ) : project.riskBand === 'medium' ? (
                      <span className="text-amber-600 text-sm font-medium capitalize">{project.riskBand}</span>
                    ) : (
                      <span className="text-emerald-600 text-sm font-medium capitalize">{project.riskBand || 'Unknown'}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-3 text-xs text-muted-foreground">
                      <div className="flex flex-col items-end">
                        <span className="font-mono text-foreground font-medium">{project.requirementCount ?? 0}</span>
                        <span className="uppercase tracking-wider text-[9px]">Reqs</span>
                      </div>
                      <div className="flex flex-col items-end">
                        <span className="font-mono text-foreground font-medium">{project.defectCount ?? 0}</span>
                        <span className="uppercase tracking-wider text-[9px]">Defects</span>
                      </div>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="p-12 text-center text-muted-foreground bg-card">
            <Briefcase className="w-12 h-12 mx-auto mb-3 text-muted" />
            <p>No projects found.</p>
            <p className="text-sm mt-1">Create a new project to start a forensic review.</p>
          </div>
        )}
      </div>
    </div>
  );
}