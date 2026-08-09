import {
  paymentGateSatisfied,
  type ConflictStatus,
  type PaymentStatus,
} from "./deterministic";

export type SubmissionBlockerCode =
  | "nda_missing"
  | "reviewer_missing"
  | "reviewer_not_independent"
  | "conflict_unresolved"
  | "payment_unconfirmed"
  | "tender_missing"
  | "bid_missing"
  | "document_integrity_missing"
  | "document_extraction_incomplete"
  | "requirements_missing"
  | "requirements_unreviewed"
  | "citation_unresolvable"
  | "mandatory_evidence_missing"
  | "defects_unreviewed"
  | "fatal_defect_open"
  | "boq_not_verified"
  | "boq_exception_open"
  | "unsupported_claim"
  | "red_team_incomplete"
  | "report_provenance_missing";

export interface SubmissionBlocker {
  code: SubmissionBlockerCode;
  message: string;
  objectIds?: string[];
}

export interface SubmissionReadinessInput {
  project: {
    ndaStatus?: string | null;
    reviewerId?: string | null;
    conflictStatus?: ConflictStatus | string | null;
    paymentStatus?: PaymentStatus | string | null;
    paymentConfirmedByFounder?: boolean | null;
    paymentConfirmedByAdvisor?: boolean | null;
    paymentFounderConfirmedBy?: string | null;
    paymentAdvisorConfirmedBy?: string | null;
  };
  report: {
    generatedBy?: string | null;
    engineVersion?: string | null;
    promptPackVersion?: string | null;
    modelId?: string | null;
    taxonomyVersion?: string | null;
  };
  signerId?: string | null;
  documents: Array<{
    id: string;
    type: string;
    redactionStatus: string;
    sha256?: string | null;
    extractionStatus?: string | null;
  }>;
  requirements: Array<{
    id: string;
    isMandatory: boolean;
    reviewStatus: string;
    sourceDocId?: string | null;
    pageRef?: string | null;
    clauseRef?: string | null;
  }>;
  evidence: Array<{
    id?: string;
    requirementId: string;
    evidenceStatus: string;
    suggested?: boolean | null;
  }>;
  defects: Array<{
    id: string;
    severity: string;
    status: string;
  }>;
  boqChecks: Array<{
    id: string;
    status: string;
  }>;
  unsupportedClaimIds: string[];
  requiresRedTeam: boolean;
  redTeamApproved: boolean;
  requireIndependentSignOff?: boolean;
}

export interface SubmissionReadinessResult {
  ready: boolean;
  blockers: SubmissionBlocker[];
}

const CONFIRMED_REQUIREMENT_STATES = new Set(["confirmed", "edited"]);
const REVIEWED_REQUIREMENT_STATES = new Set([
  "confirmed",
  "edited",
  "rejected",
]);
const RESOLVED_EVIDENCE_STATES = new Set(["present", "not_applicable"]);
const BLOCKING_DEFECT_SEVERITIES = new Set(["fatal", "likely_fatal"]);
const INCLUDED_REDACTION_STATES = new Set(["included", "redacted"]);

/**
 * The complete server-side package-release gate. This is deliberately pure so
 * every denial path can be exhaustively tested and reused by sign-off, export,
 * and future package-release endpoints. UI readiness indicators are advisory;
 * only this result authorises a state mutation.
 */
export function evaluateSubmissionReadiness(
  input: SubmissionReadinessInput,
): SubmissionReadinessResult {
  const blockers: SubmissionBlocker[] = [];
  const add = (blocker: SubmissionBlocker) => blockers.push(blocker);

  if (input.project.ndaStatus !== "signed") {
    add({
      code: "nda_missing",
      message: "A signed NDA is required before sign-off.",
    });
  }
  if (!input.project.reviewerId) {
    add({
      code: "reviewer_missing",
      message: "A named project reviewer is required.",
    });
  }
  if (
    input.requireIndependentSignOff !== false &&
    input.signerId &&
    input.report.generatedBy &&
    input.signerId === input.report.generatedBy
  ) {
    add({
      code: "reviewer_not_independent",
      message:
        "The report generator cannot independently approve the same report.",
    });
  }
  if (!input.signerId) {
    add({
      code: "reviewer_missing",
      message: "The approving reviewer identity is missing.",
    });
  }

  if (
    !new Set(["clear", "consented"]).has(input.project.conflictStatus ?? "")
  ) {
    add({
      code: "conflict_unresolved",
      message: "The same-tender conflict check is unresolved.",
    });
  }
  if (
    !paymentGateSatisfied({
      paymentStatus: input.project.paymentStatus as PaymentStatus | undefined,
      paymentConfirmedByFounder:
        input.project.paymentConfirmedByFounder ?? undefined,
      paymentConfirmedByAdvisor:
        input.project.paymentConfirmedByAdvisor ?? undefined,
      paymentFounderConfirmedBy: input.project.paymentFounderConfirmedBy,
      paymentAdvisorConfirmedBy: input.project.paymentAdvisorConfirmedBy,
    })
  ) {
    add({
      code: "payment_unconfirmed",
      message: "The configured payment/entitlement gate is not satisfied.",
    });
  }

  const tenderDocs = input.documents.filter(
    (document) => document.type === "tender",
  );
  const bidDocs = input.documents.filter((document) => document.type === "bid");
  if (tenderDocs.length === 0) {
    add({
      code: "tender_missing",
      message: "At least one tender document is required.",
    });
  }
  if (bidDocs.length === 0) {
    add({
      code: "bid_missing",
      message: "At least one bid/response document is required.",
    });
  }

  const relevantDocs = input.documents.filter(
    (document) =>
      (document.type === "tender" ||
        document.type === "bid" ||
        document.type === "boq") &&
      INCLUDED_REDACTION_STATES.has(document.redactionStatus),
  );
  const hashless = relevantDocs.filter((document) => !document.sha256);
  if (hashless.length > 0) {
    add({
      code: "document_integrity_missing",
      message: `${hashless.length} included document(s) lack a server-computed SHA-256 manifest.`,
      objectIds: hashless.map((document) => document.id),
    });
  }
  const extractionIncomplete = relevantDocs.filter(
    (document) =>
      document.type !== "boq" && document.extractionStatus !== "extracted",
  );
  if (extractionIncomplete.length > 0) {
    add({
      code: "document_extraction_incomplete",
      message: `${extractionIncomplete.length} included document(s) have not completed extraction.`,
      objectIds: extractionIncomplete.map((document) => document.id),
    });
  }

  if (input.requirements.length === 0) {
    add({
      code: "requirements_missing",
      message: "The confirmed requirement matrix is empty.",
    });
  }
  const unreviewedRequirements = input.requirements.filter(
    (requirement) => !REVIEWED_REQUIREMENT_STATES.has(requirement.reviewStatus),
  );
  if (unreviewedRequirements.length > 0) {
    add({
      code: "requirements_unreviewed",
      message: `${unreviewedRequirements.length} requirement candidate(s) still need a named-human ruling.`,
      objectIds: unreviewedRequirements.map((requirement) => requirement.id),
    });
  }

  const acceptedRequirements = input.requirements.filter((requirement) =>
    CONFIRMED_REQUIREMENT_STATES.has(requirement.reviewStatus),
  );
  const unresolvedCitations = acceptedRequirements.filter(
    (requirement) =>
      !requirement.sourceDocId ||
      (!requirement.pageRef?.trim() && !requirement.clauseRef?.trim()),
  );
  if (unresolvedCitations.length > 0) {
    add({
      code: "citation_unresolvable",
      message: `${unresolvedCitations.length} confirmed requirement(s) lack a resolvable source citation.`,
      objectIds: unresolvedCitations.map((requirement) => requirement.id),
    });
  }

  const unresolvedMandatory = acceptedRequirements.filter((requirement) => {
    if (!requirement.isMandatory) return false;
    return !input.evidence.some(
      (item) =>
        item.requirementId === requirement.id &&
        item.suggested !== true &&
        RESOLVED_EVIDENCE_STATES.has(item.evidenceStatus),
    );
  });
  if (unresolvedMandatory.length > 0) {
    add({
      code: "mandatory_evidence_missing",
      message: `${unresolvedMandatory.length} confirmed mandatory requirement(s) lack approved evidence.`,
      objectIds: unresolvedMandatory.map((requirement) => requirement.id),
    });
  }

  const unreviewedDefects = input.defects.filter(
    (defect) => defect.status === "suggested",
  );
  if (unreviewedDefects.length > 0) {
    add({
      code: "defects_unreviewed",
      message: `${unreviewedDefects.length} suggested defect(s) still need a reviewer ruling.`,
      objectIds: unreviewedDefects.map((defect) => defect.id),
    });
  }
  const openFatalDefects = input.defects.filter(
    (defect) =>
      defect.status === "open" &&
      BLOCKING_DEFECT_SEVERITIES.has(defect.severity),
  );
  if (openFatalDefects.length > 0) {
    add({
      code: "fatal_defect_open",
      message: `${openFatalDefects.length} fatal or likely-fatal defect(s) remain open.`,
      objectIds: openFatalDefects.map((defect) => defect.id),
    });
  }

  const hasBoq = relevantDocs.some((document) => document.type === "boq");
  if (hasBoq && input.boqChecks.length === 0) {
    add({
      code: "boq_not_verified",
      message: "A BOQ is present but deterministic verification has not run.",
    });
  }
  const openBoqChecks = input.boqChecks.filter(
    (check) => check.status === "flagged",
  );
  if (openBoqChecks.length > 0) {
    add({
      code: "boq_exception_open",
      message: `${openBoqChecks.length} deterministic BOQ exception(s) remain unresolved.`,
      objectIds: openBoqChecks.map((check) => check.id),
    });
  }

  if ((input.unsupportedClaimIds?.length ?? 0) > 0) {
    add({
      code: "unsupported_claim",
      message: `${input.unsupportedClaimIds!.length} factual claim(s) lack approved evidence.`,
      objectIds: input.unsupportedClaimIds,
    });
  }
  if (input.requiresRedTeam && !input.redTeamApproved) {
    add({
      code: "red_team_incomplete",
      message: "The required independent red-team review is incomplete.",
    });
  }

  const missingProvenance = [
    input.report.engineVersion,
    input.report.promptPackVersion,
    input.report.modelId,
    input.report.taxonomyVersion,
  ].some((value) => !value?.trim());
  if (missingProvenance) {
    add({
      code: "report_provenance_missing",
      message:
        "The report is missing one or more immutable provenance identifiers.",
    });
  }

  return { ready: blockers.length === 0, blockers };
}
