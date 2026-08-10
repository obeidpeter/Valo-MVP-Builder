export const AI_CAPABILITY_IDS = [
  "extract_pdf_multimodal",
  "extract_requirements",
  "map_evidence",
  "suggest_defects",
  "responsiveness_review",
] as const;

export type AiCapabilityId = (typeof AI_CAPABILITY_IDS)[number];
export type AiAutonomyLevel = 1 | 2 | 3 | 4;
export type AiRuntimeEnvironment = "development" | "test" | "production";

export const AI_SAFE_ERROR_CODES = [
  "AI_GLOBAL_DISABLED",
  "AI_CAPABILITY_DISABLED",
  "AI_CAPABILITY_GATE_UNAVAILABLE",
  "AI_INVALID_REQUEST",
  "AI_INPUT_LIMIT_EXCEEDED",
  "AI_MODEL_CONFIGURATION_UNAVAILABLE",
  "AI_RELEASE_GATE_DENIED",
  "AI_BUDGET_UNAVAILABLE",
  "AI_BUDGET_CURRENCY_MISMATCH",
  "AI_BUDGET_EXCEEDED",
  "AI_PROVIDER_UNAVAILABLE",
  "AI_PROVIDER_NOT_APPROVED",
  "AI_PROVIDER_PRIVACY_UNVERIFIED",
  "AI_PROVIDER_REGION_UNAVAILABLE",
  "AI_PROVIDER_RETENTION_INCOMPATIBLE",
  "AI_RESTRICTED_MODE_DENIED",
  "AI_PROVIDER_UNHEALTHY",
  "AI_PROVIDER_FAILED",
  "AI_USAGE_UNAVAILABLE",
  "AI_OUTPUT_SCHEMA_INVALID",
  "AI_CANCELLED",
  "AI_INTERNAL_FAILURE",
] as const;

export type AiSafeErrorCode = (typeof AI_SAFE_ERROR_CODES)[number];

export interface AiCapabilityLimits {
  maxInputBytes: number;
  maxOutputTokens: number;
  timeoutMs: number;
  maxRetriesPerProvider: number;
  maxFallbackProviders: number;
  /** Hard safety ceiling only; it never grants spending authority. */
  maxCostMinor: number;
  costCurrency: "NGN";
}

export interface AiApprovalContract {
  outputState: "non_authoritative_draft";
  authoritativeUseRequiresHumanApproval: true;
  approvalAuthority: string;
  namedHumanRequired: true;
  aiSelfApprovalForbidden: true;
  twoPersonApprovalRequired: boolean;
}

export interface AiFailureContract {
  behavior: "fail_closed";
  partialOutputMayPersist: false;
  manualRecoveryRequired: true;
  providerFallback: "equivalent_or_stronger_only";
}

export interface AiCapabilityPolicy {
  id: AiCapabilityId;
  autonomyLevel: AiAutonomyLevel;
  actionClass: "reversible_draft";
  authoritativeMutationAllowed: false;
  limits: AiCapabilityLimits;
  approval: AiApprovalContract;
  failure: AiFailureContract;
}

const approval = (
  approvalAuthority: string,
  twoPersonApprovalRequired = false,
): AiApprovalContract => ({
  outputState: "non_authoritative_draft",
  authoritativeUseRequiresHumanApproval: true,
  approvalAuthority,
  namedHumanRequired: true,
  aiSelfApprovalForbidden: true,
  twoPersonApprovalRequired,
});

const failure: AiFailureContract = {
  behavior: "fail_closed",
  partialOutputMayPersist: false,
  manualRecoveryRequired: true,
  providerFallback: "equivalent_or_stronger_only",
};

/**
 * Current model-backed tasks are all Level 2: they may create reversible,
 * visibly AI-generated drafts but can never establish authoritative state.
 * The cost values are defensive per-run ceilings, not approved budgets.
 */
export const AI_CAPABILITY_POLICY: Readonly<
  Record<AiCapabilityId, AiCapabilityPolicy>
> = {
  extract_pdf_multimodal: {
    id: "extract_pdf_multimodal",
    autonomyLevel: 2,
    actionClass: "reversible_draft",
    authoritativeMutationAllowed: false,
    limits: {
      maxInputBytes: 50 * 1024 * 1024,
      maxOutputTokens: 8_192,
      timeoutMs: 60_000,
      maxRetriesPerProvider: 1,
      maxFallbackProviders: 1,
      maxCostMinor: 500_000,
      costCurrency: "NGN",
    },
    approval: approval("named_document_reviewer"),
    failure,
  },
  extract_requirements: {
    id: "extract_requirements",
    autonomyLevel: 2,
    actionClass: "reversible_draft",
    authoritativeMutationAllowed: false,
    limits: {
      maxInputBytes: 60_000,
      maxOutputTokens: 8_192,
      timeoutMs: 45_000,
      maxRetriesPerProvider: 1,
      maxFallbackProviders: 1,
      maxCostMinor: 300_000,
      costCurrency: "NGN",
    },
    approval: approval("requirement:review"),
    failure,
  },
  map_evidence: {
    id: "map_evidence",
    autonomyLevel: 2,
    actionClass: "reversible_draft",
    authoritativeMutationAllowed: false,
    limits: {
      maxInputBytes: 60_000,
      maxOutputTokens: 8_192,
      timeoutMs: 45_000,
      maxRetriesPerProvider: 1,
      maxFallbackProviders: 1,
      maxCostMinor: 300_000,
      costCurrency: "NGN",
    },
    approval: approval("evidence:approve"),
    failure,
  },
  suggest_defects: {
    id: "suggest_defects",
    autonomyLevel: 2,
    actionClass: "reversible_draft",
    authoritativeMutationAllowed: false,
    limits: {
      maxInputBytes: 60_000,
      maxOutputTokens: 4_096,
      timeoutMs: 45_000,
      maxRetriesPerProvider: 1,
      maxFallbackProviders: 1,
      maxCostMinor: 200_000,
      costCurrency: "NGN",
    },
    approval: approval("defect:review"),
    failure,
  },
  responsiveness_review: {
    id: "responsiveness_review",
    autonomyLevel: 2,
    actionClass: "reversible_draft",
    authoritativeMutationAllowed: false,
    limits: {
      maxInputBytes: 60_000,
      maxOutputTokens: 2_048,
      timeoutMs: 45_000,
      maxRetriesPerProvider: 1,
      maxFallbackProviders: 1,
      maxCostMinor: 150_000,
      costCurrency: "NGN",
    },
    approval: approval("report:sign_off"),
    failure,
  },
};

for (const policy of Object.values(AI_CAPABILITY_POLICY)) {
  Object.freeze(policy.limits);
  Object.freeze(policy.approval);
  Object.freeze(policy.failure);
  Object.freeze(policy);
}
Object.freeze(AI_CAPABILITY_POLICY);

export function isAiCapabilityId(value: string): value is AiCapabilityId {
  return (AI_CAPABILITY_IDS as readonly string[]).includes(value);
}

/** Missing production activation is disabled; the emergency switch always wins. */
export function isGlobalAiKillSwitchEngaged(
  environment: AiRuntimeEnvironment,
  variables: NodeJS.ProcessEnv = process.env,
): boolean {
  if (variables.VALO_AI_KILL_SWITCH === "true") return true;
  return (
    environment === "production" && variables.VALO_AI_GLOBAL_ENABLED !== "true"
  );
}

export function productionCapabilityEnvironmentKey(
  capability: AiCapabilityId,
): string {
  return `VALO_AI_${capability.toUpperCase()}_ENABLED`;
}

export type AiCapabilityGateResolver = (
  capability: AiCapabilityId,
) => boolean | Promise<boolean>;

export interface AiCapabilityGateDecision {
  allowed: boolean;
  code?: Extract<
    AiSafeErrorCode,
    | "AI_GLOBAL_DISABLED"
    | "AI_CAPABILITY_DISABLED"
    | "AI_CAPABILITY_GATE_UNAVAILABLE"
  >;
}

export async function evaluateAiCapabilityGate(input: {
  capability: AiCapabilityId;
  environment: AiRuntimeEnvironment;
  globalKillSwitchEngaged: boolean;
  resolveCapabilityEnabled?: AiCapabilityGateResolver;
}): Promise<AiCapabilityGateDecision> {
  if (input.globalKillSwitchEngaged) {
    return { allowed: false, code: "AI_GLOBAL_DISABLED" };
  }
  if (input.environment !== "production") {
    if (!input.resolveCapabilityEnabled) return { allowed: true };
    try {
      return (await input.resolveCapabilityEnabled(input.capability))
        ? { allowed: true }
        : { allowed: false, code: "AI_CAPABILITY_DISABLED" };
    } catch {
      return { allowed: false, code: "AI_CAPABILITY_GATE_UNAVAILABLE" };
    }
  }
  if (!input.resolveCapabilityEnabled) {
    return { allowed: false, code: "AI_CAPABILITY_GATE_UNAVAILABLE" };
  }
  try {
    return (await input.resolveCapabilityEnabled(input.capability))
      ? { allowed: true }
      : { allowed: false, code: "AI_CAPABILITY_DISABLED" };
  } catch {
    return { allowed: false, code: "AI_CAPABILITY_GATE_UNAVAILABLE" };
  }
}
