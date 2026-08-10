import {
  deterministicId,
  hasBlockers,
  isIsoDate,
  isValidId,
  reviewIsAccepted,
  sortIssues,
  UNREVIEWED,
  validateCitation,
  validateHumanReview,
  type DomainIssue,
  type ExactCitation,
  type GroundedCitation,
  type HumanReview,
  type SourceDocument,
} from "./domain";
import {
  NEXT_CAPABILITY_MAX_ITEMS,
  boundedNextCapabilityRecordKeys,
  nextCapabilitySafety,
  validateNextCapabilityCollection,
  validateNextCapabilitySources,
  validateNextCapabilityText,
  type NextCapabilitySafetyEnvelope,
} from "./nextCapabilityContracts";

export interface PursuitMilestoneInput {
  readonly externalId: string;
  readonly label: string;
  readonly durationDays: number;
  readonly targetFinishDate: string;
  readonly dependencyExternalIds: readonly string[];
  readonly resourceId?: string;
  readonly citation: ExactCitation;
  readonly review: HumanReview;
}

export interface CriticalPathSimulatorInput {
  readonly asOfDate: string;
  readonly sources: readonly SourceDocument[];
  readonly milestones: readonly PursuitMilestoneInput[];
  readonly scenarioReviews?: Readonly<Record<string, HumanReview>>;
}

export interface ScheduledMilestoneProposal {
  readonly proposalId: string;
  readonly milestoneExternalId: string;
  readonly earliestStartDate: string;
  readonly earliestFinishDate: string;
  readonly targetFinishDate: string;
  readonly lateByDays: number;
  readonly dependencyProposalIds: readonly string[];
  readonly resourceId?: string;
  readonly citation: GroundedCitation;
  readonly review: HumanReview;
  readonly changesApplied: false;
}

export interface ResourceConflictSignal {
  readonly resourceId: string;
  readonly proposalIds: readonly [string, string];
  readonly overlapStartDate: string;
  readonly overlapFinishDate: string;
}

export interface CriticalPathSimulationResult {
  readonly simulationId: string;
  readonly status: "blocked" | "review_required" | "ready";
  readonly readyForUse: boolean;
  readonly proposals: readonly ScheduledMilestoneProposal[];
  readonly criticalPathProposalIds: readonly string[];
  readonly resourceConflicts: readonly ResourceConflictSignal[];
  readonly issues: readonly DomainIssue[];
  readonly safety: NextCapabilitySafetyEnvelope;
  readonly taskMutationAuthority: "none";
}

function addDays(date: string, days: number): string {
  const result = new Date(`${date}T00:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

function differenceDays(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) /
      86_400_000,
  );
}

const MAX_DEPENDENCIES_PER_MILESTONE = 50;

function containsDomainToken(text: string, value: string): boolean {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9])${escaped}($|[^A-Za-z0-9])`, "u").test(
    text,
  );
}

function citationBindsMilestone(
  milestone: PursuitMilestoneInput,
  citation: GroundedCitation,
): boolean {
  const quote = citation.quote.toLowerCase();
  const dependenciesBound = milestone.dependencyExternalIds.length
    ? milestone.dependencyExternalIds.every((dependencyId) =>
        containsDomainToken(quote, dependencyId.toLowerCase()),
      )
    : quote.includes("dependencies none") || quote.includes("no dependencies");
  const resourceBound = milestone.resourceId
    ? containsDomainToken(quote, milestone.resourceId.toLowerCase())
    : quote.includes("resource none") || quote.includes("no resource");
  return (
    quote.includes(milestone.label.trim().toLowerCase()) &&
    containsDomainToken(quote, milestone.targetFinishDate) &&
    (new RegExp(`\\bduration\\s+${milestone.durationDays}(?:\\D|$)`, "u").test(
      quote,
    ) ||
      new RegExp(`\\b${milestone.durationDays}\\s+days?\\b`, "u").test(
        quote,
      )) &&
    dependenciesBound &&
    resourceBound
  );
}

/** Builds a bounded schedule scenario; it never changes owners, tasks or dates. */
export function simulatePursuitCriticalPath(
  input: CriticalPathSimulatorInput,
): CriticalPathSimulationResult {
  const { sourceSet, issues: sourceIssues } = validateNextCapabilitySources(
    input.sources,
    "Critical-path sources",
  );
  const milestoneInputs = input.milestones.slice(0, NEXT_CAPABILITY_MAX_ITEMS);
  const issues: DomainIssue[] = [
    ...sourceIssues,
    ...validateNextCapabilityCollection(
      input.milestones,
      "milestones",
      "Milestones",
    ),
  ];
  if (!isIsoDate(input.asOfDate)) {
    issues.push({
      code: "invalid_simulation_date",
      severity: "blocker",
      path: "asOfDate",
      message: "Critical-path simulation requires a valid ISO date.",
    });
  }
  const records = new Map<
    string,
    PursuitMilestoneInput & { readonly citation: GroundedCitation }
  >();
  milestoneInputs.forEach((unboundedMilestone, index) => {
    const dependencyIssues = validateNextCapabilityCollection(
      unboundedMilestone.dependencyExternalIds,
      `milestones[${index}].dependencyExternalIds`,
      "Milestone dependencies",
      MAX_DEPENDENCIES_PER_MILESTONE,
    );
    const milestone: PursuitMilestoneInput = {
      ...unboundedMilestone,
      dependencyExternalIds: [
        ...unboundedMilestone.dependencyExternalIds.slice(
          0,
          MAX_DEPENDENCIES_PER_MILESTONE,
        ),
      ].sort(),
    };
    const path = `milestones[${index}]`;
    const citation = validateCitation(
      milestone.citation,
      sourceSet.byKey,
      `${path}.citation`,
    );
    const local: DomainIssue[] = [
      ...dependencyIssues,
      ...citation.issues,
      ...validateHumanReview(milestone.review, `${path}.review`),
      ...validateNextCapabilityText(
        milestone.label,
        `${path}.label`,
        "Milestone label",
      ),
    ];
    if (
      new Set(milestone.dependencyExternalIds).size !==
      milestone.dependencyExternalIds.length
    ) {
      local.push({
        code: "duplicate_milestone_dependency",
        severity: "blocker",
        path: `${path}.dependencyExternalIds`,
        message: "Milestone dependency IDs must be unique.",
      });
    }
    if (
      !Number.isInteger(milestone.durationDays) ||
      milestone.durationDays < 0 ||
      milestone.durationDays > 3650 ||
      !isIsoDate(milestone.targetFinishDate)
    ) {
      local.push({
        code: "invalid_milestone_timing",
        severity: "blocker",
        path,
        message:
          "Milestones require a valid target date and a bounded integer duration.",
      });
    }
    if (
      citation.citation &&
      (citation.citation.sourceAuthority === "unverified" ||
        !citationBindsMilestone(milestone, citation.citation))
    ) {
      local.push({
        code: "milestone_fields_not_cited",
        severity: "blocker",
        path: `${path}.citation`,
        message:
          "The exact citation must bind the milestone label, duration, target, dependencies, resource and verified provenance.",
      });
    }
    if (
      !isValidId(milestone.externalId) ||
      (milestone.resourceId != null && !isValidId(milestone.resourceId))
    ) {
      local.push({
        code: "invalid_milestone_identity",
        severity: "blocker",
        path,
        message:
          "Milestone and optional resource IDs must be stable domain IDs.",
      });
    }
    if (records.has(milestone.externalId)) {
      local.push({
        code: "duplicate_milestone_id",
        severity: "blocker",
        path: `${path}.externalId`,
        message: "Milestone IDs must be unique within a simulation.",
      });
    }
    issues.push(...local);
    if (
      !local.some((issue) => issue.severity === "blocker") &&
      citation.citation &&
      reviewIsAccepted(milestone.review)
    ) {
      records.set(milestone.externalId, {
        ...milestone,
        citation: citation.citation,
      });
    }
  });

  for (const milestone of records.values()) {
    for (const dependencyId of milestone.dependencyExternalIds) {
      if (!records.has(dependencyId) || dependencyId === milestone.externalId) {
        issues.push({
          code: "invalid_milestone_dependency",
          severity: "blocker",
          path: `milestones.${milestone.externalId}.dependencyExternalIds`,
          message:
            "Dependencies must refer to another accepted milestone in this simulation.",
        });
      }
    }
  }

  const state = new Map<string, "visiting" | "done">();
  const order: string[] = [];
  const visit = (id: string) => {
    if (state.get(id) === "done") return;
    if (state.get(id) === "visiting") {
      issues.push({
        code: "milestone_dependency_cycle",
        severity: "blocker",
        path: `milestones.${id}.dependencyExternalIds`,
        message: "The milestone dependency graph contains a cycle.",
      });
      return;
    }
    state.set(id, "visiting");
    for (const dependencyId of records.get(id)?.dependencyExternalIds ?? []) {
      if (records.has(dependencyId)) visit(dependencyId);
    }
    state.set(id, "done");
    order.push(id);
  };
  for (const id of [...records.keys()].sort()) visit(id);

  const proposalsByMilestone = new Map<string, ScheduledMilestoneProposal>();
  if (!hasBlockers(issues)) {
    for (const id of order) {
      const milestone = records.get(id)!;
      const dependencies = milestone.dependencyExternalIds
        .map((dependencyId) => proposalsByMilestone.get(dependencyId))
        .filter((value): value is ScheduledMilestoneProposal => Boolean(value));
      const earliestStartDate = dependencies.reduce(
        (latest, dependency) =>
          dependency.earliestFinishDate > latest
            ? dependency.earliestFinishDate
            : latest,
        input.asOfDate,
      );
      const earliestFinishDate = addDays(
        earliestStartDate,
        milestone.durationDays,
      );
      const proposalId = deterministicId("schedule", {
        milestoneExternalId: milestone.externalId,
        earliestStartDate,
        earliestFinishDate,
        targetFinishDate: milestone.targetFinishDate,
        dependencyIds: dependencies
          .map((dependency) => dependency.proposalId)
          .sort(),
        resourceId: milestone.resourceId,
        citationId: milestone.citation.citationId,
        label: milestone.label,
        milestoneReview: milestone.review,
      });
      const review = input.scenarioReviews?.[proposalId] ?? UNREVIEWED;
      issues.push(
        ...validateHumanReview(review, `scenarioReviews.${proposalId}`),
      );
      proposalsByMilestone.set(id, {
        proposalId,
        milestoneExternalId: milestone.externalId,
        earliestStartDate,
        earliestFinishDate,
        targetFinishDate: milestone.targetFinishDate,
        lateByDays: Math.max(
          0,
          differenceDays(milestone.targetFinishDate, earliestFinishDate),
        ),
        dependencyProposalIds: dependencies
          .map((dependency) => dependency.proposalId)
          .sort(),
        resourceId: milestone.resourceId,
        citation: milestone.citation,
        review,
        changesApplied: false,
      });
    }
  }
  const proposals = [...proposalsByMilestone.values()];
  const resourceConflicts: ResourceConflictSignal[] = [];
  let resourceConflictOverflow = false;
  conflictScan: for (
    let leftIndex = 0;
    leftIndex < proposals.length;
    leftIndex += 1
  ) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < proposals.length;
      rightIndex += 1
    ) {
      const left = proposals[leftIndex]!;
      const right = proposals[rightIndex]!;
      if (!left.resourceId || left.resourceId !== right.resourceId) continue;
      const overlapStartDate =
        left.earliestStartDate > right.earliestStartDate
          ? left.earliestStartDate
          : right.earliestStartDate;
      const overlapFinishDate =
        left.earliestFinishDate < right.earliestFinishDate
          ? left.earliestFinishDate
          : right.earliestFinishDate;
      if (overlapStartDate < overlapFinishDate) {
        if (resourceConflicts.length >= NEXT_CAPABILITY_MAX_ITEMS) {
          resourceConflictOverflow = true;
          break conflictScan;
        }
        resourceConflicts.push({
          resourceId: left.resourceId,
          proposalIds: [left.proposalId, right.proposalId].sort() as [
            string,
            string,
          ],
          overlapStartDate,
          overlapFinishDate,
        });
      }
    }
  }
  if (resourceConflictOverflow) {
    issues.push({
      code: "resource_conflict_limit_exceeded",
      severity: "blocker",
      path: "resourceConflicts",
      message:
        "The schedule produces more resource conflicts than the bounded review surface can represent.",
    });
  }
  resourceConflicts.sort((left, right) =>
    `${left.resourceId}:${left.proposalIds.join(":")}`.localeCompare(
      `${right.resourceId}:${right.proposalIds.join(":")}`,
    ),
  );
  const scenarioReviewKeys = boundedNextCapabilityRecordKeys(
    input.scenarioReviews,
    "scenarioReviews",
    "Schedule reviews",
  );
  issues.push(...scenarioReviewKeys.issues);
  for (const proposalId of scenarioReviewKeys.keys) {
    if (!proposals.some((proposal) => proposal.proposalId === proposalId)) {
      issues.push({
        code: "orphan_schedule_review",
        severity: "blocker",
        path: `scenarioReviews.${proposalId}`,
        message:
          "A schedule review must bind to a proposal in this exact simulation.",
      });
    }
  }
  const terminal = proposals.reduce<ScheduledMilestoneProposal | undefined>(
    (latest, proposal) =>
      !latest || proposal.earliestFinishDate > latest.earliestFinishDate
        ? proposal
        : latest,
    undefined,
  );
  const criticalIds: string[] = [];
  let current = terminal;
  while (current) {
    criticalIds.unshift(current.proposalId);
    const dependencies = current.dependencyProposalIds
      .map((id) => proposals.find((proposal) => proposal.proposalId === id))
      .filter((value): value is ScheduledMilestoneProposal => Boolean(value));
    current = dependencies.reduce<ScheduledMilestoneProposal | undefined>(
      (latest, dependency) =>
        !latest || dependency.earliestFinishDate > latest.earliestFinishDate
          ? dependency
          : latest,
      undefined,
    );
  }
  const simulationId = deterministicId("pathsim", {
    asOfDate: input.asOfDate,
    proposalIds: proposals.map((proposal) => proposal.proposalId).sort(),
  });
  const sortedIssues = sortIssues(issues);
  const blocked = hasBlockers(sortedIssues);
  const readyForUse =
    !blocked &&
    proposals.length > 0 &&
    resourceConflicts.length === 0 &&
    proposals.every((proposal) => reviewIsAccepted(proposal.review));
  return {
    simulationId,
    status: blocked ? "blocked" : readyForUse ? "ready" : "review_required",
    readyForUse,
    proposals,
    criticalPathProposalIds: criticalIds,
    resourceConflicts,
    issues: sortedIssues,
    safety: nextCapabilitySafety(),
    taskMutationAuthority: "none",
  };
}
