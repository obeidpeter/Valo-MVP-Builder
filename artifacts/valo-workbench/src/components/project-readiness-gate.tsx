import {
  type Project,
  useGetProjectScorecard,
  useGetRisk,
  useListBoqChecks,
  useListDefects,
  useListDocuments,
  useListEvidence,
  useListReports,
  useListRequirements,
} from "@workspace/api-client-react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Circle,
  FileCheck2,
  Loader2,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

export type ProjectTab =
  | "overview"
  | "documents"
  | "requirements"
  | "evidence"
  | "boq"
  | "defects"
  | "risk"
  | "reports"
  | "audit";

type GateStatus = "pass" | "warning" | "blocked";

interface GateCheck {
  id: string;
  label: string;
  detail: string;
  status: GateStatus;
  tab: ProjectTab;
  action: string;
  required?: boolean;
}

const MATERIAL_DEFECTS = new Set(["fatal", "likely_fatal"]);
const OPEN_DEFECTS = new Set(["open", "suggested"]);
const RESOLVED_EVIDENCE = new Set(["present", "not_applicable"]);
const REVIEWED_REQUIREMENTS = new Set(["confirmed", "edited", "pending"]);
const TERMINAL_STATUSES = new Set(["signed_off", "exported", "archived"]);

function statusMeta(status: GateStatus) {
  switch (status) {
    case "pass":
      return {
        icon: CheckCircle2,
        label: "Ready",
        badgeClass: "border-emerald-200 bg-emerald-50 text-emerald-700",
        iconClass: "text-emerald-600",
      };
    case "warning":
      return {
        icon: AlertTriangle,
        label: "Needs review",
        badgeClass: "border-amber-300 bg-amber-50 text-amber-800",
        iconClass: "text-amber-600",
      };
    case "blocked":
      return {
        icon: XCircle,
        label: "Blocked",
        badgeClass: "border-destructive/30 bg-destructive/10 text-destructive",
        iconClass: "text-destructive",
      };
  }
}

function formatList(items: string[]) {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

function makeCheck(
  id: string,
  label: string,
  status: GateStatus,
  detail: string,
  tab: ProjectTab,
  action: string,
  required = true,
): GateCheck {
  return { id, label, status, detail, tab, action, required };
}

export function ProjectReadinessGate({
  project,
  onGoToTab,
}: {
  project: Project;
  onGoToTab: (tab: ProjectTab) => void;
}) {
  const projectId = project.id;
  const documentsQuery = useListDocuments(projectId);
  const requirementsQuery = useListRequirements(projectId);
  const scorecardQuery = useGetProjectScorecard(projectId);
  const evidenceQuery = useListEvidence(projectId);
  const defectsQuery = useListDefects(projectId);
  const boqQuery = useListBoqChecks(projectId);
  const riskQuery = useGetRisk(projectId);
  const reportsQuery = useListReports(projectId);

  const documents = documentsQuery.data ?? [];
  const requirements = requirementsQuery.data ?? [];
  const scorecard = scorecardQuery.data;
  const evidence = evidenceQuery.data ?? [];
  const defects = defectsQuery.data ?? [];
  const boqChecks = boqQuery.data ?? [];
  const risk = riskQuery.data;
  const reports = reportsQuery.data ?? [];

  const isLoading =
    documentsQuery.isLoading ||
    requirementsQuery.isLoading ||
    scorecardQuery.isLoading ||
    evidenceQuery.isLoading ||
    defectsQuery.isLoading ||
    boqQuery.isLoading ||
    riskQuery.isLoading ||
    reportsQuery.isLoading;

  const tenderDocs = documents.filter((doc) => doc.type === "tender");
  const bidDocs = documents.filter((doc) => doc.type === "bid");
  const boqDocs = documents.filter((doc) => doc.type === "boq");
  const includedDocs = documents.filter((doc) => doc.redactionStatus !== "excluded");
  const hashlessDocs = documents.filter((doc) => !doc.sha256);
  const extractingDocs = includedDocs.filter((doc) => doc.extractionStatus === "pending" || doc.extractionStatus === "extracting");
  const extractedDocs = includedDocs.filter((doc) => doc.extractionStatus === "extracted");
  const failedExtractionDocs = includedDocs.filter((doc) => doc.extractionStatus === "failed");

  const unreviewedRequirements = requirements.filter((req) => req.reviewStatus === "suggested");
  const reviewedRequirements = requirements.filter((req) => REVIEWED_REQUIREMENTS.has(req.reviewStatus));
  const mandatoryRequirements = reviewedRequirements.filter((req) => req.isMandatory);
  const unresolvedMandatory = mandatoryRequirements.filter((req) => {
    const matches = evidence.filter((item) => item.requirementId === req.id);
    return matches.length === 0 || matches.some((item) => !RESOLVED_EVIDENCE.has(item.evidenceStatus));
  });

  const openMaterialDefects = defects.filter(
    (defect) => OPEN_DEFECTS.has(defect.status) && MATERIAL_DEFECTS.has(defect.severity),
  );
  const openSuggestedDefects = defects.filter((defect) => defect.status === "suggested");
  const flaggedBoqChecks = boqChecks.filter((check) => check.status === "flagged");
  const signedReports = reports.filter((report) => report.status === "signed_off");
  const draftReports = reports.filter((report) => report.status === "draft");

  const checks: GateCheck[] = [
    makeCheck(
      "governance",
      "Payment and governance",
      project.paymentStatus === "pending" || !project.reviewerName
        ? "blocked"
        : project.paymentStatus === "confirmed" || project.paymentStatus === "not_required"
          ? "pass"
          : "warning",
      project.paymentStatus === "pending"
        ? "Payment confirmation is still pending."
        : !project.reviewerName
          ? "Assign a named reviewer before this project moves forward."
          : project.paymentStatus === "confirmed"
            ? "Payment is confirmed and a named reviewer is assigned."
            : "No payment gate is required for this engagement.",
      "overview",
      "Open Governance",
    ),
    makeCheck(
      "conflict",
      "Conflict and restriction controls",
      project.conflictStatus === "blocked" || project.conflictStatus === "declined"
        ? "blocked"
        : project.restrictedMode && !project.redactionScope
          ? "warning"
          : "pass",
      project.conflictStatus === "blocked" || project.conflictStatus === "declined"
        ? "Conflict status blocks document intake and downstream review."
        : project.restrictedMode && !project.redactionScope
          ? "Restricted mode is enabled without a recorded redaction scope."
          : project.restrictedMode
            ? "Restricted mode has a recorded redaction scope."
            : "No active conflict blocker is recorded.",
      "overview",
      "Open Controls",
    ),
    makeCheck(
      "documents",
      "Tender and bid documents",
      tenderDocs.length === 0 || bidDocs.length === 0 || hashlessDocs.length > 0 ? "blocked" : "pass",
      tenderDocs.length === 0 || bidDocs.length === 0
        ? `Missing ${formatList([
            tenderDocs.length === 0 ? "tender document" : "",
            bidDocs.length === 0 ? "bid document" : "",
          ].filter(Boolean))}.`
        : hashlessDocs.length > 0
          ? `${hashlessDocs.length} document${hashlessDocs.length === 1 ? "" : "s"} lack an intake SHA-256 manifest.`
          : "Tender and bid files are uploaded with SHA-256 intake manifests.",
      "documents",
      "Open Documents",
    ),
    makeCheck(
      "extraction",
      "Document extraction",
      includedDocs.length === 0 || extractingDocs.length > 0
        ? "blocked"
        : failedExtractionDocs.length > 0 || extractedDocs.length === 0
          ? "warning"
          : "pass",
      includedDocs.length === 0
        ? "Promote at least one document to included or redacted before extraction."
        : extractingDocs.length > 0
          ? `${extractingDocs.length} included document${extractingDocs.length === 1 ? "" : "s"} still extracting.`
          : failedExtractionDocs.length > 0
            ? `${failedExtractionDocs.length} included document${failedExtractionDocs.length === 1 ? "" : "s"} failed extraction.`
            : extractedDocs.length === 0
              ? "No included document has extracted text yet."
              : `${extractedDocs.length} included document${extractedDocs.length === 1 ? "" : "s"} have extracted text.`,
      "documents",
      "Review Extraction",
    ),
    makeCheck(
      "requirements",
      "Requirement review",
      requirements.length === 0 || unreviewedRequirements.length > 0 ? "blocked" : "pass",
      requirements.length === 0
        ? "No requirement matrix exists yet."
        : unreviewedRequirements.length > 0
          ? `${unreviewedRequirements.length} AI suggestion${unreviewedRequirements.length === 1 ? "" : "s"} still need a reviewer ruling.`
          : `${reviewedRequirements.length} requirement${reviewedRequirements.length === 1 ? "" : "s"} have reviewer rulings.`,
      "requirements",
      "Review Requirements",
    ),
    makeCheck(
      "gate0",
      "Gate 0 scorecard",
      scorecard?.totals?.mandatoryRecall == null
        ? "warning"
        : scorecard.totals.mandatoryRecall >= 0.85
          ? "pass"
          : "warning",
      scorecard?.totals?.mandatoryRecall == null
        ? "Mandatory recall is not available until reviewer rulings exist."
        : `Mandatory recall is ${(scorecard.totals.mandatoryRecall * 100).toFixed(1)}% against the 85% target.`,
      "requirements",
      "Open Scorecard",
      false,
    ),
    makeCheck(
      "evidence",
      "Mandatory evidence",
      mandatoryRequirements.length === 0 || unresolvedMandatory.length > 0 ? "blocked" : "pass",
      mandatoryRequirements.length === 0
        ? "No reviewed mandatory requirements are available for evidence mapping."
        : unresolvedMandatory.length > 0
          ? `${unresolvedMandatory.length} mandatory requirement${unresolvedMandatory.length === 1 ? "" : "s"} lack resolved evidence.`
          : "Every reviewed mandatory requirement has resolved evidence.",
      "evidence",
      "Map Evidence",
    ),
    makeCheck(
      "boq",
      "BOQ check",
      boqDocs.length === 0
        ? "warning"
        : boqChecks.length === 0 || flaggedBoqChecks.length > 0
          ? "blocked"
          : "pass",
      boqDocs.length === 0
        ? "No BOQ document is marked for this project."
        : boqChecks.length === 0
          ? "A BOQ document exists, but no BOQ check has been run."
          : flaggedBoqChecks.length > 0
            ? `${flaggedBoqChecks.length} BOQ finding${flaggedBoqChecks.length === 1 ? "" : "s"} remain flagged.`
            : "BOQ checks have no active flags.",
      "boq",
      "Open BOQ",
    ),
    makeCheck(
      "defects",
      "Material defects",
      openMaterialDefects.length > 0 ? "blocked" : openSuggestedDefects.length > 0 ? "warning" : "pass",
      openMaterialDefects.length > 0
        ? `${openMaterialDefects.length} open fatal or likely-fatal defect${openMaterialDefects.length === 1 ? "" : "s"} must be resolved.`
        : openSuggestedDefects.length > 0
          ? `${openSuggestedDefects.length} suggested defect${openSuggestedDefects.length === 1 ? "" : "s"} still need reviewer action.`
          : "No open fatal or likely-fatal defects remain.",
      "defects",
      "Resolve Defects",
    ),
    makeCheck(
      "risk",
      "Risk assessment",
      risk || project.riskBand ? "pass" : "blocked",
      risk || project.riskBand
        ? `Current risk band is ${(risk?.band ?? project.riskBand ?? "").replace("_", " ")}.`
        : "Generate the deterministic risk assessment before reporting.",
      "risk",
      "Open Risk",
    ),
    makeCheck(
      "report",
      "Report sign-off",
      signedReports.length > 0 || TERMINAL_STATUSES.has(project.status)
        ? "pass"
        : draftReports.length > 0
          ? "blocked"
          : "warning",
      signedReports.length > 0 || TERMINAL_STATUSES.has(project.status)
        ? "A signed-off report is available."
        : draftReports.length > 0
          ? "A draft report exists and needs named-reviewer sign-off."
          : "No report has been generated yet.",
      "reports",
      signedReports.length > 0 ? "Open Reports" : draftReports.length > 0 ? "Sign Off Report" : "Generate Report",
    ),
    makeCheck(
      "export",
      "Export and archive",
      (signedReports.length > 0 || TERMINAL_STATUSES.has(project.status)) && project.physicalArchiveInstruction
        ? "pass"
        : "blocked",
      !signedReports.length && !TERMINAL_STATUSES.has(project.status)
        ? "Export stays blocked until named-reviewer sign-off."
        : !project.physicalArchiveInstruction
          ? "Record physical archive instructions before ZIP export."
          : "Signed-off package is eligible for ZIP export.",
      (signedReports.length > 0 || TERMINAL_STATUSES.has(project.status)) && !project.physicalArchiveInstruction
        ? "overview"
        : "reports",
      (signedReports.length > 0 || TERMINAL_STATUSES.has(project.status)) && !project.physicalArchiveInstruction
        ? "Add Archive Note"
        : "Open Reports",
    ),
  ];

  const requiredChecks = checks.filter((check) => check.required !== false);
  const passedRequired = requiredChecks.filter((check) => check.status === "pass").length;
  const blockedRequired = requiredChecks.filter((check) => check.status === "blocked").length;
  const warningCount = checks.filter((check) => check.status === "warning").length;
  const progress = Math.round((passedRequired / requiredChecks.length) * 100);
  const ready = blockedRequired === 0;

  const nextCheck = checks.find((check) => check.status === "blocked") ?? checks.find((check) => check.status === "warning");

  return (
    <section className="bg-card border border-border rounded-xl shadow-xs overflow-hidden">
      <div className="p-6 border-b border-border">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-primary" />
              <h3 className="font-serif text-xl font-medium">Project Readiness Gate</h3>
              <Badge
                variant="outline"
                className={
                  ready
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-destructive/30 bg-destructive/10 text-destructive"
                }
              >
                {ready ? "Ready for sign-off path" : `${blockedRequired} blocker${blockedRequired === 1 ? "" : "s"}`}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground max-w-3xl">
              A reviewer-facing control gate for sign-off, export, and archive readiness across governance,
              intake, evidence, defects, BOQ, risk, and report state.
            </p>
          </div>
          <div className="min-w-[240px] space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">{progress}% complete</span>
              <span className="text-muted-foreground">
                {passedRequired}/{requiredChecks.length} required
              </span>
            </div>
            <Progress value={progress} />
            {warningCount > 0 && (
              <p className="text-xs text-muted-foreground">
                {warningCount} advisory item{warningCount === 1 ? "" : "s"} should be reviewed before delivery.
              </p>
            )}
          </div>
        </div>
        {nextCheck && (
          <div className="mt-4 flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <FileCheck2 className="mt-0.5 w-4 h-4 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Next action: {nextCheck.label}</p>
                <p className="text-xs text-muted-foreground">{nextCheck.detail}</p>
              </div>
            </div>
            <Button size="sm" variant="outline" onClick={() => onGoToTab(nextCheck.tab)}>
              {nextCheck.action}
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="p-8 flex items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="w-5 h-5 mr-2 animate-spin" />
          Checking readiness gates
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
          {checks.map((check) => {
            const meta = statusMeta(check.status);
            const Icon = meta.icon;
            return (
              <div key={check.id} className="border-b border-r border-border p-4 min-h-[154px]">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Icon className={`w-4 h-4 ${meta.iconClass}`} />
                    <h4 className="text-sm font-semibold">{check.label}</h4>
                  </div>
                  <Badge variant="outline" className={`text-[10px] ${meta.badgeClass}`}>
                    {meta.label}
                  </Badge>
                </div>
                <p className="mt-3 text-sm text-muted-foreground leading-5">{check.detail}</p>
                <Button
                  size="sm"
                  variant="ghost"
                  className="mt-3 h-8 px-0 text-primary hover:bg-transparent"
                  onClick={() => onGoToTab(check.tab)}
                >
                  {check.action}
                  <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
                </Button>
              </div>
            );
          })}
        </div>
      )}

      {ready && (
        <div className="flex items-center gap-2 border-t border-border bg-emerald-50 px-6 py-3 text-sm text-emerald-800">
          <Circle className="w-3 h-3 fill-emerald-600 text-emerald-600" />
          Required gates are clear. Advisory warnings should still be reviewed before external delivery.
        </div>
      )}
    </section>
  );
}
