import { isExplicitTenantFeatureEnabled } from "../featureFlags";

export const CLIENT_ACTION_UPLOAD_FEATURE_FLAG =
  "client_action_governed_upload" as const;

/**
 * The original generic signed-PUT route has no durable lease identity and the
 * provider signer cannot currently prove a create-only generation condition.
 * Issuance therefore fails closed; registration/discard remain mounted only to
 * settle objects issued by older releases.
 */
export const LEGACY_SIGNED_UPLOAD_ISSUANCE = Object.freeze({
  durableLeaseImplemented: false,
  createOnlySignedPutVerified: false,
  issuanceEnabled: false,
});

/**
 * Shipping source is not production activation. The direct browser PUT flow
 * remains server-disabled until the scheduled reconciler is installed and the
 * provider supplies a verified in-flight PUT closure bound. A tenant-specific
 * flag is an additional approval; it can never override a missing operational
 * gate.
 */
export const GOVERNED_CLIENT_UPLOAD_ACTIVATION = Object.freeze({
  serverEnforced: true,
  explicitTenantFlagRequired: true,
  platformScheduleVerified: false,
  providerInFlightPutMaximumVerified: false,
  exactLateRewriteClosureImplemented: false,
  productionIssuanceEnabled: false,
});

export async function isGovernedClientUploadActivated(
  organisationId: string,
): Promise<boolean> {
  if (
    !GOVERNED_CLIENT_UPLOAD_ACTIVATION.platformScheduleVerified ||
    !GOVERNED_CLIENT_UPLOAD_ACTIVATION.providerInFlightPutMaximumVerified ||
    !GOVERNED_CLIENT_UPLOAD_ACTIVATION.exactLateRewriteClosureImplemented ||
    !GOVERNED_CLIENT_UPLOAD_ACTIVATION.productionIssuanceEnabled
  ) {
    return false;
  }
  return isExplicitTenantFeatureEnabled(
    organisationId,
    CLIENT_ACTION_UPLOAD_FEATURE_FLAG,
  );
}
