import { useEffect, useState } from "react";
import {
  useListUsers,
  useListRetentionRequests,
  useGetAppConfig,
  useUpdateAppConfig,
  getGetAppConfigQueryKey,
} from "@workspace/api-client-react";
import type { AppConfig, AppConfigUpdate } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  CheckCircle2,
  Loader2,
  Shield,
  Info,
  SlidersHorizontal,
  FileText,
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DataErrorPanel } from "@/components/platform-states";
import { useToast } from "@/hooks/use-toast";
import { mutationErrorToast } from "@/lib/errors";

export default function Settings() {
  const {
    data: users,
    isLoading: loadingUsers,
    isPending: usersPending,
    isError: usersFailed,
    refetch: refetchUsers,
  } = useListUsers();
  const {
    data: retentionRequests,
    isLoading: loadingRetention,
    isPending: retentionPending,
    isError: retentionFailed,
    refetch: refetchRetention,
  } = useListRetentionRequests();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const {
    data: config,
    isLoading: loadingConfig,
    isPending: configPending,
    isError: configFailed,
    refetch: refetchConfig,
  } = useGetAppConfig();
  const updateConfig = useUpdateAppConfig();
  const [draft, setDraft] = useState<AppConfig | null>(null);

  // Seed the editable draft once the active config lands, then let the admin
  // mutate it locally until they save.
  useEffect(() => {
    if (config) setDraft(config);
  }, [config]);

  const setWeight = (key: keyof AppConfig["severityWeights"], value: number) =>
    setDraft((d) =>
      d ? { ...d, severityWeights: { ...d.severityWeights, [key]: value } } : d,
    );
  const setCutoff = (key: keyof AppConfig["bandCutoffs"], value: number) =>
    setDraft((d) =>
      d ? { ...d, bandCutoffs: { ...d.bandCutoffs, [key]: value } } : d,
    );

  const cutoffsValid = (d: AppConfig) =>
    d.bandCutoffs.medium > 0 &&
    d.bandCutoffs.medium < d.bandCutoffs.high &&
    d.bandCutoffs.high < d.bandCutoffs.critical &&
    d.bandCutoffs.critical <= 100;

  const numericConfigValid = (d: AppConfig) => {
    const boundedIntegers: Array<[number, number, number]> = [
      [d.severityWeights.fatal, 0, 100],
      [d.severityWeights.likely_fatal, 0, 100],
      [d.severityWeights.scoring_risk, 0, 100],
      [d.severityWeights.cosmetic, 0, 100],
      [d.missingEvidenceWeight, 0, 100],
      [d.bandCutoffs.medium, 1, 100],
      [d.bandCutoffs.high, 1, 100],
      [d.bandCutoffs.critical, 1, 100],
      [d.retentionDefaultDays, 1, 3650],
    ];
    return boundedIntegers.every(
      ([value, minimum, maximum]) =>
        Number.isInteger(value) && value >= minimum && value <= maximum,
    );
  };

  const saveConfig = () => {
    if (!draft) return;
    if (!numericConfigValid(draft)) {
      toast({
        variant: "destructive",
        title: "Invalid numeric configuration",
        description:
          "Weights and cutoffs must be whole numbers in range; retention must be a whole number from 1 to 3650 days.",
      });
      return;
    }
    if (!cutoffsValid(draft)) {
      toast({
        variant: "destructive",
        title: "Invalid band cutoffs",
        description: "Cutoffs must satisfy 0 < medium < high < critical ≤ 100.",
      });
      return;
    }
    if (!draft.firmName.trim() || !draft.confidentialityLegend.trim()) {
      toast({
        variant: "destructive",
        title: "Missing report details",
        description: "Firm name and confidentiality legend are required.",
      });
      return;
    }
    const body: AppConfigUpdate = {
      severityWeights: draft.severityWeights,
      missingEvidenceWeight: draft.missingEvidenceWeight,
      bandCutoffs: draft.bandCutoffs,
      firmName: draft.firmName.trim(),
      confidentialityLegend: draft.confidentialityLegend.trim(),
      retentionDefaultDays: draft.retentionDefaultDays,
    };
    updateConfig.mutate(
      { data: body },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({
            queryKey: getGetAppConfigQueryKey(),
          });
          toast({
            title: "Configuration saved",
            description:
              "New scores use the updated settings. Historic reports are unchanged.",
          });
        },
        onError: mutationErrorToast(
          toast,
          "Could not save configuration",
          "The update was refused.",
        ),
      },
    );
  };

  const configLoading = loadingConfig || configPending;
  const configUnavailable = configFailed || (!configLoading && !config);

  return (
    <div className="p-8 max-w-5xl mx-auto w-full space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-3xl font-serif tracking-tight font-semibold">
          System Settings
        </h1>
        <p className="text-muted-foreground mt-1">
          Review personnel access and manage supported system configuration.
        </p>
      </div>

      <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900 rounded-lg p-4 flex gap-3">
        <Info className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <h3 className="font-medium text-blue-900 dark:text-blue-300">
            Data Retention & Security
          </h3>
          <p className="text-sm text-blue-800 dark:text-blue-400/80 leading-relaxed">
            All tender documents and extracted evidence are stored in encrypted
            GCS buckets. API keys for OpenAI and other services are managed
            securely via environment secrets. Do not share the publishable key
            or environment endpoints publicly.
          </p>
        </div>
      </div>

      {configUnavailable ? (
        <DataErrorPanel
          title="Configuration could not be loaded"
          description="Scoring, report and retention defaults remain unavailable. Retry before reviewing or changing configuration."
          onRetry={() => void refetchConfig()}
        />
      ) : null}

      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="w-5 h-5 text-foreground" />
          <h2 className="text-xl font-serif tracking-tight font-medium">
            Scoring &amp; Risk Bands
          </h2>
        </div>

        <div className="bg-card border border-border rounded-lg shadow-xs p-6 space-y-6">
          {configUnavailable ? (
            <p className="p-6 text-sm text-muted-foreground">
              Configuration fields are unavailable until the active settings are
              reloaded.
            </p>
          ) : configLoading || !draft ? (
            <div className="p-6 flex justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <div>
                <h3 className="text-sm font-medium mb-1">Severity Weights</h3>
                <p className="text-xs text-muted-foreground mb-3">
                  Points contributed to the raw risk score by each finding
                  severity (0–100).
                </p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="w-fatal" className="text-xs">
                      Fatal
                    </Label>
                    <Input
                      id="w-fatal"
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      value={draft.severityWeights.fatal}
                      onChange={(e) =>
                        setWeight("fatal", Number(e.target.value))
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="w-likely" className="text-xs">
                      Likely Fatal
                    </Label>
                    <Input
                      id="w-likely"
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      value={draft.severityWeights.likely_fatal}
                      onChange={(e) =>
                        setWeight("likely_fatal", Number(e.target.value))
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="w-scoring" className="text-xs">
                      Scoring Risk
                    </Label>
                    <Input
                      id="w-scoring"
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      value={draft.severityWeights.scoring_risk}
                      onChange={(e) =>
                        setWeight("scoring_risk", Number(e.target.value))
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="w-cosmetic" className="text-xs">
                      Cosmetic
                    </Label>
                    <Input
                      id="w-cosmetic"
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      value={draft.severityWeights.cosmetic}
                      onChange={(e) =>
                        setWeight("cosmetic", Number(e.target.value))
                      }
                    />
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-medium mb-1">
                  Missing Evidence Weight
                </h3>
                <p className="text-xs text-muted-foreground mb-3">
                  Penalty applied per mandatory requirement lacking evidence
                  (0–100).
                </p>
                <div className="w-40 space-y-1.5">
                  <Label htmlFor="w-missing" className="text-xs">
                    Weight
                  </Label>
                  <Input
                    id="w-missing"
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={draft.missingEvidenceWeight}
                    onChange={(e) =>
                      setDraft((d) =>
                        d
                          ? {
                              ...d,
                              missingEvidenceWeight: Number(e.target.value),
                            }
                          : d,
                      )
                    }
                  />
                </div>
              </div>

              <div>
                <h3 className="text-sm font-medium mb-1">Risk Band Cutoffs</h3>
                <p className="text-xs text-muted-foreground mb-3">
                  Score thresholds where each band begins. Must satisfy 0 &lt;
                  medium &lt; high &lt; critical ≤ 100.
                </p>
                <div className="grid grid-cols-3 gap-4 max-w-md">
                  <div className="space-y-1.5">
                    <Label htmlFor="c-medium" className="text-xs">
                      Medium ≥
                    </Label>
                    <Input
                      id="c-medium"
                      type="number"
                      min={1}
                      max={100}
                      step={1}
                      value={draft.bandCutoffs.medium}
                      onChange={(e) =>
                        setCutoff("medium", Number(e.target.value))
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="c-high" className="text-xs">
                      High ≥
                    </Label>
                    <Input
                      id="c-high"
                      type="number"
                      min={1}
                      max={100}
                      step={1}
                      value={draft.bandCutoffs.high}
                      onChange={(e) =>
                        setCutoff("high", Number(e.target.value))
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="c-critical" className="text-xs">
                      Critical ≥
                    </Label>
                    <Input
                      id="c-critical"
                      type="number"
                      min={1}
                      max={100}
                      step={1}
                      value={draft.bandCutoffs.critical}
                      onChange={(e) =>
                        setCutoff("critical", Number(e.target.value))
                      }
                    />
                  </div>
                </div>
                {!cutoffsValid(draft) && (
                  <p className="text-xs text-destructive mt-2">
                    Cutoffs must be strictly increasing and within 1–100.
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <FileText className="w-5 h-5 text-foreground" />
          <h2 className="text-xl font-serif tracking-tight font-medium">
            Report Template &amp; Retention
          </h2>
        </div>

        <div className="bg-card border border-border rounded-lg shadow-xs p-6 space-y-4">
          {configUnavailable ? (
            <p className="p-6 text-sm text-muted-foreground">
              Configuration fields are unavailable until the active settings are
              reloaded.
            </p>
          ) : configLoading || !draft ? (
            <div className="p-6 flex justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="firm-name" className="text-xs">
                  Firm Name
                </Label>
                <Input
                  id="firm-name"
                  type="text"
                  maxLength={120}
                  value={draft.firmName}
                  onChange={(e) =>
                    setDraft((d) =>
                      d ? { ...d, firmName: e.target.value } : d,
                    )
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="legend" className="text-xs">
                  Confidentiality Legend
                </Label>
                <Textarea
                  id="legend"
                  rows={2}
                  maxLength={500}
                  value={draft.confidentialityLegend}
                  onChange={(e) =>
                    setDraft((d) =>
                      d ? { ...d, confidentialityLegend: e.target.value } : d,
                    )
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Printed in the footer of generated reports.
                </p>
              </div>
              <div className="w-48 space-y-1.5">
                <Label htmlFor="retention-days" className="text-xs">
                  Default Retention (days)
                </Label>
                <Input
                  id="retention-days"
                  type="number"
                  min={1}
                  max={3650}
                  step={1}
                  value={draft.retentionDefaultDays}
                  onChange={(e) =>
                    setDraft((d) =>
                      d
                        ? { ...d, retentionDefaultDays: Number(e.target.value) }
                        : d,
                    )
                  }
                />
              </div>
            </>
          )}
        </div>

        {draft && (
          <div className="flex items-center justify-between gap-4">
            <p className="text-xs text-muted-foreground">
              {config?.updatedAt
                ? `Last updated ${new Date(config.updatedAt).toLocaleString()}`
                : "Using system defaults."}{" "}
              Saving affects new scores only; historic reports keep their
              snapshot.
            </p>
            <Button onClick={saveConfig} disabled={updateConfig.isPending}>
              {updateConfig.isPending && (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              )}
              Save Configuration
            </Button>
          </div>
        )}
      </div>

      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-foreground" />
          <h2 className="text-xl font-serif tracking-tight font-medium">
            Personnel Management
          </h2>
        </div>
        <div className="flex flex-wrap items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/20">
          <Badge
            variant="outline"
            className="border-amber-300 bg-white text-amber-900 dark:bg-transparent dark:text-amber-200"
          >
            Read only
          </Badge>
          <p className="min-w-0 flex-1 text-sm text-amber-950 dark:text-amber-200">
            Legacy identity records are shown for reference. Role, status,
            delegated access and expiry changes must use the organisation
            membership service; those controls are not available on this screen.
          </p>
        </div>

        <div className="bg-card border border-border rounded-lg shadow-xs overflow-hidden">
          {usersFailed ? (
            <div className="p-6">
              <DataErrorPanel
                title="Personnel access could not be loaded"
                description="No conclusion has been drawn about organisation membership. Retry the tenant-scoped directory request."
                onRetry={() => void refetchUsers()}
              />
            </div>
          ) : loadingUsers || usersPending ? (
            <div className="p-12 flex justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : users && users.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="font-mono text-xs uppercase tracking-wider">
                    User
                  </TableHead>
                  <TableHead className="font-mono text-xs uppercase tracking-wider">
                    Role
                  </TableHead>
                  <TableHead className="font-mono text-xs uppercase tracking-wider">
                    Status
                  </TableHead>
                  <TableHead className="font-mono text-xs uppercase tracking-wider">
                    Joined
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell>
                      <div className="font-medium">
                        {user.name || "Unnamed"}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {user.email}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className="capitalize"
                        aria-label={`Legacy role for ${user.name || user.email}: ${user.role}`}
                      >
                        {user.role.replaceAll("_", " ")}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          user.status === "active" ? "secondary" : "destructive"
                        }
                        className="capitalize"
                        aria-label={`Legacy account status for ${user.name || user.email}: ${user.status}`}
                      >
                        {user.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {user.createdAt
                        ? new Date(user.createdAt).toLocaleDateString()
                        : "-"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="p-8 text-center text-muted-foreground">
              No users are assigned to this organisation.
            </div>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Archive className="w-5 h-5 text-foreground" />
          <h2 className="text-xl font-serif tracking-tight font-medium">
            Retention Workflows
          </h2>
        </div>

        <div
          role="status"
          className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-950"
        >
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div className="space-y-1 text-sm">
            <p className="font-medium">Retention completion is unavailable</p>
            <p>
              You can open and review requests, but no data is deleted and no
              deletion certificate is issued. Reactivation requires a durable
              two-phase detach, reconcile and certify workflow covering project
              content, object storage, upload sessions and storage-lifecycle
              control rows.
            </p>
          </div>
        </div>

        <div className="bg-card border border-border rounded-lg shadow-xs overflow-hidden">
          {retentionFailed ? (
            <div className="p-6">
              <DataErrorPanel
                title="Retention requests could not be loaded"
                description="The queue state is unknown. Retry before concluding that no retention work is open."
                onRetry={() => void refetchRetention()}
              />
            </div>
          ) : loadingRetention || retentionPending ? (
            <div className="p-12 flex justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : retentionRequests && retentionRequests.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="font-mono text-xs uppercase tracking-wider">
                    Project
                  </TableHead>
                  <TableHead className="font-mono text-xs uppercase tracking-wider">
                    Reason
                  </TableHead>
                  <TableHead className="font-mono text-xs uppercase tracking-wider">
                    Due
                  </TableHead>
                  <TableHead className="font-mono text-xs uppercase tracking-wider">
                    Status
                  </TableHead>
                  <TableHead className="font-mono text-xs uppercase tracking-wider text-right">
                    Action
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {retentionRequests.map((request) => (
                  <TableRow key={request.id}>
                    <TableCell className="font-mono text-xs">
                      {request.projectId}
                    </TableCell>
                    <TableCell className="max-w-[360px]">
                      <div className="text-sm">{request.reason || "-"}</div>
                      {request.certificateText && (
                        <div className="text-xs text-muted-foreground mt-1">
                          {request.certificateText}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(request.dueAt).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          request.status === "completed"
                            ? "default"
                            : "secondary"
                        }
                        className="capitalize"
                      >
                        {request.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {request.status === "completed" ? (
                        <Badge
                          variant="outline"
                          className="text-emerald-700 border-emerald-200 bg-emerald-50"
                        >
                          <CheckCircle2 className="w-3 h-3 mr-1" />
                          Certified
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="border-amber-300 bg-amber-50 text-amber-800"
                        >
                          Activation required
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="p-8 text-center text-muted-foreground">
              No retention requests are available.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
