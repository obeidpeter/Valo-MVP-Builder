import {
  assertBoundedItems,
  boundedProposalSafety,
  isBoundedCitationValid,
  normalizeBoundedText,
  type BoundedScope,
  type BoundedSourceCitation,
  type ProposalSafetyEnvelope,
} from "./boundedMvpContracts";

export type AwardObligationKind =
  | "deliverable"
  | "deadline"
  | "acceptance"
  | "reporting"
  | "warranty"
  | "dependency";

export interface AwardDueDateEvidence {
  dueAtIso: string;
  sourceDateText: string;
}

export interface AwardOwnerCandidate {
  userId: string;
  displayName: string;
  citation: BoundedSourceCitation;
}

export interface SourceBackedAwardObligation {
  id: string;
  title: string;
  kind: AwardObligationKind;
  reviewState: "accepted" | "proposed" | "rejected" | "superseded";
  citation: BoundedSourceCitation;
  dueDate?: AwardDueDateEvidence;
  ownerCandidate?: AwardOwnerCandidate;
  dependsOnObligationIds?: readonly string[];
}

export interface AwardHandoffProposalInput extends BoundedScope {
  awardId: string;
  asOfIso: string;
  obligations: readonly SourceBackedAwardObligation[];
}

export type AwardHandoffIssueCode =
  | "duplicate_obligation_id"
  | "obligation_not_accepted"
  | "obligation_citation_invalid"
  | "obligation_title_not_in_source"
  | "due_date_invalid"
  | "due_date_not_in_source"
  | "comparison_time_invalid"
  | "obligation_overdue"
  | "owner_candidate_invalid"
  | "dependency_unknown";

export interface AwardHandoffIssue {
  code: AwardHandoffIssueCode;
  obligationId: string;
  message: string;
}

export interface AwardDeliveryTaskProposal {
  proposalId: string;
  awardId: string;
  obligationId: string;
  kind: AwardObligationKind;
  title: string;
  sourceExcerpt: string;
  citation: BoundedSourceCitation;
  proposedDueAtIso: string | null;
  proposedOwnerId: string | null;
  dependsOnProposalIds: string[];
  approvalState: "proposed";
  actionClass: "internal_draft_task";
  externalCommitment: false;
}

export interface AwardHandoffProposalResult {
  proposals: AwardDeliveryTaskProposal[];
  issues: AwardHandoffIssue[];
  handoffAuthorized: false;
  safety: ProposalSafetyEnvelope;
}

const MAX_OBLIGATIONS = 1_000;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;

function validUtcInstant(value: string): boolean {
  return ISO_UTC.test(value) && Number.isFinite(Date.parse(value));
}

/**
 * Converts accepted award obligations into internal draft-task proposals. The
 * result does not create tasks, assign owners, accept delivery obligations, or
 * communicate externally.
 */
export function proposeAwardToDeliveryHandoff(
  input: AwardHandoffProposalInput,
): AwardHandoffProposalResult {
  assertBoundedItems("Award obligations", input.obligations, MAX_OBLIGATIONS);
  const issues: AwardHandoffIssue[] = [];
  const eligible = new Map<string, SourceBackedAwardObligation>();
  const seen = new Set<string>();

  for (const obligation of input.obligations) {
    if (seen.has(obligation.id)) {
      issues.push({
        code: "duplicate_obligation_id",
        obligationId: obligation.id,
        message: "Award obligation identifiers must be unique.",
      });
      continue;
    }
    seen.add(obligation.id);
    if (obligation.reviewState !== "accepted") {
      issues.push({
        code: "obligation_not_accepted",
        obligationId: obligation.id,
        message:
          "Only accepted award obligations can become handoff proposals.",
      });
      continue;
    }
    if (!isBoundedCitationValid(obligation.citation, input)) {
      issues.push({
        code: "obligation_citation_invalid",
        obligationId: obligation.id,
        message:
          "The award obligation citation is inactive, ungrounded, or outside scope.",
      });
      continue;
    }
    if (
      !normalizeBoundedText(obligation.citation.quote).includes(
        normalizeBoundedText(obligation.title),
      )
    ) {
      issues.push({
        code: "obligation_title_not_in_source",
        obligationId: obligation.id,
        message:
          "The proposed obligation title does not occur in its cited source quote.",
      });
      continue;
    }
    eligible.set(obligation.id, obligation);
  }

  const proposals: AwardDeliveryTaskProposal[] = [];
  for (const obligation of [...eligible.values()].sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    let proposedDueAtIso: string | null = null;
    if (obligation.dueDate) {
      if (!validUtcInstant(input.asOfIso)) {
        issues.push({
          code: "comparison_time_invalid",
          obligationId: obligation.id,
          message:
            "The supplied deterministic comparison time is not a valid UTC instant.",
        });
      }
      if (!validUtcInstant(obligation.dueDate.dueAtIso)) {
        issues.push({
          code: "due_date_invalid",
          obligationId: obligation.id,
          message: "The proposed due date is not a valid UTC instant.",
        });
      } else if (
        !normalizeBoundedText(obligation.citation.quote).includes(
          normalizeBoundedText(obligation.dueDate.sourceDateText),
        )
      ) {
        issues.push({
          code: "due_date_not_in_source",
          obligationId: obligation.id,
          message:
            "The proposed due date lacks exact support in the cited source quote.",
        });
      } else {
        proposedDueAtIso = obligation.dueDate.dueAtIso;
        if (
          validUtcInstant(input.asOfIso) &&
          Date.parse(input.asOfIso) > Date.parse(proposedDueAtIso)
        ) {
          issues.push({
            code: "obligation_overdue",
            obligationId: obligation.id,
            message:
              "The cited delivery obligation is already overdue at the supplied comparison time.",
          });
        }
      }
    }

    let proposedOwnerId: string | null = null;
    if (obligation.ownerCandidate) {
      const owner = obligation.ownerCandidate;
      if (
        !owner.userId.trim() ||
        !isBoundedCitationValid(owner.citation, input) ||
        !normalizeBoundedText(owner.citation.quote).includes(
          normalizeBoundedText(owner.displayName),
        )
      ) {
        issues.push({
          code: "owner_candidate_invalid",
          obligationId: obligation.id,
          message:
            "The owner candidate lacks accepted in-scope source support and remains unassigned.",
        });
      } else {
        proposedOwnerId = owner.userId;
      }
    }

    const dependsOnProposalIds: string[] = [];
    for (const dependencyId of obligation.dependsOnObligationIds ?? []) {
      if (!eligible.has(dependencyId)) {
        issues.push({
          code: "dependency_unknown",
          obligationId: obligation.id,
          message: `Dependency ${dependencyId} is not an eligible accepted obligation.`,
        });
      } else {
        dependsOnProposalIds.push(
          `award-handoff:${input.awardId}:${dependencyId}`,
        );
      }
    }

    proposals.push({
      proposalId: `award-handoff:${input.awardId}:${obligation.id}`,
      awardId: input.awardId,
      obligationId: obligation.id,
      kind: obligation.kind,
      title: obligation.title,
      sourceExcerpt: obligation.citation.quote,
      citation: obligation.citation,
      proposedDueAtIso,
      proposedOwnerId,
      dependsOnProposalIds: [...new Set(dependsOnProposalIds)].sort(),
      approvalState: "proposed",
      actionClass: "internal_draft_task",
      externalCommitment: false,
    });
  }

  return {
    proposals,
    issues,
    handoffAuthorized: false,
    safety: boundedProposalSafety(),
  };
}
