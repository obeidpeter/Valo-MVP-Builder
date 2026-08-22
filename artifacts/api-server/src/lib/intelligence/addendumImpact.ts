import {
  detectAddendumChanges,
  type AddendumRadarInput,
  type AddendumRadarResult,
} from "./addendumRadar";
import {
  deterministicId,
  hasBlockers,
  isIsoInstant,
  isValidId,
  reviewIsAccepted,
  sha256Text,
  sortIssues,
  type DomainIssue,
} from "./domain";

export const ADDENDUM_IMPACT_OBJECT_TYPES = [
  "requirement",
  "project",
  "work_task",
  "draft",
  "boq_check",
  "approval",
  "package",
  "report",
] as const;

export type AddendumImpactObjectType =
  (typeof ADDENDUM_IMPACT_OBJECT_TYPES)[number];

export const ADDENDUM_IMPACT_ACTIONS = [
  "reopen",
  "invalidate",
  "recheck",
] as const;

export type AddendumImpactAction = (typeof ADDENDUM_IMPACT_ACTIONS)[number];

export interface AddendumImpactTargetInput {
  readonly externalId: string;
  readonly objectType: AddendumImpactObjectType;
  readonly label: string;
  readonly currentState: string;
  readonly currentVersion: number;
  readonly dependsOnFieldExternalIds: readonly string[];
  readonly proposedAction: AddendumImpactAction;
}

export interface AddendumImpactInput extends Omit<
  AddendumRadarInput,
  "trackedArtifacts"
> {
  readonly targets: readonly AddendumImpactTargetInput[];
}

export interface AddendumDownstreamImpact {
  readonly targetId: string;
  readonly objectType: AddendumImpactObjectType;
  readonly label: string;
  readonly currentState: string;
  readonly currentVersion: number;
  readonly proposedAction: AddendumImpactAction;
  readonly changeIds: readonly string[];
  readonly fieldExternalIds: readonly string[];
}

export interface AddendumImpactAssessment {
  readonly assessmentId: string;
  readonly radarId: string;
  /** Immutable exact-source comparison identity; excludes mutable targets. */
  readonly sourceManifestSha256: string;
  /** Current version-bound downstream plan identity. */
  readonly impactManifestSha256: string;
  readonly status:
    | "blocked"
    | "no_changes"
    | "review_required"
    | "ready_to_reopen"
    | "reviewed_no_affected_work";
  readonly readyForReopening: boolean;
  readonly radar: AddendumRadarResult;
  readonly impacts: readonly AddendumDownstreamImpact[];
  readonly issues: readonly DomainIssue[];
}

export const ADDENDUM_REOPEN_CONFIRMATION = "REOPEN AFFECTED WORK";

export interface NamedAddendumReviewer {
  readonly reviewerId: string;
  readonly reviewerName: string;
  readonly reviewedAt: string;
}

export interface AddendumReopeningActor {
  readonly actorId: string;
  readonly actorName: string;
  readonly appliedAt: string;
}

export interface ControlledAddendumReopeningInput {
  readonly assessment: AddendumImpactAssessment;
  readonly expectedRadarId: string;
  readonly expectedImpactManifestSha256: string;
  readonly reason: string;
  readonly confirmation: string;
  readonly reviewer: NamedAddendumReviewer;
  readonly actor: AddendumReopeningActor;
}

export interface AddendumReopeningMutation {
  readonly targetId: string;
  readonly objectType: AddendumImpactObjectType;
  readonly expectedVersion: number;
  readonly fromState: string;
  readonly toState: "reopened" | "invalidated" | "review_required";
  readonly reason: string;
  readonly changeIds: readonly string[];
}

export type ControlledAddendumReopeningDenialCode =
  | "assessment_blocked"
  | "review_required"
  | "no_affected_work"
  | "stale_radar"
  | "stale_impact_manifest"
  | "reason_required"
  | "confirmation_required"
  | "named_review_required"
  | "named_actor_required"
  | "segregation_of_duties_required";

export type ControlledAddendumReopeningDecision =
  | {
      readonly allowed: false;
      readonly code: ControlledAddendumReopeningDenialCode;
      readonly message: string;
      readonly mutations: readonly [];
    }
  | {
      readonly allowed: true;
      readonly message: string;
      readonly mutations: readonly AddendumReopeningMutation[];
      readonly reviewedBy: NamedAddendumReviewer;
      readonly appliedBy: AddendumReopeningActor;
    };

function targetIssues(input: AddendumImpactInput): readonly DomainIssue[] {
  const issues: DomainIssue[] = [];
  const targetIds = new Set<string>();
  const knownFields = new Set([
    ...input.baseline.fields.map(({ externalId }) => externalId),
    ...input.revision.fields.map(({ externalId }) => externalId),
  ]);
  input.targets.forEach((target, index) => {
    const path = `targets[${index}]`;
    if (!isValidId(target.externalId) || targetIds.has(target.externalId)) {
      issues.push({
        code: "invalid_or_duplicate_impact_target",
        severity: "blocker",
        path,
        message: "Every downstream target requires a unique stable ID.",
      });
    }
    targetIds.add(target.externalId);
    if (
      !ADDENDUM_IMPACT_OBJECT_TYPES.includes(target.objectType) ||
      !ADDENDUM_IMPACT_ACTIONS.includes(target.proposedAction) ||
      !target.label.trim() ||
      !target.currentState.trim() ||
      !Number.isSafeInteger(target.currentVersion) ||
      target.currentVersion < 1 ||
      target.dependsOnFieldExternalIds.length === 0
    ) {
      issues.push({
        code: "invalid_impact_target",
        severity: "blocker",
        path,
        message:
          "A downstream target requires a type, label, state, positive version, action and field dependency.",
      });
    }
    if (
      new Set(target.dependsOnFieldExternalIds).size !==
      target.dependsOnFieldExternalIds.length
    ) {
      issues.push({
        code: "duplicate_impact_dependency",
        severity: "blocker",
        path: `${path}.dependsOnFieldExternalIds`,
        message: "A target may depend on each compared field only once.",
      });
    }
    target.dependsOnFieldExternalIds.forEach((fieldId) => {
      if (!knownFields.has(fieldId)) {
        issues.push({
          code: "unknown_impact_dependency",
          severity: "blocker",
          path: `${path}.dependsOnFieldExternalIds`,
          message:
            "A downstream dependency must name a field in the exact comparison.",
        });
      }
    });
  });
  return sortIssues(issues);
}

function stableSourceManifest(input: {
  radar: AddendumRadarResult;
  baseline: AddendumImpactInput["baseline"];
  revision: AddendumImpactInput["revision"];
}): string {
  return sha256Text(
    JSON.stringify({
      policy: "valo.addendum-impact/v1",
      baseline: [input.baseline.sourceId, input.baseline.sourceVersionId],
      revision: [input.revision.sourceId, input.revision.sourceVersionId],
      changes: input.radar.changes.map((change) => ({
        changeId: change.changeId,
        fieldExternalId: change.fieldExternalId,
        kind: change.kind,
        beforeValue: change.beforeValue ?? null,
        afterValue: change.afterValue ?? null,
        beforeCitationId: change.beforeCitation?.citationId ?? null,
        afterCitationId: change.afterCitation?.citationId ?? null,
      })),
    }),
  );
}

function stableImpactManifest(input: {
  sourceManifestSha256: string;
  impacts: readonly AddendumDownstreamImpact[];
}): string {
  return sha256Text(
    JSON.stringify({
      policy: "valo.addendum-impact/v1",
      sourceManifestSha256: input.sourceManifestSha256,
      impacts: input.impacts.map((impact) => ({
        targetId: impact.targetId,
        objectType: impact.objectType,
        currentState: impact.currentState,
        currentVersion: impact.currentVersion,
        proposedAction: impact.proposedAction,
        changeIds: impact.changeIds,
      })),
    }),
  );
}

/**
 * Produces a deterministic, review-only impact assessment. Detection never
 * mutates a requirement, task, draft, approval, package or report.
 */
export function buildAddendumImpactAssessment(
  input: AddendumImpactInput,
): AddendumImpactAssessment {
  const issues = [...targetIssues(input)];
  const radar = detectAddendumChanges({
    ...input,
    trackedArtifacts: input.targets.map((target) => ({
      externalId: target.externalId,
      label: target.label,
      dependsOnFieldExternalIds: target.dependsOnFieldExternalIds,
    })),
  });
  issues.push(...radar.issues);

  const changeByTarget = new Map<string, AddendumRadarResult["changes"]>();
  radar.changes.forEach((change) => {
    change.affectedArtifactIds.forEach((targetId) => {
      const current = changeByTarget.get(targetId) ?? [];
      changeByTarget.set(targetId, [...current, change]);
    });
  });
  const impacts = input.targets
    .flatMap((target): AddendumDownstreamImpact[] => {
      const changes = changeByTarget.get(target.externalId) ?? [];
      if (changes.length === 0) return [];
      return [
        {
          targetId: target.externalId,
          objectType: target.objectType,
          label: target.label,
          currentState: target.currentState,
          currentVersion: target.currentVersion,
          proposedAction: target.proposedAction,
          changeIds: changes.map(({ changeId }) => changeId).sort(),
          fieldExternalIds: changes
            .map(({ fieldExternalId }) => fieldExternalId)
            .sort(),
        },
      ];
    })
    .sort((left, right) =>
      `${left.objectType}:${left.targetId}`.localeCompare(
        `${right.objectType}:${right.targetId}`,
      ),
    );
  const sortedIssues = sortIssues(issues);
  const sourceManifestSha256 = stableSourceManifest({
    radar,
    baseline: input.baseline,
    revision: input.revision,
  });
  const impactManifestSha256 = stableImpactManifest({
    sourceManifestSha256,
    impacts,
  });
  const assessmentId = deterministicId("addimpact", {
    radarId: radar.radarId,
    impactManifestSha256,
  });
  const readyForReopening =
    !hasBlockers(sortedIssues) && radar.readyForUse && impacts.length > 0;
  const status: AddendumImpactAssessment["status"] = hasBlockers(sortedIssues)
    ? "blocked"
    : radar.changes.length === 0
      ? "no_changes"
      : !radar.readyForUse
        ? "review_required"
        : impacts.length === 0
          ? "reviewed_no_affected_work"
          : "ready_to_reopen";

  return {
    assessmentId,
    radarId: radar.radarId,
    sourceManifestSha256,
    impactManifestSha256,
    status,
    readyForReopening,
    radar,
    impacts,
    issues: sortedIssues,
  };
}

function deny(
  code: ControlledAddendumReopeningDenialCode,
  message: string,
): ControlledAddendumReopeningDecision {
  return { allowed: false, code, message, mutations: [] };
}

function validName(value: string): boolean {
  return value.trim().length >= 2 && value.trim().length <= 200;
}

/**
 * Authorises an explicit reopening plan; persistence belongs to the caller.
 * A caller must re-read and compare every optimistic target version, apply the
 * returned mutations and append audit evidence in one transaction.
 */
export function authoriseControlledAddendumReopening(
  input: ControlledAddendumReopeningInput,
): ControlledAddendumReopeningDecision {
  if (hasBlockers(input.assessment.issues)) {
    return deny(
      "assessment_blocked",
      "The addendum assessment contains blocking evidence errors.",
    );
  }
  if (!input.assessment.radar.readyForUse) {
    return deny(
      "review_required",
      "Every detected change and the whole comparison require acceptance by a named reviewer.",
    );
  }
  if (input.assessment.impacts.length === 0) {
    return deny(
      "no_affected_work",
      "The reviewed comparison does not identify downstream work to reopen.",
    );
  }
  if (input.expectedRadarId !== input.assessment.radarId) {
    return deny(
      "stale_radar",
      "The compared addendum changed; reload it before reopening work.",
    );
  }
  if (
    input.expectedImpactManifestSha256 !== input.assessment.impactManifestSha256
  ) {
    return deny(
      "stale_impact_manifest",
      "The downstream impact plan changed; reload it before reopening work.",
    );
  }
  if (!input.reason.trim() || input.reason.trim().length > 2_000) {
    return deny(
      "reason_required",
      "A bounded recorded reason is required for controlled reopening.",
    );
  }
  if (input.confirmation !== ADDENDUM_REOPEN_CONFIRMATION) {
    return deny(
      "confirmation_required",
      `Type ${ADDENDUM_REOPEN_CONFIRMATION} to confirm the exact reviewed plan.`,
    );
  }
  const radarReview = input.assessment.radar.review;
  if (
    !reviewIsAccepted(radarReview) ||
    !isValidId(input.reviewer.reviewerId) ||
    !validName(input.reviewer.reviewerName) ||
    !isIsoInstant(input.reviewer.reviewedAt) ||
    radarReview.reviewerId !== input.reviewer.reviewerId ||
    radarReview.reviewedAt !== input.reviewer.reviewedAt
  ) {
    return deny(
      "named_review_required",
      "The accepted comparison must retain the current named reviewer stamp.",
    );
  }
  if (
    !isValidId(input.actor.actorId) ||
    !validName(input.actor.actorName) ||
    !isIsoInstant(input.actor.appliedAt)
  ) {
    return deny(
      "named_actor_required",
      "The person applying the reviewed plan must have a valid named identity.",
    );
  }
  if (input.reviewer.reviewerId === input.actor.actorId) {
    return deny(
      "segregation_of_duties_required",
      "The person applying the plan must be different from the named reviewer.",
    );
  }

  const toState: Record<
    AddendumImpactAction,
    AddendumReopeningMutation["toState"]
  > = {
    reopen: "reopened",
    invalidate: "invalidated",
    recheck: "review_required",
  };
  return {
    allowed: true,
    message:
      "The named review authorises only the listed version-bound mutations. No other work may be changed.",
    reviewedBy: input.reviewer,
    appliedBy: input.actor,
    mutations: input.assessment.impacts.map((impact) => ({
      targetId: impact.targetId,
      objectType: impact.objectType,
      expectedVersion: impact.currentVersion,
      fromState: impact.currentState,
      toState: toState[impact.proposedAction],
      reason: input.reason.trim(),
      changeIds: impact.changeIds,
    })),
  };
}
