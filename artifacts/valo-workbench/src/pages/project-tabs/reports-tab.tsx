import {
  useListReports,
  useGenerateReport,
  useSignOffReport,
  exportProject,
  getListReportsQueryKey,
  getGetProjectQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, FileBarChart, Download, FileSignature } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";

/** Pull the server's human-readable error message off a failed mutation. */
function errorMessage(err: unknown, fallback: string): string {
  const data = (err as { data?: unknown })?.data;
  const serverError =
    data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string"
      ? (data as { error: string }).error
      : undefined;
  return serverError ?? (err instanceof Error ? err.message : fallback);
}

export function ReportsTab({ projectId }: { projectId: string }) {
  const { data: reports, isLoading } = useListReports(projectId);
  const generateReport = useGenerateReport();
  const signOffReport = useSignOffReport();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [exporting, setExporting] = useState(false);

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: getListReportsQueryKey(projectId) });
    // The project header badge reflects status (reporting -> signed_off), so
    // refresh the project too after generate/sign-off flips it.
    queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(projectId) });
  };

  const handleGenerate = () => {
    generateReport.mutate({ id: projectId }, {
      onSuccess: invalidateAll,
      onError: (err) =>
        toast({ variant: "destructive", title: "Report generation failed", description: errorMessage(err, "") }),
    });
  };

  const handleSignOff = (id: string) => {
    signOffReport.mutate(
      {
        id,
        data: {
          attestation:
            "I have reviewed the findings in this report and confirm them as the responsible reviewer.",
        },
      },
      {
        onSuccess: invalidateAll,
        onError: (err) =>
          toast({
            variant: "destructive",
            title: "Sign-off blocked",
            description: errorMessage(
              err,
              "The report could not be signed off. Resolve any open fatal defects and try again.",
            ),
          }),
      },
    );
  };

  const handleDownload = (id: string) => {
    window.location.href = `/api/reports/${id}/download`;
  };

  const handleProjectExport = async () => {
    setExporting(true);
    try {
      const blob = await exportProject(projectId);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `project-${projectId}-export.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Project export blocked",
        description: errorMessage(err, "Confirm physical archive instructions before exporting a signed-off project."),
      });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-serif font-medium">Export & Reporting</h2>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleProjectExport} disabled={exporting}>
            {exporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
            Export ZIP
          </Button>
          <Button onClick={handleGenerate} disabled={generateReport.isPending}>
            {generateReport.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FileBarChart className="w-4 h-4 mr-2" />}
            Generate Report
          </Button>
        </div>
      </div>

      <div className="bg-card border border-border rounded-lg shadow-xs overflow-hidden">
        {isLoading ? (
          <div className="p-8 flex justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : reports && reports.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead>Version</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Reviewer</TableHead>
                <TableHead>Generated At</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reports.map((report) => (
                <TableRow key={report.id}>
                  <TableCell className="font-medium font-mono text-sm">v{report.version}</TableCell>
                  <TableCell>
                    <Badge variant={report.status === 'signed_off' ? 'default' : 'secondary'} className="capitalize text-[10px]">
                      {report.status.replace('_', ' ')}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">
                    {report.status === 'signed_off' && report.reviewerName ? (
                      <span className="text-foreground">{report.reviewerName}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(report.createdAt).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      {report.status === 'draft' && (
                        <Button variant="outline" size="sm" onClick={() => handleSignOff(report.id)} disabled={signOffReport.isPending}>
                          <FileSignature className="w-4 h-4 mr-2" />
                          Sign Off
                        </Button>
                      )}
                      {report.status === 'signed_off' && (
                        <Button variant="default" size="sm" onClick={() => handleDownload(report.id)}>
                          <Download className="w-4 h-4 mr-2" />
                          Download DOCX
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="p-12 text-center text-muted-foreground">
            <FileBarChart className="w-12 h-12 mx-auto mb-3 text-muted" />
            <p>No reports generated yet.</p>
          </div>
        )}
      </div>
    </div>
  );
}
