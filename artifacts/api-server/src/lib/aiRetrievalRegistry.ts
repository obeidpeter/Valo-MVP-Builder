/**
 * The deployed retrieval/index registry contract — the sole structural
 * blocker for production AI activation.
 *
 * Production retrieval and index versions must come from a deployed,
 * tenant-isolated registry whose live identity can be attested, never from
 * operator-authored labels. This module is the single source of truth for
 * that decision: it names the exact requirements a deployed registry must
 * prove, and it deliberately offers no environment-variable, file, or
 * configuration escape hatch. Until a deployed registry satisfies every
 * requirement and this attestation is rewritten against it (a reviewed code
 * change, visible in diff), the attestation is a hard `available: false`.
 */

export const RETRIEVAL_REGISTRY_BLOCKER =
  "retrieval_registry_unavailable" as const;

export interface RetrievalRegistryRequirement {
  code: string;
  description: string;
}

export const AI_RETRIEVAL_REGISTRY_REQUIREMENTS: readonly RetrievalRegistryRequirement[] =
  Object.freeze([
    Object.freeze({
      code: "registry_deployment_absent",
      description:
        "A registry service or table must exist in the deployed environment " +
        "holding the live retrieval and index version identities.",
    }),
    Object.freeze({
      code: "tenant_isolation_unattested",
      description:
        "The registry's storage must carry the same tenant-isolation posture " +
        "as the rest of the system (FORCE RLS or equivalent), verified by " +
        "startup attestation, so retrieval context can never cross tenants.",
    }),
    Object.freeze({
      code: "content_digest_attestation_absent",
      description:
        "Each registered retrieval corpus and index must be content-addressed " +
        "(SHA-256) so the release gate can compare the live identity against " +
        "the retained evidence bundle, not a label.",
    }),
    Object.freeze({
      code: "version_identity_recomputation_absent",
      description:
        "The runtime must recompute the registry identity at gate-evaluation " +
        "time from the deployed registry itself; a boot-time snapshot or " +
        "cached value is not an attestation.",
    }),
  ]);

export type RetrievalRegistryAttestation =
  | {
      available: false;
      blocker: typeof RETRIEVAL_REGISTRY_BLOCKER;
      unmetRequirements: readonly RetrievalRegistryRequirement[];
    }
  | {
      available: true;
      retrievalVersion: string;
      indexVersion: string;
      attestationSha256: string;
    };

/**
 * No deployed registry exists yet, so every requirement is unmet and the
 * attestation is statically unavailable. Activating production retrieval
 * means replacing this function body with a live recomputation against the
 * deployed registry — never adding an input that lets an operator assert
 * availability from outside the code.
 */
export function attestDeployedRetrievalRegistry(): RetrievalRegistryAttestation {
  return {
    available: false,
    blocker: RETRIEVAL_REGISTRY_BLOCKER,
    unmetRequirements: AI_RETRIEVAL_REGISTRY_REQUIREMENTS,
  };
}
