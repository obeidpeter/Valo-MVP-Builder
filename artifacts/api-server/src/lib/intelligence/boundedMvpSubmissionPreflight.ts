import {
  assertBoundedItems,
  boundedProposalSafety,
  isBoundedCitationValid,
  normalizeBoundedText,
  type BoundedScope,
  type BoundedSourceCitation,
  type ProposalSafetyEnvelope,
} from "./boundedMvpContracts";

export interface PreflightObligation {
  id: string;
  label: string;
  reviewState: "accepted" | "proposed" | "rejected" | "superseded";
  mandatory: boolean;
  expectedFilename?: string;
  citation: BoundedSourceCitation;
}

export interface PreflightArtifact {
  id: string;
  obligationIds: readonly string[];
  filename: string;
  lifecycleState: "draft" | "final" | "superseded";
  sha256?: string;
  approvedByUserId?: string;
}

export interface PreflightAddendum {
  id: string;
  reviewState: "accepted" | "proposed" | "rejected";
  incorporationState: "applied" | "not_applied" | "unknown";
  citation: BoundedSourceCitation;
}

export interface PreflightDeadline {
  dueAtIso: string;
  sourceDateText: string;
  citation: BoundedSourceCitation;
}

export interface ExtendedSubmissionPreflightInput extends BoundedScope {
  asOfIso: string;
  namedReviewerId?: string;
  obligations: readonly PreflightObligation[];
  artifacts: readonly PreflightArtifact[];
  addenda: readonly PreflightAddendum[];
  deadline?: PreflightDeadline;
}

export type ExtendedPreflightIssueCode =
  | "reviewer_missing"
  | "unverified_obligation"
  | "mandatory_artifact_missing"
  | "artifact_integrity_missing"
  | "artifact_not_final"
  | "final_artifact_not_approved"
  | "required_filename_mismatch"
  | "duplicate_artifact_id"
  | "unverified_addendum"
  | "addendum_not_applied"
  | "deadline_invalid"
  | "deadline_passed";

export interface ExtendedPreflightIssue {
  code: ExtendedPreflightIssueCode;
  objectId?: string;
  message: string;
}

export interface PreflightRemediationProposal {
  proposalId: string;
  issueCode: ExtendedPreflightIssueCode;
  objectId?: string;
  proposedAction:
    | "assign_named_reviewer"
    | "review_source_rule"
    | "attach_required_artifact"
    | "restore_artifact_integrity"
    | "request_artifact_approval"
    | "correct_filename"
    | "review_addendum"
    | "incorporate_addendum"
    | "review_deadline";
}

export interface ExtendedSubmissionPreflightResult {
  status: "blockers_found" | "checks_passed_pending_human_approval";
  submissionAuthorized: false;
  issues: ExtendedPreflightIssue[];
  remediationProposals: PreflightRemediationProposal[];
  safety: ProposalSafetyEnvelope;
}

const MAX_OBLIGATIONS = 1_000;
const MAX_ARTIFACTS = 1_000;
const MAX_ADDENDA = 200;
const SHA_256 = /^[a-f0-9]{64}$/iu;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;

function validUtcInstant(value: string): boolean {
  return ISO_UTC.test(value) && Number.isFinite(Date.parse(value));
}

/**
 * Extends submission preflight with source-backed obligation, addendum,
 * filename, integrity, approval, and deadline checks. Passing these checks
 * never authorises submission; the authoritative release gate remains separate.
 */
export function runExtendedSubmissionPreflight(
  input: ExtendedSubmissionPreflightInput,
): ExtendedSubmissionPreflightResult {
  assertBoundedItems(
    "Preflight obligations",
    input.obligations,
    MAX_OBLIGATIONS,
  );
  assertBoundedItems("Preflight artifacts", input.artifacts, MAX_ARTIFACTS);
  assertBoundedItems("Preflight addenda", input.addenda, MAX_ADDENDA);

  const issues: ExtendedPreflightIssue[] = [];
  const add = (
    code: ExtendedPreflightIssueCode,
    message: string,
    objectId?: string,
  ) => issues.push({ code, message, ...(objectId ? { objectId } : {}) });

  if (!input.namedReviewerId?.trim()) {
    add(
      "reviewer_missing",
      "A named reviewer is required before submission review.",
    );
  }

  const seenArtifactIds = new Set<string>();
  for (const artifact of input.artifacts) {
    if (seenArtifactIds.has(artifact.id)) {
      add(
        "duplicate_artifact_id",
        "Artifact identifiers must be unique.",
        artifact.id,
      );
    }
    seenArtifactIds.add(artifact.id);
  }

  for (const obligation of input.obligations) {
    const expectedFilenameGrounded =
      !obligation.expectedFilename ||
      normalizeBoundedText(obligation.citation.quote).includes(
        normalizeBoundedText(obligation.expectedFilename),
      );
    const labelGrounded = normalizeBoundedText(
      obligation.citation.quote,
    ).includes(normalizeBoundedText(obligation.label));
    if (
      obligation.reviewState !== "accepted" ||
      !isBoundedCitationValid(obligation.citation, input) ||
      !expectedFilenameGrounded ||
      !labelGrounded
    ) {
      add(
        "unverified_obligation",
        "The obligation is not an accepted, active, source-grounded rule.",
        obligation.id,
      );
      continue;
    }

    const linkedArtifacts = input.artifacts.filter(
      (artifact) =>
        artifact.lifecycleState !== "superseded" &&
        artifact.obligationIds.includes(obligation.id),
    );
    if (obligation.mandatory && linkedArtifacts.length === 0) {
      add(
        "mandatory_artifact_missing",
        `No active artifact is linked to mandatory obligation ${obligation.label}.`,
        obligation.id,
      );
      continue;
    }
    for (const artifact of linkedArtifacts) {
      if (!artifact.sha256 || !SHA_256.test(artifact.sha256)) {
        add(
          "artifact_integrity_missing",
          "The linked artifact lacks a valid content hash.",
          artifact.id,
        );
      }
      if (artifact.lifecycleState !== "final") {
        add(
          "artifact_not_final",
          "A linked artifact remains a draft and cannot satisfy submission preflight.",
          artifact.id,
        );
      }
      if (
        artifact.lifecycleState === "final" &&
        !artifact.approvedByUserId?.trim()
      ) {
        add(
          "final_artifact_not_approved",
          "A final artifact lacks named-human approval.",
          artifact.id,
        );
      }
      if (
        obligation.expectedFilename &&
        artifact.filename !== obligation.expectedFilename
      ) {
        add(
          "required_filename_mismatch",
          `The artifact filename does not equal the cited required filename ${obligation.expectedFilename}.`,
          artifact.id,
        );
      }
    }
  }

  for (const addendum of input.addenda) {
    if (
      addendum.reviewState !== "accepted" ||
      !isBoundedCitationValid(addendum.citation, input)
    ) {
      add(
        "unverified_addendum",
        "The addendum is not accepted with an active, in-scope citation.",
        addendum.id,
      );
    } else if (addendum.incorporationState !== "applied") {
      add(
        "addendum_not_applied",
        "An accepted addendum has not been confirmed as incorporated.",
        addendum.id,
      );
    }
  }

  if (input.deadline) {
    const deadlineGrounded = normalizeBoundedText(
      input.deadline.citation.quote,
    ).includes(normalizeBoundedText(input.deadline.sourceDateText));
    if (
      !validUtcInstant(input.asOfIso) ||
      !validUtcInstant(input.deadline.dueAtIso) ||
      !deadlineGrounded ||
      !isBoundedCitationValid(input.deadline.citation, input)
    ) {
      add(
        "deadline_invalid",
        "The deadline or comparison time is invalid or lacks exact source support.",
      );
    } else if (
      Date.parse(input.asOfIso) > Date.parse(input.deadline.dueAtIso)
    ) {
      add("deadline_passed", "The cited submission deadline has passed.");
    }
  } else if (!validUtcInstant(input.asOfIso)) {
    add("deadline_invalid", "The deterministic comparison time is invalid.");
  }

  const proposedActionByIssue: Record<
    ExtendedPreflightIssueCode,
    PreflightRemediationProposal["proposedAction"]
  > = {
    reviewer_missing: "assign_named_reviewer",
    unverified_obligation: "review_source_rule",
    mandatory_artifact_missing: "attach_required_artifact",
    artifact_integrity_missing: "restore_artifact_integrity",
    artifact_not_final: "request_artifact_approval",
    final_artifact_not_approved: "request_artifact_approval",
    required_filename_mismatch: "correct_filename",
    duplicate_artifact_id: "restore_artifact_integrity",
    unverified_addendum: "review_addendum",
    addendum_not_applied: "incorporate_addendum",
    deadline_invalid: "review_deadline",
    deadline_passed: "review_deadline",
  };
  const remediationProposals = issues.map((issue, index) => ({
    proposalId: `preflight:${index + 1}:${issue.code}`,
    issueCode: issue.code,
    ...(issue.objectId ? { objectId: issue.objectId } : {}),
    proposedAction: proposedActionByIssue[issue.code],
  }));

  return {
    status:
      issues.length > 0
        ? "blockers_found"
        : "checks_passed_pending_human_approval",
    submissionAuthorized: false,
    issues,
    remediationProposals,
    safety: boundedProposalSafety(),
  };
}
