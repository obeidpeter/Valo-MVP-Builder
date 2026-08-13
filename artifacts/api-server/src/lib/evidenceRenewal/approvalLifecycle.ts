export interface EvidenceRenewalApprovalVaultProjection {
  version: number;
  objectPath: string | null;
  sourceDocumentId: string | null;
}

export interface EvidenceRenewalApprovalCanonicalProjection {
  documentId: string;
  documentVersionId: string;
  documentVersionNumber: number;
  sha256: string;
  objectPath: string;
}

export interface EvidenceRenewalApprovalExpectation {
  expectedVaultItemVersion: number;
  documentId: string;
  documentVersionId: string;
  documentVersionNumber: number;
  sha256: string;
}

export interface EvidenceRenewalApprovalLifecycleDependencies {
  readVaultCandidate(): Promise<EvidenceRenewalApprovalVaultProjection | null>;
  readCanonicalCandidate(): Promise<EvidenceRenewalApprovalCanonicalProjection | null>;
  lockObjectPath(objectPath: string): Promise<void>;
  readVaultForUpdate(): Promise<EvidenceRenewalApprovalVaultProjection | null>;
  readFreshCanonical(): Promise<EvidenceRenewalApprovalCanonicalProjection | null>;
  promote(
    vault: EvidenceRenewalApprovalVaultProjection,
    canonical: EvidenceRenewalApprovalCanonicalProjection,
  ): Promise<void>;
  enqueueSupersededObject(objectPath: string): Promise<void>;
}

export type EvidenceRenewalApprovalLifecycleOutcome =
  | "promoted"
  | "vault_conflict"
  | "evidence_conflict";

function matchesExpectedCanonical(
  canonical: EvidenceRenewalApprovalCanonicalProjection | null,
  expected: EvidenceRenewalApprovalExpectation,
): canonical is EvidenceRenewalApprovalCanonicalProjection {
  return Boolean(
    canonical &&
    canonical.documentId === expected.documentId &&
    canonical.documentVersionId === expected.documentVersionId &&
    canonical.documentVersionNumber === expected.documentVersionNumber &&
    canonical.sha256 === expected.sha256,
  );
}

function unchangedVault(
  candidate: EvidenceRenewalApprovalVaultProjection,
  locked: EvidenceRenewalApprovalVaultProjection | null,
): locked is EvidenceRenewalApprovalVaultProjection {
  return Boolean(
    locked &&
    locked.version === candidate.version &&
    locked.objectPath === candidate.objectPath &&
    locked.sourceDocumentId === candidate.sourceDocumentId,
  );
}

function unchangedCanonical(
  candidate: EvidenceRenewalApprovalCanonicalProjection,
  fresh: EvidenceRenewalApprovalCanonicalProjection | null,
): fresh is EvidenceRenewalApprovalCanonicalProjection {
  return Boolean(
    fresh &&
    fresh.documentId === candidate.documentId &&
    fresh.documentVersionId === candidate.documentVersionId &&
    fresh.documentVersionNumber === candidate.documentVersionNumber &&
    fresh.sha256 === candidate.sha256 &&
    fresh.objectPath === candidate.objectPath,
  );
}

/**
 * Promote one independently reviewed replacement without creating a
 * path-lock/vault-row deadlock. Candidate paths are read before any row lock,
 * then their advisory locks are taken in the same lexical order used by the
 * ordinary vault routes. Drift is a retryable conflict: the transaction never
 * tries to acquire a newly discovered path out of order.
 *
 * The caller must run this inside the same transaction as its immutable review
 * receipt. Promotion deliberately happens before deletion-intent enqueueing;
 * an enqueue or later receipt failure must escape and roll the whole transaction
 * back.
 */
export async function promoteEvidenceRenewalWithStorageLifecycle(
  expected: EvidenceRenewalApprovalExpectation,
  dependencies: EvidenceRenewalApprovalLifecycleDependencies,
): Promise<EvidenceRenewalApprovalLifecycleOutcome> {
  const candidateVault = await dependencies.readVaultCandidate();
  if (
    !candidateVault ||
    candidateVault.version !== expected.expectedVaultItemVersion
  ) {
    return "vault_conflict";
  }

  const candidateCanonical = await dependencies.readCanonicalCandidate();
  if (!matchesExpectedCanonical(candidateCanonical, expected)) {
    return "evidence_conflict";
  }

  const candidatePaths = [
    ...new Set([candidateVault.objectPath, candidateCanonical.objectPath]),
  ]
    .filter((path): path is string => path !== null)
    .sort();
  for (const objectPath of candidatePaths) {
    await dependencies.lockObjectPath(objectPath);
  }

  const lockedVault = await dependencies.readVaultForUpdate();
  if (!unchangedVault(candidateVault, lockedVault)) {
    return "vault_conflict";
  }

  const freshCanonical = await dependencies.readFreshCanonical();
  if (
    !matchesExpectedCanonical(freshCanonical, expected) ||
    !unchangedCanonical(candidateCanonical, freshCanonical)
  ) {
    return "evidence_conflict";
  }

  await dependencies.promote(lockedVault, freshCanonical);
  if (
    lockedVault.objectPath !== null &&
    lockedVault.objectPath !== freshCanonical.objectPath
  ) {
    // Do not gate cleanup on sourceDocumentId: legacy/imported vault rows can
    // carry an owned object path while lacking that provenance pointer.
    await dependencies.enqueueSupersededObject(lockedVault.objectPath);
  }
  return "promoted";
}
