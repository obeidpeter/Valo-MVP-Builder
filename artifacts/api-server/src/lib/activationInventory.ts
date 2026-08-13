import { AI_CONTINUOUS_EVAL_FOUNDATION_STATUS } from "./aiContinuousEval";
import { AI_CONTROL_PLANE_FOUNDATION_STATUS } from "./aiControlPlane";
import { AI_RETRIEVAL_FOUNDATION_STATUS } from "./aiRetrievalPipeline";
import { AI_SHADOW_PROGRAMME_STATUS } from "./aiShadowProgramme/contracts";
import { CLAIMS_DESK_ACTIVATION_GATES } from "./claimsDesk/activation";
import { DURABLE_WORKER_FOUNDATION_STATUS } from "./durableWorkerFoundation";
import { CONTINUOUS_EVALUATION_STORE_STATUS } from "./intelligence/continuousEvaluationStore";
import { DURABLE_WORKFLOW_STORE_STATUS } from "./intelligence/durableWorkflowStore";
import { EVIDENCE_LAYER_FOUNDATION_STATUS } from "./intelligence/evidenceLayer";
import { OPPORTUNITY_SOURCE_NETWORK_STATUS } from "./opportunitySourceNetwork/contracts";
import { STORAGE_DELETION_RECONCILER_STATUS } from "./storageLifecycle/reconciler";
import { TRANSACTIONAL_OUTBOX_STATUS } from "./transactionalOutbox";

/**
 * One registry over every vertical's activation/status declaration so the
 * cross-wave release rule — provider calls, scraping, production AI
 * activation, autonomous action and external effects are never inferred from
 * an implemented evidence workflow — is a single executable assertion instead
 * of a convention scattered across modules. Flipping any of these flags must
 * come through a deliberate edit here as well, which makes the change visible
 * in review.
 */
export const ACTIVATION_STATUS_INVENTORY = Object.freeze({
  aiContinuousEval: AI_CONTINUOUS_EVAL_FOUNDATION_STATUS,
  aiControlPlane: AI_CONTROL_PLANE_FOUNDATION_STATUS,
  aiRetrieval: AI_RETRIEVAL_FOUNDATION_STATUS,
  aiShadowProgramme: AI_SHADOW_PROGRAMME_STATUS,
  continuousEvaluationStore: CONTINUOUS_EVALUATION_STORE_STATUS,
  durableWorkerFoundation: DURABLE_WORKER_FOUNDATION_STATUS,
  durableWorkflowStore: DURABLE_WORKFLOW_STORE_STATUS,
  evidenceLayer: EVIDENCE_LAYER_FOUNDATION_STATUS,
  opportunitySourceNetwork: OPPORTUNITY_SOURCE_NETWORK_STATUS,
  storageDeletionReconciler: STORAGE_DELETION_RECONCILER_STATUS,
  transactionalOutbox: TRANSACTIONAL_OUTBOX_STATUS,
});

/** Route-level wiring gates (things that ARE mounted), kept separate from
 * external-effect status flags because their truthy values are the point. */
export const ACTIVATION_WIRING_INVENTORY = Object.freeze({
  claimsDesk: CLAIMS_DESK_ACTIVATION_GATES,
});

/**
 * Any status key matching one of these patterns asserts an external effect,
 * autonomous authority, or production activation. The inventory test requires
 * every such flag to be `false` across every registered vertical.
 */
export const EXTERNAL_EFFECT_KEY_PATTERNS: readonly RegExp[] = Object.freeze([
  /^autonomous/iu,
  /externalProviderInvocationAllowed/u,
  /providerInvocationAllowed/u,
  /externalAcquisitionConnected/u,
  /modelExecutionConnected/u,
  /providerDisclosureAllowed/u,
  /rawOutputPersistenceAllowed/u,
  /productionApproved/u,
  /productionActivationGranted/u,
  /arbitraryPayloadPersistenceImplemented/u,
  /globalClaimAllowed/u,
]);

export function externalEffectViolations(): string[] {
  const violations: string[] = [];
  for (const [vertical, status] of Object.entries(
    ACTIVATION_STATUS_INVENTORY,
  )) {
    for (const [key, value] of Object.entries(status)) {
      const isExternalEffectKey = EXTERNAL_EFFECT_KEY_PATTERNS.some((pattern) =>
        pattern.test(key),
      );
      if (isExternalEffectKey && value !== false) {
        violations.push(`${vertical}.${key}`);
      }
    }
  }
  return violations;
}
