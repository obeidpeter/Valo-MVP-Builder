import { lstatSync, readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { eq } from "drizzle-orm";
import { db, projects } from "@workspace/db";
import {
  AiGatewayError,
  executeAiGatewayRequest,
  type AiGatewayBudget,
  type AiGatewayModelConfiguration,
  type AiGatewayResult,
  type AiProviderPolicy,
} from "./aiGateway";
import {
  AI_CAPABILITY_POLICY,
  isGlobalAiKillSwitchEngaged,
  productionCapabilityEnvironmentKey,
  type AiCapabilityId,
  type AiRuntimeEnvironment,
} from "./aiPolicy";
import { canonicalJson, sha256, AI_PROMPT_REGISTRY } from "./aiPromptRegistry";
import { attestDeployedRetrievalRegistry } from "./aiRetrievalRegistry";
import {
  evaluateAiRelease,
  type AiReleaseGateInput,
  type AiReleaseVersions,
} from "./aiReleaseGate";
import { isExplicitTenantFeatureEnabled } from "./featureFlags";
import {
  configuredModelAdapters,
  configuredOpenAiBaseUrlApproved,
  configuredOpenAiDataGovernance,
} from "./openAiModelAdapter";
import { MODEL_ID, PROMPT_PACK_VERSION } from "./provenance";

export interface AiRuntimeConfiguration {
  environment: AiRuntimeEnvironment;
  globalKillSwitchEngaged: boolean;
  modelConfiguration: AiGatewayModelConfiguration;
  budget: AiGatewayBudget | null;
  providerPolicy: AiProviderPolicy;
}

export interface AiRuntimeReleaseGateStatus {
  applicable: boolean;
  allowed: boolean;
  blockerCodes: string[];
}

const MAX_RELEASE_EVIDENCE_BYTES = 5 * 1024 * 1024;

function registrySetVersion(
  project: (
    definition: (typeof AI_PROMPT_REGISTRY)[keyof typeof AI_PROMPT_REGISTRY],
  ) => Record<string, string>,
): string {
  return sha256(
    canonicalJson(
      Object.fromEntries(
        Object.entries(AI_PROMPT_REGISTRY).map(([capability, definition]) => [
          capability,
          project(definition),
        ]),
      ),
    ),
  );
}

function expectedSchemaSetVersion(): string {
  return registrySetVersion((definition) => ({
    schemaVersion: definition.schemaVersion,
    schemaHash: definition.schemaHash,
  }));
}

function expectedPromptSetVersion(): string {
  return registrySetVersion((definition) => ({
    promptVersion: definition.promptVersion,
    promptHash: definition.promptHash,
  }));
}

export function configuredAiExpectedVersions(
  runtime: AiRuntimeConfiguration,
  _variables: NodeJS.ProcessEnv = process.env,
): AiReleaseVersions {
  // Retrieval and index identities come only from the deployed-registry
  // attestation (see aiRetrievalRegistry.ts); operator-authored labels are
  // structurally ignored, so an unavailable registry yields empty versions.
  const registry = attestDeployedRetrievalRegistry();
  return {
    model: runtime.modelConfiguration.model,
    modelConfiguration: runtime.modelConfiguration.configurationVersion,
    prompt: PROMPT_PACK_VERSION,
    promptRegistry: expectedPromptSetVersion(),
    schema: expectedSchemaSetVersion(),
    retrieval: registry.available ? registry.retrievalVersion : "",
    index: registry.available ? registry.indexVersion : "",
  };
}

function productionRegistryBlockers(): string[] {
  const registry = attestDeployedRetrievalRegistry();
  return registry.available ? [] : [registry.blocker];
}

export function configuredAiReleaseRuntimeMismatchCodes(
  runtime: AiRuntimeConfiguration,
  supplied: Partial<AiReleaseGateInput>,
  variables: NodeJS.ProcessEnv = process.env,
): string[] {
  const mismatches: string[] = [];
  const governance = configuredOpenAiDataGovernance(variables);
  const providerRetentionDays =
    governance.retentionMode === "zero"
      ? 0
      : governance.retentionMode === "bounded"
        ? governance.maxRetentionDays
        : null;
  if (
    supplied.provider?.provider !== "openai" ||
    !configuredOpenAiBaseUrlApproved(variables) ||
    supplied.provider?.region?.trim().toLowerCase() !==
      runtime.providerPolicy.requiredRegion.trim().toLowerCase() ||
    !governance.regions.includes(
      runtime.providerPolicy.requiredRegion.trim().toLowerCase(),
    ) ||
    supplied.provider?.retentionDays !== providerRetentionDays ||
    governance.noTrainingVerified !== true ||
    governance.dpaApproved !== true
  ) {
    mismatches.push("provider_runtime_mismatch");
  }
  const releaseBudget = supplied.budget;
  const runtimeBudget = runtime.budget;
  const largestInputBytes = Math.max(
    ...Object.values(AI_CAPABILITY_POLICY).map(
      (policy) => policy.limits.maxInputBytes,
    ),
  );
  const largestOutputTokens = Math.max(
    ...Object.values(AI_CAPABILITY_POLICY).map(
      (policy) => policy.limits.maxOutputTokens,
    ),
  );
  const largestLatencyMs = Math.max(
    ...Object.values(AI_CAPABILITY_POLICY).map(
      (policy) => policy.limits.timeoutMs,
    ),
  );
  const largestCostMinor = Math.max(
    ...Object.values(AI_CAPABILITY_POLICY).map(
      (policy) => policy.limits.maxCostMinor,
    ),
  );
  if (
    !runtimeBudget ||
    !releaseBudget ||
    releaseBudget.currency !== runtimeBudget.currency ||
    releaseBudget.rateCardVersion !== runtimeBudget.rateCardVersion ||
    releaseBudget.inputCostMinorPerThousandTokens !==
      runtimeBudget.inputCostMinorPerThousandTokens ||
    releaseBudget.outputCostMinorPerThousandTokens !==
      runtimeBudget.outputCostMinorPerThousandTokens ||
    runtimeBudget.remainingMinor <= 0 ||
    runtimeBudget.remainingMinor > releaseBudget.maxMonthlyCostMinor ||
    releaseBudget.maxInputTokens < largestInputBytes ||
    releaseBudget.maxOutputTokens < largestOutputTokens ||
    releaseBudget.maxLatencyMs < largestLatencyMs ||
    releaseBudget.maxCostPerRunMinor < largestCostMinor
  ) {
    mismatches.push("budget_runtime_mismatch");
  }
  return mismatches;
}

/**
 * Production release authority is recomputed from one private retained
 * evidence bundle. A boolean environment attestation cannot bypass the live
 * evaluation, provider/privacy/budget, version, or rollout decisions.
 */
export function configuredAiReleaseGateStatus(
  runtime: AiRuntimeConfiguration,
  variables: NodeJS.ProcessEnv = process.env,
): AiRuntimeReleaseGateStatus {
  if (runtime.environment !== "production")
    return { applicable: false, allowed: false, blockerCodes: [] };
  const evidencePath = variables.VALO_AI_RELEASE_EVIDENCE_PATH?.trim();
  if (!evidencePath || !isAbsolute(evidencePath))
    return {
      applicable: true,
      allowed: false,
      blockerCodes: [
        "release_evidence_missing",
        ...productionRegistryBlockers(),
      ],
    };
  try {
    const stat = lstatSync(evidencePath);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size <= 0 ||
      stat.size > MAX_RELEASE_EVIDENCE_BYTES ||
      (process.platform !== "win32" && (stat.mode & 0o077) !== 0)
    ) {
      return {
        applicable: true,
        allowed: false,
        blockerCodes: [
          "release_evidence_unsafe",
          ...productionRegistryBlockers(),
        ],
      };
    }
    const supplied = JSON.parse(
      readFileSync(evidencePath, "utf8"),
    ) as Partial<AiReleaseGateInput>;
    const evaluated = evaluateAiRelease({
      ...supplied,
      expectedVersions: configuredAiExpectedVersions(runtime, variables),
    });
    const runtimeMismatches = configuredAiReleaseRuntimeMismatchCodes(
      runtime,
      supplied,
      variables,
    );
    return {
      applicable: true,
      allowed:
        evaluated.allowed &&
        runtimeMismatches.length === 0 &&
        productionRegistryBlockers().length === 0,
      blockerCodes: Array.from(
        new Set([
          ...evaluated.blockers.map((blocker) => blocker.code),
          ...runtimeMismatches,
          ...productionRegistryBlockers(),
        ]),
      ),
    };
  } catch {
    return {
      applicable: true,
      allowed: false,
      blockerCodes: [
        "release_evidence_invalid",
        ...productionRegistryBlockers(),
      ],
    };
  }
}

function environmentFromVariables(
  variables: NodeJS.ProcessEnv,
): AiRuntimeEnvironment {
  if (variables.NODE_ENV === "production") return "production";
  if (variables.NODE_ENV === "test") return "test";
  if (variables.NODE_ENV === "development") return "development";
  // Unknown or missing environment identity must never skip production gates.
  return "production";
}

function nonNegativeInteger(value: string | undefined): number | null {
  if (!value?.trim() || !/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function approvedBudget(variables: NodeJS.ProcessEnv): AiGatewayBudget | null {
  const remainingMinor = nonNegativeInteger(
    variables.VALO_AI_APPROVED_BUDGET_REMAINING_MINOR,
  );
  const inputRate = nonNegativeInteger(
    variables.VALO_AI_INPUT_COST_MINOR_PER_1K_TOKENS,
  );
  const outputRate = nonNegativeInteger(
    variables.VALO_AI_OUTPUT_COST_MINOR_PER_1K_TOKENS,
  );
  const currency = variables.VALO_AI_BUDGET_CURRENCY?.trim() ?? "";
  const policyCurrencies: ReadonlySet<string> = new Set(
    Object.values(AI_CAPABILITY_POLICY).map(
      (policy) => policy.limits.costCurrency,
    ),
  );
  const rateCardVersion = variables.VALO_AI_RATE_CARD_VERSION?.trim() ?? "";
  if (
    variables.VALO_AI_BUDGET_APPROVED !== "true" ||
    remainingMinor == null ||
    inputRate == null ||
    inputRate === 0 ||
    outputRate == null ||
    outputRate === 0 ||
    policyCurrencies.size !== 1 ||
    !policyCurrencies.has(currency) ||
    !rateCardVersion
  ) {
    return null;
  }
  return {
    approved: true,
    currency,
    remainingMinor,
    inputCostMinorPerThousandTokens: inputRate,
    outputCostMinorPerThousandTokens: outputRate,
    rateCardVersion,
  };
}

export function configuredAiRuntime(
  variables: NodeJS.ProcessEnv = process.env,
): AiRuntimeConfiguration {
  const environment = environmentFromVariables(variables);
  const maxRetentionDays = nonNegativeInteger(
    variables.VALO_AI_MAX_RETENTION_DAYS,
  );
  return {
    environment,
    globalKillSwitchEngaged: isGlobalAiKillSwitchEngaged(
      environment,
      variables,
    ),
    modelConfiguration: {
      model: variables.VALO_AI_MODEL_ID?.trim() || MODEL_ID,
      configurationVersion:
        variables.VALO_AI_MODEL_CONFIGURATION_VERSION?.trim() ||
        (environment === "production" ? "" : "unpromoted-development"),
      status:
        variables.VALO_AI_MODEL_STATUS === "promoted" ? "promoted" : "draft",
      evaluationApproved:
        variables.VALO_AI_MODEL_EVALUATION_APPROVED === "true",
    },
    budget: approvedBudget(variables),
    providerPolicy: {
      requiredRegion: variables.VALO_AI_REQUIRED_REGION?.trim() ?? "",
      requireZeroRetention: variables.VALO_AI_REQUIRE_ZERO_RETENTION === "true",
      // An absent approval never becomes an unbounded provider default.
      maxRetentionDays: maxRetentionDays ?? -1,
    },
  };
}

export interface ExecuteProjectAiInput {
  capability: AiCapabilityId;
  projectId: string;
  userContent: unknown;
  idempotencyKey: string;
  signal?: AbortSignal;
}

/**
 * The only runtime entry point for model-backed project work. It derives the
 * tenant and Restricted Mode from the locked project row, and production
 * activation requires both an explicit environment approval and a tenant
 * feature flag. Missing governance, budget, model, or gate evidence is denied
 * by the central gateway before any client content reaches a provider.
 */
export async function executeProjectAi(
  input: ExecuteProjectAiInput,
): Promise<AiGatewayResult> {
  input.signal?.throwIfAborted();
  const [project] = await db
    .select({
      organisationId: projects.organisationId,
      restrictedMode: projects.restrictedMode,
    })
    .from(projects)
    .where(eq(projects.id, input.projectId))
    .limit(1);
  if (!project?.organisationId) throw new AiGatewayError("AI_INVALID_REQUEST");
  const organisationId = project.organisationId;

  const runtime = configuredAiRuntime();
  const releaseGate = configuredAiReleaseGateStatus(runtime);
  if (releaseGate.applicable && !releaseGate.allowed)
    throw new AiGatewayError("AI_RELEASE_GATE_DENIED");
  const productionEnvironmentApproval =
    process.env[productionCapabilityEnvironmentKey(input.capability)] ===
    "true";
  return executeAiGatewayRequest({
    capability: input.capability,
    environment: runtime.environment,
    globalKillSwitchEngaged: runtime.globalKillSwitchEngaged,
    resolveCapabilityEnabled:
      runtime.environment === "production"
        ? async () =>
            productionEnvironmentApproval &&
            (await isExplicitTenantFeatureEnabled(
              organisationId,
              `ai_${input.capability}`,
            ))
        : undefined,
    restrictedMode: project.restrictedMode,
    modelConfiguration: runtime.modelConfiguration,
    budget: runtime.budget,
    providerPolicy: runtime.providerPolicy,
    adapters: configuredModelAdapters(),
    userContent: input.userContent,
    idempotencyKey: input.idempotencyKey,
    signal: input.signal,
  });
}
