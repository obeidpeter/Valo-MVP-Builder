import { 
  useListRequirements, 
  useExtractRequirements,
  getListRequirementsQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Zap, CheckSquare } from "lucide-react";

export function RequirementsTab({ projectId }: { projectId: string }) {
  const { data: requirements, isLoading } = useListRequirements(projectId);
  const extractReqs = useExtractRequirements();
  const queryClient = useQueryClient();

  const handleExtract = () => {
    extractReqs.mutate({ id: projectId }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListRequirementsQueryKey(projectId) })
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-serif font-medium">Requirement Matrix</h2>
        <Button onClick={handleExtract} disabled={extractReqs.isPending} variant="secondary">
          {extractReqs.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Zap className="w-4 h-4 mr-2" />}
          AI Extraction
        </Button>
      </div>

      <div className="bg-card border border-border rounded-lg shadow-xs overflow-hidden">
        {isLoading ? (
          <div className="p-8 flex justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : requirements && requirements.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead className="w-[100px]">Status</TableHead>
                <TableHead>Requirement</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Confidence</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requirements.map((req) => (
                <TableRow key={req.id}>
                  <TableCell>
                    <Badge variant={req.reviewStatus === 'suggested' ? 'outline' : 'default'} className="capitalize text-[10px]">
                      {req.reviewStatus}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <p className="text-sm font-medium leading-relaxed">{req.text}</p>
                    {(req.pageRef || req.clauseRef) && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Ref: {[req.pageRef, req.clauseRef].filter(Boolean).join(", ")}
                      </p>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="capitalize text-[10px]">{req.category.replace('_', ' ')}</Badge>
                  </TableCell>
                  <TableCell>
                    {req.confidence && (
                      <Badge variant="outline" className={`capitalize text-[10px] ${
                        req.confidence === 'high' ? 'text-emerald-600 border-emerald-200 bg-emerald-50' :
                        req.confidence === 'medium' ? 'text-amber-600 border-amber-200 bg-amber-50' :
                        'text-destructive border-destructive/20 bg-destructive/10'
                      }`}>
                        {req.confidence}
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="p-12 text-center text-muted-foreground">
            <CheckSquare className="w-12 h-12 mx-auto mb-3 text-muted" />
            <p>No requirements extracted yet.</p>
            <Button variant="outline" className="mt-4" onClick={handleExtract} disabled={extractReqs.isPending}>
              Run AI Extraction
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}