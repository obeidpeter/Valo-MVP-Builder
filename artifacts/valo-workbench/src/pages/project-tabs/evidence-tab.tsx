import { 
  useListEvidence, 
  useMapEvidence,
  getListEvidenceQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Zap, Layers } from "lucide-react";

export function EvidenceTab({ projectId }: { projectId: string }) {
  const { data: evidence, isLoading } = useListEvidence(projectId);
  const mapEvidence = useMapEvidence();
  const queryClient = useQueryClient();

  const handleMap = () => {
    mapEvidence.mutate({ id: projectId }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListEvidenceQueryKey(projectId) })
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-serif font-medium">Evidence Map</h2>
        <Button onClick={handleMap} disabled={mapEvidence.isPending} variant="secondary">
          {mapEvidence.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Zap className="w-4 h-4 mr-2" />}
          Auto-Map Evidence
        </Button>
      </div>

      <div className="bg-card border border-border rounded-lg shadow-xs overflow-hidden">
        {isLoading ? (
          <div className="p-8 flex justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : evidence && evidence.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead>Requirement</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Document</TableHead>
                <TableHead>Excerpt</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {evidence.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="max-w-[300px]">
                    <p className="text-sm font-medium truncate">{item.requirementText}</p>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`capitalize text-[10px] ${
                      item.evidenceStatus === 'present' ? 'text-emerald-600 border-emerald-200 bg-emerald-50' :
                      item.evidenceStatus === 'missing' ? 'text-destructive border-destructive/20 bg-destructive/10' :
                      'text-amber-600 border-amber-200 bg-amber-50'
                    }`}>
                      {item.evidenceStatus.replace('_', ' ')}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {item.documentName || "—"}
                  </TableCell>
                  <TableCell className="text-sm">
                    {item.excerpt ? (
                      <p className="line-clamp-2 text-muted-foreground italic text-xs border-l-2 pl-2">"{item.excerpt}"</p>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="p-12 text-center text-muted-foreground">
            <Layers className="w-12 h-12 mx-auto mb-3 text-muted" />
            <p>No evidence mapped yet.</p>
          </div>
        )}
      </div>
    </div>
  );
}