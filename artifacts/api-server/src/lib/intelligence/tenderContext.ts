import { createHash } from "node:crypto";
import {
  evaluateJurisdictionRules,
  type JurisdictionRule,
  type RuleAdvisory,
} from "../jurisdictionRules";
import type { SourceDocument } from "./domain";
import type {
  EligibilityArtifactInput,
  EligibilityPassportResult,
  EligibilityRequirementInput,
} from "./eligibilityPassport";
import type { TenderContextVersionDraft } from "./tenderContextContracts";

export const TENDER_CONTEXT_SNAPSHOT_SCHEMA = "valo.tender-context-snapshot/v1";
export const TENDER_SOURCE_MANIFEST_SCHEMA = "valo.tender-source-manifest/v1";
export const TENDER_ELIGIBILITY_RESULT_SCHEMA =
  "valo.tender-eligibility-result/v1";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

export function tenderCanonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function tenderSha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export interface ResolvedTenderRequirement {
  readonly bindingId: string;
  readonly requirementId: string;
  readonly requirementCitationId: string;
  readonly description: string;
  readonly evidenceKind: string;
  readonly mandatory: boolean;
  readonly requiresCurrentOnSubmissionDate: boolean;
  readonly requiresExactLegalEntityMatch: boolean;
  readonly input: EligibilityRequirementInput;
}

export interface ResolvedTenderArtifact {
  readonly bindingId: string;
  readonly vaultItemVersionId: string;
  readonly documentVersionId: string;
  readonly documentVersionSha256: string;
  readonly label: string;
  readonly issuer: string;
  readonly evidenceKind: string;
  readonly legalEntityName: string | null;
  readonly validFrom: string | null;
  readonly validUntil: string | null;
  readonly input: EligibilityArtifactInput;
}

export interface ResolvedTenderRulePack {
  readonly id: string;
  readonly packKey: string;
  readonly version: string;
  readonly sourceManifestHash: string;
  readonly advisoryOnly: boolean;
  readonly rules: readonly JurisdictionRule[];
}

export function tenderRulePackMaterialSha256(
  rules: readonly JurisdictionRule[],
): string {
  return tenderSha256(
    tenderCanonicalJson(
      [...rules].sort((left, right) => left.ruleId.localeCompare(right.ruleId)),
    ),
  );
}

export interface ResolvedTenderSource extends SourceDocument {
  /** Exact uploaded-byte identity of the immutable document version. */
  readonly documentVersionSha256: string;
}

export interface ResolvedTenderContextMaterial {
  readonly draft: TenderContextVersionDraft;
  readonly primaryDocumentVersionId: string;
  readonly sources: readonly ResolvedTenderSource[];
  readonly requirements: readonly ResolvedTenderRequirement[];
  readonly artifacts: readonly ResolvedTenderArtifact[];
  readonly rulePack: ResolvedTenderRulePack;
}

export interface BuiltTenderContext {
  readonly sourceManifest: string;
  readonly sourceManifestSha256: string;
  readonly contextSnapshot: string;
  readonly contextSha256: string;
  readonly ruleAdvisories: readonly RuleAdvisory[];
}

/**
 * Builds an immutable description of only the versions and bindings selected
 * for this tender. It deliberately does not infer a universal Nigeria list.
 */
export function buildTenderContext(
  material: ResolvedTenderContextMaterial,
): BuiltTenderContext {
  const sources = [...material.sources].sort(
    (left, right) =>
      left.sourceId.localeCompare(right.sourceId) ||
      left.versionId.localeCompare(right.versionId),
  );
  const sourceManifest = tenderCanonicalJson({
    schema: TENDER_SOURCE_MANIFEST_SCHEMA,
    sources: sources.map((source) => ({
      sourceId: source.sourceId,
      versionId: source.versionId,
      documentVersionSha256: source.documentVersionSha256,
      kind: source.kind,
      title: source.title,
      contentSha256: source.contentSha256,
      capturedAt: source.capturedAt,
      authority: source.authority,
      origin: source.origin,
    })),
    jurisdictionRulePack: {
      id: material.rulePack.id,
      packKey: material.rulePack.packKey,
      version: material.rulePack.version,
      sourceManifestHash: material.rulePack.sourceManifestHash,
      rulesSha256: tenderRulePackMaterialSha256(material.rulePack.rules),
      advisoryOnly: material.rulePack.advisoryOnly,
    },
  });
  const sourceManifestSha256 = tenderSha256(sourceManifest);
  const ruleAdvisories = evaluateJurisdictionRules(
    [...material.rulePack.rules],
    {
      at: `${material.draft.submissionDate}T00:00:00.000Z`,
      jurisdiction: material.draft.jurisdiction,
      entityScopes: [...material.draft.entityScopes],
      categoryScopes: [...material.draft.categoryScopes],
    },
  ).sort((left, right) => left.ruleId.localeCompare(right.ruleId));
  const contextSnapshot = tenderCanonicalJson({
    schema: TENDER_CONTEXT_SNAPSHOT_SCHEMA,
    legalEntityName: material.draft.legalEntityName,
    submissionDate: material.draft.submissionDate,
    jurisdiction: material.draft.jurisdiction,
    entityScopes: [...material.draft.entityScopes].sort(),
    categoryScopes: [...material.draft.categoryScopes].sort(),
    primaryDocumentVersionId: material.primaryDocumentVersionId,
    sourceManifestSha256,
    ruleAdvisories,
    requirements: [...material.requirements]
      .sort((left, right) =>
        left.requirementId.localeCompare(right.requirementId),
      )
      .map((requirement) => ({
        bindingId: requirement.bindingId,
        requirementId: requirement.requirementId,
        requirementCitationId: requirement.requirementCitationId,
        description: requirement.description,
        evidenceKind: requirement.evidenceKind,
        mandatory: requirement.mandatory,
        requiresCurrentOnSubmissionDate:
          requirement.requiresCurrentOnSubmissionDate,
        requiresExactLegalEntityMatch:
          requirement.requiresExactLegalEntityMatch,
        citation: requirement.input.citations[0],
        review: requirement.input.review,
      })),
    artifacts: [...material.artifacts]
      .sort((left, right) =>
        left.vaultItemVersionId.localeCompare(right.vaultItemVersionId),
      )
      .map((artifact) => ({
        bindingId: artifact.bindingId,
        vaultItemVersionId: artifact.vaultItemVersionId,
        documentVersionId: artifact.documentVersionId,
        documentVersionSha256: artifact.documentVersionSha256,
        label: artifact.label,
        issuer: artifact.issuer,
        evidenceKind: artifact.evidenceKind,
        legalEntityName: artifact.legalEntityName,
        validFrom: artifact.validFrom,
        validUntil: artifact.validUntil,
        citation: artifact.input.citations[0],
        review: artifact.input.review,
      })),
  });
  return {
    sourceManifest,
    sourceManifestSha256,
    contextSnapshot,
    contextSha256: tenderSha256(contextSnapshot),
    ruleAdvisories,
  };
}

export function eligibilityReadyForNamedTenderReview(
  result: EligibilityPassportResult,
): boolean {
  if (result.issues.some((issue) => issue.severity === "blocker")) return false;
  const requirements = new Map(
    result.requirements.map((requirement) => [
      requirement.requirementId,
      requirement,
    ]),
  );
  return result.criteria.every((criterion) => {
    const requirement = requirements.get(criterion.requirementId);
    return !requirement?.mandatory || criterion.status === "met";
  });
}

export function publicEligibilityStatus(
  result: EligibilityPassportResult,
):
  | "blocked"
  | "incomplete"
  | "review_required"
  | "ready_for_human_tender_review" {
  if (result.status === "blocked") return "blocked";
  if (result.status === "incomplete") return "incomplete";
  return eligibilityReadyForNamedTenderReview(result)
    ? "ready_for_human_tender_review"
    : "review_required";
}

export function buildEligibilityResultSnapshot(
  contextVersionId: string,
  result: EligibilityPassportResult,
): string {
  return tenderCanonicalJson({
    schema: TENDER_ELIGIBILITY_RESULT_SCHEMA,
    tenderContextVersionId: contextVersionId,
    eligibleForNamedTenderReview: eligibilityReadyForNamedTenderReview(result),
    result: {
      ...result,
      readyForSubmissionUse: undefined,
    },
  });
}
