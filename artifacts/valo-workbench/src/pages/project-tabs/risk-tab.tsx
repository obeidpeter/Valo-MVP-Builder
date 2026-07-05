import { 
  useGetRisk, 
  useOverrideRisk,
  useGetMe,
  getGetRiskQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, ShieldAlert, Target } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useState } from "react";
import { RiskOverrideBand } from "@workspace/api-client-react";

export function RiskTab({ projectId }: { projectId: string }) {
  const { data: risk, isLoading } = useGetRisk(projectId);
  const { data: user } = useGetMe();
  const overrideRisk = useOverrideRisk();
  const queryClient = useQueryClient();

  const [band, setBand] = useState<RiskOverrideBand | "none">("none");
  const [note, setNote] = useState("");

  const handleOverride = () => {
    if (band === "none") return;
    // The server derives the reviewer identity from the authenticated user and
    // ignores this value; we send the current user's name only to satisfy the
    // request schema.
    const reviewerName = user?.name || user?.email || "";
    overrideRisk.mutate({ id: projectId, data: { band, note, reviewerName } }, {
      onSuccess: () => {
        setBand("none");
        setNote("");
        queryClient.invalidateQueries({ queryKey: getGetRiskQueryKey(projectId) });
      }
    });
  };

  if (isLoading) {
    return (
      <div className="p-8 flex justify-center items-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!risk) {
    return <div className="p-8 text-center text-muted-foreground">Risk data unavailable.</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-serif font-medium">Disqualification Risk</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-card border border-border p-6 rounded-xl shadow-xs space-y-4">
          <div className="flex items-center gap-3">
            <ShieldAlert className={`w-8 h-8 ${
              risk.computedBand === 'critical' ? 'text-red-500' :
              risk.computedBand === 'high' ? 'text-orange-500' :
              risk.computedBand === 'medium' ? 'text-amber-500' :
              'text-emerald-500'
            }`} />
            <div>
              <h3 className="font-serif text-lg">Computed Risk: <span className="capitalize">{risk.computedBand}</span></h3>
              <p className="text-3xl font-bold font-mono tracking-tighter">{risk.score}<span className="text-lg text-muted-foreground font-sans">/100</span></p>
            </div>
          </div>
          
          {risk.overrideBand && (
            <div className="bg-muted p-4 rounded-md border border-border mt-4">
              <div className="flex items-center justify-between mb-2">
                <Badge variant="outline" className="border-primary/50 text-primary">Override Active</Badge>
                <span className="text-xs text-muted-foreground capitalize font-mono">Set to: {risk.overrideBand}</span>
              </div>
              <p className="text-sm italic text-muted-foreground">"{risk.overrideNote}"</p>
              {risk.overrideBy && (
                <p className="text-xs text-muted-foreground mt-2">— {risk.overrideBy}</p>
              )}
            </div>
          )}
        </div>

        <div className="bg-card border border-border p-6 rounded-xl shadow-xs space-y-4">
          <h3 className="font-medium flex items-center gap-2">
            <Target className="w-4 h-4 text-muted-foreground" />
            Override Computed Risk
          </h3>
          <p className="text-xs text-muted-foreground">Reviewers can override the AI-computed risk score based on professional judgment.</p>
          
          <div className="space-y-3">
            <Select value={band} onValueChange={(val: any) => setBand(val)}>
              <SelectTrigger>
                <SelectValue placeholder="Select override band..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No Override</SelectItem>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
              </SelectContent>
            </Select>
            <Textarea 
              placeholder="Justification for override..." 
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="text-sm"
              disabled={band === "none"}
            />
            <Button onClick={handleOverride} disabled={band === "none" || !note || overrideRisk.isPending} className="w-full">
              {overrideRisk.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Apply Override
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}