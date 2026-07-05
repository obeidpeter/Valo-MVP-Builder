import { 
  useListBoqChecks, 
  useRunBoqChecks,
  useBoqCheckToDefect,
  getListBoqChecksQueryKey,
  getListDefectsQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Calculator, AlertTriangle, Plus } from "lucide-react";
import { useState } from "react";

export function BoqTab({ projectId }: { projectId: string }) {
  const { data: checks, isLoading } = useListBoqChecks(projectId);
  const runChecks = useRunBoqChecks();
  const toDefect = useBoqCheckToDefect();
  const queryClient = useQueryClient();
  const [csvData, setCsvData] = useState("");

  const handleRunChecks = () => {
    // Basic CSV parser for pasted data
    const rows = csvData.split('\n').filter(r => r.trim()).map(r => {
      const parts = r.split('\t'); // assuming paste from excel (tab separated)
      return {
        lineRef: parts[0] || "",
        description: parts[1] || "",
        quantity: parseFloat(parts[2]) || 0,
        unitRate: parseFloat(parts[3]) || 0,
        extension: parseFloat(parts[4]) || 0
      };
    });

    if (rows.length === 0) return;

    runChecks.mutate({ id: projectId, data: { rows } }, {
      onSuccess: () => {
        setCsvData("");
        queryClient.invalidateQueries({ queryKey: getListBoqChecksQueryKey(projectId) });
      }
    });
  };

  const handleToDefect = (id: string) => {
    toDefect.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListBoqChecksQueryKey(projectId) });
        queryClient.invalidateQueries({ queryKey: getListDefectsQueryKey(projectId) });
      }
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-serif font-medium">BOQ Lite Checker</h2>
      </div>

      <div className="bg-card border border-border p-4 rounded-lg shadow-xs space-y-4">
        <h3 className="text-sm font-medium">Paste BOQ Data (Excel/Sheets)</h3>
        <p className="text-xs text-muted-foreground">Format: Item Ref | Description | Quantity | Unit Rate | Amount</p>
        <Textarea 
          placeholder="Paste columns from Excel..." 
          className="min-h-[120px] font-mono text-sm"
          value={csvData}
          onChange={(e) => setCsvData(e.target.value)}
        />
        <Button onClick={handleRunChecks} disabled={runChecks.isPending || !csvData.trim()}>
          {runChecks.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Calculator className="w-4 h-4 mr-2" />}
          Run Arithmetic Checks
        </Button>
      </div>

      <div className="bg-card border border-border rounded-lg shadow-xs overflow-hidden">
        {isLoading ? (
          <div className="p-8 flex justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : checks && checks.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead>Status</TableHead>
                <TableHead>Item</TableHead>
                <TableHead>Details</TableHead>
                <TableHead className="text-right">Variance</TableHead>
                <TableHead className="w-[120px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {checks.map((check) => {
                const variance =
                  typeof check.extension === "number" && typeof check.computedExtension === "number"
                    ? check.extension - check.computedExtension
                    : null;
                return (
                <TableRow key={check.id}>
                  <TableCell>
                    <Badge variant={check.severity === 'fatal' || check.severity === 'likely_fatal' ? 'destructive' : check.status === 'pushed_to_defect' ? 'secondary' : 'outline'} className="capitalize text-[10px]">
                      {check.status.replace(/_/g, ' ')}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="font-mono text-xs">{check.lineRef}</div>
                  </TableCell>
                  <TableCell>
                    <p className="text-sm font-medium">{check.finding}</p>
                    <p className="text-xs text-muted-foreground mt-1 capitalize">{check.checkType.replace(/_/g, ' ')}</p>
                  </TableCell>
                  <TableCell className="text-right">
                    {variance ? (
                      <span className="text-sm font-mono font-medium text-destructive">
                        {variance > 0 ? '+' : ''}{variance.toLocaleString()}
                      </span>
                    ) : "-"}
                  </TableCell>
                  <TableCell className="text-right">
                    {check.status === 'flagged' && (
                      <Button variant="outline" size="sm" onClick={() => handleToDefect(check.id)} disabled={toDefect.isPending}>
                        <Plus className="w-3 h-3 mr-1" /> Defect
                      </Button>
                    )}
                    {check.status === 'pushed_to_defect' && (
                      <Badge variant="outline" className="text-blue-600 border-blue-200 bg-blue-50">Defect Logged</Badge>
                    )}
                  </TableCell>
                </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : (
          <div className="p-12 text-center text-muted-foreground">
            <Calculator className="w-12 h-12 mx-auto mb-3 text-muted" />
            <p>No BOQ checks run yet.</p>
          </div>
        )}
      </div>
    </div>
  );
}