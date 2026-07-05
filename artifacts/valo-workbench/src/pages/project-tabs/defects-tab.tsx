import { 
  useListDefects, 
  useSuggestDefects,
  getListDefectsQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Zap, AlertOctagon } from "lucide-react";

export function DefectsTab({ projectId }: { projectId: string }) {
  const { data: defects, isLoading } = useListDefects(projectId);
  const suggestDefects = useSuggestDefects();
  const queryClient = useQueryClient();

  const handleSuggest = () => {
    suggestDefects.mutate({ id: projectId }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListDefectsQueryKey(projectId) })
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-serif font-medium">Defect Register</h2>
        <Button onClick={handleSuggest} disabled={suggestDefects.isPending} variant="secondary">
          {suggestDefects.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Zap className="w-4 h-4 mr-2" />}
          Suggest Defects
        </Button>
      </div>

      <div className="bg-card border border-border rounded-lg shadow-xs overflow-hidden">
        {isLoading ? (
          <div className="p-8 flex justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : defects && defects.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead>Status</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Description</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {defects.map((defect) => (
                <TableRow key={defect.id}>
                  <TableCell>
                    <Badge variant="outline" className="capitalize text-[10px]">
                      {defect.status}
                    </Badge>
                    {defect.suggested && (
                      <span className="ml-2 text-[10px] text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded uppercase tracking-wider font-mono">Suggested</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={defect.severity === 'fatal' || defect.severity === 'likely_fatal' ? 'destructive' : 'secondary'} className="capitalize text-[10px]">
                      {defect.severity.replace('_', ' ')}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground capitalize">
                    {defect.type.replace('_', ' ')}
                  </TableCell>
                  <TableCell>
                    <p className="text-sm font-medium">{defect.description}</p>
                    {defect.remediation && (
                      <p className="text-xs text-muted-foreground mt-1"><span className="font-semibold text-foreground">Remediation:</span> {defect.remediation}</p>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="p-12 text-center text-muted-foreground">
            <AlertOctagon className="w-12 h-12 mx-auto mb-3 text-muted" />
            <p>No defects identified.</p>
          </div>
        )}
      </div>
    </div>
  );
}