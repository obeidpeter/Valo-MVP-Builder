import type {
  AddendumImpactAssessment,
  AddendumImpactInput,
  AddendumReopeningMutation,
} from "./addendumImpact";

export const ADDENDUM_IMPACT_POLICY_VERSION = "valo.addendum-impact/v1";
export const ADDENDUM_IMPACT_AUTHORITY_NOTE =
  "We follow the verified addendum chain without changing work. Existing values keep their original source, and removals need an exact instruction. One person reviews the plan; another confirms any reopening.";

export const ADDENDUM_IMPACT_BOUNDS = Object.freeze({
  sources: 64,
  fieldsPerVersion: 512,
  targets: 2_048,
  sourceCodeUnitsPerVersion: 2_000_000,
  sourceBytesPerVersion: 4_000_000,
  reasonCodeUnits: 2_000,
  reviewerNameCodeUnits: 200,
});

export interface AddendumImpactScope {
  readonly organisationId: string;
  readonly actorUserId: string;
  readonly actorName: string;
  readonly source: "membership" | "partner";
  readonly membershipId: string | null;
}

export interface AddendumSourceVersionSummary {
  readonly documentId: string;
  readonly documentVersionId: string;
  readonly filename: string;
  readonly versionNumber: number;
  readonly sha256: string;
  readonly capturedAt: string;
}

export type AddendumImpactReviewDecision =
  | "accepted"
  | "changes_requested"
  | "rejected";

export interface StoredAddendumImpactReview {
  readonly assessmentId: string;
  readonly impactManifestSha256: string;
  readonly decision: AddendumImpactReviewDecision;
  readonly reason: string;
  readonly reviewerUserId: string;
  readonly reviewerName: string;
  readonly reviewedAt: string;
  readonly version: number;
}

export interface StoredAddendumImpactApplication {
  readonly assessmentId: string;
  readonly impactManifestSha256: string;
  readonly appliedByUserId: string;
  readonly appliedByName: string;
  readonly appliedAt: string;
  readonly reason: string;
  readonly mutationCount: number;
}

export interface AddendumImpactRepositorySnapshot {
  readonly organisationId: string;
  readonly projectId: string;
  readonly projectTitle: string;
  readonly baseline: AddendumSourceVersionSummary;
  readonly revision: AddendumSourceVersionSummary;
  /** Raw comparison; repository implementations must not inject review state. */
  readonly comparison: AddendumImpactInput;
  readonly assessmentVersion: number;
  readonly review: StoredAddendumImpactReview | null;
  readonly application: StoredAddendumImpactApplication | null;
}

export interface AddendumImpactSelection {
  readonly baselineVersionId?: string;
  readonly revisionVersionId?: string;
}

export interface RecordAddendumImpactReviewInput {
  readonly scope: AddendumImpactScope;
  readonly projectId: string;
  readonly baselineDocumentVersionId: string;
  readonly revisionDocumentVersionId: string;
  readonly expectedAssessmentVersion: number;
  readonly assessmentId: string;
  readonly radarId: string;
  readonly impactManifestSha256: string;
  readonly decision: AddendumImpactReviewDecision;
  readonly reason: string;
  readonly reviewedAt: string;
  readonly assessment: AddendumImpactAssessment;
}

export interface ApplyAddendumImpactInput {
  readonly scope: AddendumImpactScope;
  readonly projectId: string;
  readonly baselineDocumentVersionId: string;
  readonly revisionDocumentVersionId: string;
  readonly expectedAssessmentVersion: number;
  readonly assessmentId: string;
  readonly radarId: string;
  readonly sourceManifestSha256: string;
  readonly impactManifestSha256: string;
  readonly reason: string;
  readonly appliedAt: string;
  readonly review: StoredAddendumImpactReview;
  readonly mutations: readonly AddendumReopeningMutation[];
}

export interface FindAddendumImpactApplicationReplayInput {
  readonly scope: AddendumImpactScope;
  readonly projectId: string;
  readonly baselineDocumentVersionId: string;
  readonly revisionDocumentVersionId: string;
  readonly expectedAssessmentVersion: number;
  readonly assessmentId: string;
  readonly radarId: string;
  readonly impactManifestSha256: string;
  readonly reason: string;
}

export type AddendumImpactRepositoryWriteResult<T> =
  | { readonly outcome: "recorded"; readonly value: T }
  | { readonly outcome: "replayed"; readonly value: T }
  | { readonly outcome: "conflict" };

export interface AddendumImpactRepository {
  load(
    scope: AddendumImpactScope,
    projectId: string,
    selection: AddendumImpactSelection,
  ): Promise<AddendumImpactRepositorySnapshot | null>;
  recordReview(
    input: RecordAddendumImpactReviewInput,
  ): Promise<AddendumImpactRepositoryWriteResult<StoredAddendumImpactReview>>;
  findApplicationReplay(
    input: FindAddendumImpactApplicationReplayInput,
  ): Promise<StoredAddendumImpactApplication | null>;
  applyReopening(
    input: ApplyAddendumImpactInput,
  ): Promise<
    AddendumImpactRepositoryWriteResult<StoredAddendumImpactApplication>
  >;
}

export class AddendumImpactRepositoryUnavailableError extends Error {
  constructor() {
    super("Addendum impact persistence is unavailable");
    this.name = "AddendumImpactRepositoryUnavailableError";
  }
}

export const unavailableAddendumImpactRepository: AddendumImpactRepository = {
  load: async () => {
    throw new AddendumImpactRepositoryUnavailableError();
  },
  recordReview: async () => {
    throw new AddendumImpactRepositoryUnavailableError();
  },
  findApplicationReplay: async () => {
    throw new AddendumImpactRepositoryUnavailableError();
  },
  applyReopening: async () => {
    throw new AddendumImpactRepositoryUnavailableError();
  },
};
