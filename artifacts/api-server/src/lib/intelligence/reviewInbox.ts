import {
  INTELLIGENCE_CAPABILITY_IDS,
  type IntelligenceCapabilityId,
  type IntelligenceCentreSnapshot,
} from "./snapshot";

export const INTELLIGENCE_REVIEW_STATUSES = [
  "pending",
  "in_review",
  "changes_requested",
  "approved",
  "rejected",
] as const;

export type IntelligenceReviewStatus =
  (typeof INTELLIGENCE_REVIEW_STATUSES)[number];

export type IntelligenceReviewPriority = "critical" | "high" | "normal" | "low";

export interface IntelligenceReviewRecord {
  id: string;
  projectId: string;
  reviewType: string;
  objectType: string;
  objectId: string;
  reviewerUserId: string;
  reviewerName: string | null;
  status: string;
  sourceVersion: number;
  sourceManifestHash: string | null;
  findingsValid: boolean;
  findingsDecision: IntelligenceReviewStatus | null;
  version: number;
  completedAt: string | null;
  updatedAt: string | null;
}

export interface IntelligenceReviewInboxItem {
  id: string;
  capabilityId: IntelligenceCapabilityId;
  title: string;
  summary: string;
  status: IntelligenceReviewStatus;
  priority: IntelligenceReviewPriority;
  reviewType: string;
  reviewerName: string | null;
  assignedToCurrentUser: boolean;
  dueAt: string | null;
  sourceCount: number;
  staleSource: boolean;
  href: string | null;
  sourceVersion: number;
  reviewVersion: number | null;
}

export interface IntelligenceReviewInbox {
  projectId: string;
  generatedAt: string;
  environment: IntelligenceCentreSnapshot["environment"];
  productionAiEnabled: boolean;
  sourceVersion: number;
  sourceManifestSha256: string;
  readOnly: boolean;
  authorityNote: string;
  counts: Record<IntelligenceReviewStatus, number>;
  items: IntelligenceReviewInboxItem[];
}

const CAPABILITY_TITLES: Readonly<Record<IntelligenceCapabilityId, string>> = {
  evidence_graph: "Evidence Graph",
  addendum_radar: "Addendum & Deadline Radar",
  eligibility_passport: "Tender Eligibility Passport",
  grounded_copilot: "Grounded Tender Copilot",
  opportunity_radar: "Opportunity Radar",
  response_studio: "Citation-first Response Studio",
  submission_preflight: "Submission Pack Preflight",
  clarification_assistant: "Clarification Question Assistant",
  boq_sanity: "BOQ & Commercial Sanity Checker",
  award_handoff: "Award-to-Delivery Handoff",
  evaluation_score_planner: "Published-Evaluation Score Planner",
  bid_security_integrity: "Bid Security & Guarantee Integrity Desk",
  regulatory_watchtower: "Regulatory Rule-Pack Watchtower",
  consortium_responsibility: "JV / Consortium Responsibility Matrix",
  portal_submission_rehearsal: "Portal Submission Rehearsal & Form Mapper",
  commercial_exposure: "Commercial Assumption & Cashflow Exposure Simulator",
  nigerian_content_composer: "Nigerian-Content Evidence Composer",
  personnel_tailoring: "Past-Performance & Key-Personnel Tailoring Studio",
  contract_deviation: "Tender-to-Contract Deviation Desk",
  critical_path_simulator: "Pursuit Critical-Path & Capacity Simulator",
  integrity_sentinel: "Procurement-Integrity & Conflict Sentinel",
  outcome_learning: "Outcome Learning & Repeat-Defect Coach",
};

const DEADLINE_CRITICAL_CAPABILITIES = new Set<IntelligenceCapabilityId>([
  "addendum_radar",
  "eligibility_passport",
  "submission_preflight",
  "bid_security_integrity",
  "portal_submission_rehearsal",
  "critical_path_simulator",
]);

const PRIORITY_ORDER: Readonly<Record<IntelligenceReviewPriority, number>> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

const MAX_REVIEWER_NAME_CODE_UNITS = 512;
const OPAQUE_REVIEWER_NAMES = new Set(["assigned reviewer"]);

function validNamedReviewer(value: string | null): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return (
    value === trimmed &&
    value.length >= 1 &&
    value.length <= MAX_REVIEWER_NAME_CODE_UNITS &&
    !/^[\p{White_Space}\p{Cf}]*$/u.test(value) &&
    !/[\p{Cc}\p{Cs}]/u.test(value) &&
    !OPAQUE_REVIEWER_NAMES.has(value.toLocaleLowerCase("en-US"))
  );
}

function reviewType(capabilityId: IntelligenceCapabilityId): string {
  return `intelligence.${capabilityId}`;
}

export function isIntelligenceReviewStatus(
  value: unknown,
): value is IntelligenceReviewStatus {
  return (
    typeof value === "string" &&
    (INTELLIGENCE_REVIEW_STATUSES as readonly string[]).includes(value)
  );
}

export function intelligenceCapabilityFromReviewType(
  value: string,
): IntelligenceCapabilityId | null {
  const prefix = "intelligence.";
  if (!value.startsWith(prefix)) return null;
  const candidate = value.slice(prefix.length);
  return (INTELLIGENCE_CAPABILITY_IDS as readonly string[]).includes(candidate)
    ? (candidate as IntelligenceCapabilityId)
    : null;
}

function validDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function priorityFor(
  capabilityId: IntelligenceCapabilityId,
  state: IntelligenceCentreSnapshot["capabilities"][number]["state"],
  deadline: Date | null,
  now: Date,
): IntelligenceReviewPriority {
  const hoursToDeadline = deadline
    ? (deadline.getTime() - now.getTime()) / 3_600_000
    : null;
  if (
    DEADLINE_CRITICAL_CAPABILITIES.has(capabilityId) &&
    hoursToDeadline != null &&
    hoursToDeadline >= 0 &&
    hoursToDeadline <= 72 &&
    (state === "review_ready" || state === "partial")
  ) {
    return "critical";
  }
  if (state === "review_ready") return "high";
  if (state === "partial") return "normal";
  return "low";
}

function isStaleReason(reason: string): boolean {
  return /\b(stale|superseded|expired|outdated|newer version)\b/iu.test(reason);
}

function emptyCounts(): Record<IntelligenceReviewStatus, number> {
  return {
    pending: 0,
    in_review: 0,
    changes_requested: 0,
    approved: 0,
    rejected: 0,
  };
}

function reviewLifecycleIsCoherent(review: IntelligenceReviewRecord): boolean {
  if (!review.findingsValid || !validNamedReviewer(review.reviewerName)) {
    return false;
  }
  if (review.status === "pending" || review.status === "in_review") {
    return review.findingsDecision === null && review.completedAt === null;
  }
  if (
    review.status === "changes_requested" ||
    review.status === "approved" ||
    review.status === "rejected"
  ) {
    return (
      review.findingsDecision === review.status &&
      validDate(review.completedAt) !== null
    );
  }
  return false;
}

export function buildIntelligenceReviewInbox(input: {
  snapshot: IntelligenceCentreSnapshot;
  reviews: readonly IntelligenceReviewRecord[];
  sourceVersion: number;
  sourceManifestSha256: string;
  actorUserId: string;
  now?: Date;
  readOnly?: boolean;
}): IntelligenceReviewInbox {
  const now = input.now ?? new Date();
  const projectId = input.snapshot.project.id;
  const deadline = validDate(input.snapshot.project.deadline);
  const reviewByCapability = new Map<
    IntelligenceCapabilityId,
    IntelligenceReviewRecord
  >();
  const duplicateCapabilities = new Set<IntelligenceCapabilityId>();

  for (const review of input.reviews) {
    const capabilityId = intelligenceCapabilityFromReviewType(
      review.reviewType,
    );
    if (
      !capabilityId ||
      review.projectId !== projectId ||
      review.objectType !== "intelligence_capability" ||
      review.objectId !== projectId ||
      review.sourceVersion < 1 ||
      review.version < 1
    ) {
      continue;
    }
    const current = reviewByCapability.get(capabilityId);
    if (current) duplicateCapabilities.add(capabilityId);
    if (
      !current ||
      review.version > current.version ||
      (review.version === current.version &&
        review.id.localeCompare(current.id) > 0)
    ) {
      reviewByCapability.set(capabilityId, review);
    }
  }

  const items = input.snapshot.capabilities.map((capability) => {
    const review = reviewByCapability.get(capability.id);
    const duplicateReview = duplicateCapabilities.has(capability.id);
    const reviewIsCoherent = review ? reviewLifecycleIsCoherent(review) : false;
    const reviewIsStale = Boolean(
      review &&
      (duplicateReview ||
        !reviewIsCoherent ||
        review.sourceVersion !== input.sourceVersion ||
        review.sourceManifestHash !== input.sourceManifestSha256),
    );
    const status =
      review && !reviewIsStale && isIntelligenceReviewStatus(review.status)
        ? review.status
        : "pending";
    return {
      id: review?.id ?? `review:${projectId}:${capability.id}`,
      capabilityId: capability.id,
      title: CAPABILITY_TITLES[capability.id],
      summary: capability.stateReason,
      status,
      priority: priorityFor(capability.id, capability.state, deadline, now),
      reviewType: reviewType(capability.id),
      reviewerName: reviewIsStale ? null : (review?.reviewerName ?? null),
      assignedToCurrentUser: Boolean(
        review &&
        !reviewIsStale &&
        status === "in_review" &&
        review.reviewerUserId === input.actorUserId,
      ),
      dueAt: input.snapshot.project.deadline,
      sourceCount: Math.max(0, capability.citationCount ?? 0),
      staleSource: reviewIsStale || isStaleReason(capability.stateReason),
      href: `/intelligence?project=${encodeURIComponent(projectId)}#capability-${capability.id}`,
      sourceVersion: input.sourceVersion,
      reviewVersion: review?.version ?? null,
    } satisfies IntelligenceReviewInboxItem;
  });

  items.sort((left, right) => {
    const priority =
      PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority];
    if (priority !== 0) return priority;
    const leftDue = validDate(left.dueAt)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const rightDue =
      validDate(right.dueAt)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    if (leftDue !== rightDue) return leftDue - rightDue;
    return left.capabilityId.localeCompare(right.capabilityId);
  });

  const counts = emptyCounts();
  for (const item of items) counts[item.status] += 1;

  return {
    projectId,
    generatedAt: input.snapshot.generatedAt,
    environment: input.snapshot.environment,
    productionAiEnabled: input.snapshot.productionAiEnabled,
    sourceVersion: input.sourceVersion,
    sourceManifestSha256: input.sourceManifestSha256,
    readOnly: input.readOnly ?? true,
    authorityNote:
      "Review status records a named person's assessment of a deterministic intelligence item. It does not approve evidence, waive a finding, release a package or authorise model execution.",
    counts,
    items,
  };
}
