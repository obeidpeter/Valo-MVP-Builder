import {
  AI_CAPABILITY_POLICY,
  evaluateAiCapabilityGate,
  type AiCapabilityGateResolver,
  type AiCapabilityId,
  type AiRuntimeEnvironment,
  type AiSafeErrorCode,
} from "./aiPolicy";
import {
  canonicalJson,
  getAiPromptDefinition,
  parseAndValidateAiOutput,
  sha256,
} from "./aiPromptRegistry";
import {
  executeJsonWithFallback,
  type AdapterDescriptor,
  type AdapterHealth,
  type JsonModelAdapter,
  type ProviderDataGovernance,
} from "./providerContracts";

const SAFE_MESSAGES: Readonly<Record<AiSafeErrorCode, string>> = {
  AI_GLOBAL_DISABLED: "AI assistance is disabled.",
  AI_CAPABILITY_DISABLED: "This AI capability is disabled.",
  AI_CAPABILITY_GATE_UNAVAILABLE:
    "AI capability approval could not be verified.",
  AI_INVALID_REQUEST: "The AI request is invalid.",
  AI_INPUT_LIMIT_EXCEEDED: "The AI request exceeds its input limit.",
  AI_MODEL_CONFIGURATION_UNAVAILABLE:
    "An approved model configuration is unavailable.",
  AI_RELEASE_GATE_DENIED:
    "Production AI release evidence is incomplete or invalid.",
  AI_BUDGET_UNAVAILABLE: "An approved AI budget is unavailable.",
  AI_BUDGET_CURRENCY_MISMATCH:
    "The AI budget currency does not match the capability policy.",
  AI_BUDGET_EXCEEDED: "The AI request exceeds its approved cost limit.",
  AI_PROVIDER_UNAVAILABLE: "No eligible AI provider is available.",
  AI_PROVIDER_NOT_APPROVED: "No production-approved AI provider is available.",
  AI_PROVIDER_PRIVACY_UNVERIFIED:
    "AI provider privacy controls could not be verified.",
  AI_PROVIDER_REGION_UNAVAILABLE:
    "No AI provider is approved for the required processing region.",
  AI_PROVIDER_RETENTION_INCOMPATIBLE:
    "No AI provider satisfies the required retention policy.",
  AI_RESTRICTED_MODE_DENIED:
    "External AI processing is unavailable in Restricted Mode.",
  AI_PROVIDER_UNHEALTHY: "The approved AI provider is unavailable.",
  AI_PROVIDER_FAILED: "The AI provider could not complete the request.",
  AI_USAGE_UNAVAILABLE: "AI usage and cost could not be verified.",
  AI_OUTPUT_SCHEMA_INVALID: "The AI output failed schema validation.",
  AI_CANCELLED: "The AI request was cancelled.",
  AI_INTERNAL_FAILURE: "The AI request could not be completed safely.",
};

export interface AiGatewayTelemetry {
  capability: AiCapabilityId;
  provider: string;
  providerRequestId: string | null;
  providerAttempt: number;
  fallbackUsed: boolean;
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  costMinor: number;
  costCurrency: string;
  costRateCardVersion: string;
  model: string;
  modelConfigurationVersion: string;
  promptVersion: string;
  promptHash: string;
  schemaVersion: string;
  schemaHash: string;
  providerGovernanceEvidenceVersion: string;
  providerHealthCheckedAt: string;
}

export class AiGatewayError extends Error {
  readonly code: AiSafeErrorCode;
  readonly telemetry?: AiGatewayTelemetry;

  constructor(code: AiSafeErrorCode, telemetry?: AiGatewayTelemetry) {
    super(SAFE_MESSAGES[code]);
    this.name = "AiGatewayError";
    this.code = code;
    this.telemetry = telemetry;
  }
}

export interface AiGatewayModelConfiguration {
  model: string;
  configurationVersion: string;
  status: "draft" | "promoted" | "retired";
  evaluationApproved: boolean;
}

export interface AiGatewayBudget {
  approved: boolean;
  currency: string;
  remainingMinor: number;
  inputCostMinorPerThousandTokens: number;
  outputCostMinorPerThousandTokens: number;
  rateCardVersion: string;
}

export interface AiProviderPolicy {
  requiredRegion: string;
  requireZeroRetention: boolean;
  maxRetentionDays: number;
}

export interface AiGatewayRequest {
  capability: AiCapabilityId;
  environment: AiRuntimeEnvironment;
  globalKillSwitchEngaged: boolean;
  resolveCapabilityEnabled?: AiCapabilityGateResolver;
  restrictedMode: boolean;
  modelConfiguration: AiGatewayModelConfiguration;
  budget: AiGatewayBudget | null;
  providerPolicy: AiProviderPolicy;
  adapters: JsonModelAdapter[];
  userContent: unknown;
  idempotencyKey: string;
  signal?: AbortSignal;
}

export interface AiGatewayResult {
  output: unknown;
  telemetry: AiGatewayTelemetry;
}

type ProviderEligibilityCode = Extract<
  AiSafeErrorCode,
  | "AI_PROVIDER_NOT_APPROVED"
  | "AI_PROVIDER_PRIVACY_UNVERIFIED"
  | "AI_PROVIDER_REGION_UNAVAILABLE"
  | "AI_PROVIDER_RETENTION_INCOMPATIBLE"
  | "AI_RESTRICTED_MODE_DENIED"
>;

export interface AiProviderEligibilityDecision {
  eligible: boolean;
  code?: ProviderEligibilityCode;
}

function normalizedRegion(value: string): string {
  return value.trim().toLowerCase();
}

function retentionDays(governance: ProviderDataGovernance): number {
  if (governance.retentionMode === "zero") return 0;
  if (
    governance.retentionMode === "bounded" &&
    governance.maxRetentionDays != null &&
    Number.isSafeInteger(governance.maxRetentionDays) &&
    governance.maxRetentionDays >= 0
  ) {
    return governance.maxRetentionDays;
  }
  return Number.POSITIVE_INFINITY;
}

export function evaluateAiProviderEligibility(input: {
  descriptor: AdapterDescriptor;
  environment: AiRuntimeEnvironment;
  restrictedMode: boolean;
  policy: AiProviderPolicy;
}): AiProviderEligibilityDecision {
  const { descriptor, environment, restrictedMode, policy } = input;
  if (
    environment === "production" &&
    (descriptor.mode !== "production" || descriptor.productionApproved !== true)
  ) {
    return { eligible: false, code: "AI_PROVIDER_NOT_APPROVED" };
  }
  const governance = descriptor.dataGovernance;
  if (
    !governance ||
    governance.noTrainingVerified !== true ||
    governance.dpaApproved !== true ||
    typeof governance.externallyHosted !== "boolean" ||
    typeof governance.restrictedModeEligible !== "boolean" ||
    !governance.evidenceVersion?.trim() ||
    !Array.isArray(governance.regions) ||
    !governance.regions.every(
      (approvedRegion) =>
        typeof approvedRegion === "string" && approvedRegion.trim().length > 0,
    )
  ) {
    return { eligible: false, code: "AI_PROVIDER_PRIVACY_UNVERIFIED" };
  }
  if (
    restrictedMode &&
    (governance.externallyHosted || !governance.restrictedModeEligible)
  ) {
    return { eligible: false, code: "AI_RESTRICTED_MODE_DENIED" };
  }
  const region = normalizedRegion(policy.requiredRegion);
  if (!region || !governance.regions.map(normalizedRegion).includes(region)) {
    return { eligible: false, code: "AI_PROVIDER_REGION_UNAVAILABLE" };
  }
  const providerRetentionDays = retentionDays(governance);
  if (
    (policy.requireZeroRetention && providerRetentionDays !== 0) ||
    !Number.isSafeInteger(policy.maxRetentionDays) ||
    policy.maxRetentionDays < 0 ||
    providerRetentionDays > policy.maxRetentionDays
  ) {
    return {
      eligible: false,
      code: "AI_PROVIDER_RETENTION_INCOMPATIBLE",
    };
  }
  return { eligible: true };
}

/** A fallback may improve controls, but can never weaken the first provider. */
export function providerGovernanceAtLeastAsProtective(
  candidate: ProviderDataGovernance,
  baseline: ProviderDataGovernance,
): boolean {
  if (
    candidate.noTrainingVerified !== true ||
    candidate.dpaApproved !== true ||
    typeof candidate.externallyHosted !== "boolean" ||
    typeof candidate.restrictedModeEligible !== "boolean"
  ) {
    return false;
  }
  if (!baseline.externallyHosted && candidate.externallyHosted) return false;
  if (baseline.restrictedModeEligible && !candidate.restrictedModeEligible)
    return false;
  return retentionDays(candidate) <= retentionDays(baseline);
}

function validNonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function calculateCostMinor(
  promptTokens: number,
  completionTokens: number,
  budget: AiGatewayBudget,
): number {
  const ceilPerThousand = (tokens: number, rate: number): bigint =>
    (BigInt(tokens) * BigInt(rate) + 999n) / 1000n;
  const cost =
    ceilPerThousand(promptTokens, budget.inputCostMinorPerThousandTokens) +
    ceilPerThousand(completionTokens, budget.outputCostMinorPerThousandTokens);
  if (cost > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new AiGatewayError("AI_BUDGET_EXCEEDED");
  }
  return Number(cost);
}

function validateBudget(
  budget: AiGatewayBudget | null,
  expectedCurrency: string,
): asserts budget is AiGatewayBudget {
  if (
    !budget ||
    budget.approved !== true ||
    typeof budget.rateCardVersion !== "string" ||
    !budget.rateCardVersion.trim() ||
    typeof budget.currency !== "string" ||
    !validNonNegativeInteger(budget.remainingMinor) ||
    !validNonNegativeInteger(budget.inputCostMinorPerThousandTokens) ||
    budget.inputCostMinorPerThousandTokens === 0 ||
    !validNonNegativeInteger(budget.outputCostMinorPerThousandTokens) ||
    budget.outputCostMinorPerThousandTokens === 0
  ) {
    throw new AiGatewayError("AI_BUDGET_UNAVAILABLE");
  }
  if (budget.currency !== expectedCurrency) {
    throw new AiGatewayError("AI_BUDGET_CURRENCY_MISMATCH");
  }
}

export function providerRequestIdempotencyKey(input: {
  callerKey: string;
  capability: AiCapabilityId;
  model: string;
  modelConfigurationVersion: string;
  promptVersion: string;
  promptHash: string;
  schemaVersion: string;
  schemaHash: string;
}): string {
  return sha256(canonicalJson(input));
}

function maximumAttemptReservation(
  perAttemptMinor: number,
  providerCount: number,
  attemptsPerProvider: number,
): number {
  const total =
    BigInt(perAttemptMinor) *
    BigInt(providerCount) *
    BigInt(attemptsPerProvider);
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new AiGatewayError("AI_BUDGET_EXCEEDED");
  }
  return Number(total);
}

/**
 * Conservative reservation used by both execution and the operations view.
 * `inputBytes` deliberately overestimates input tokens, and every permitted
 * retry/fallback attempt is reserved before any provider disclosure.
 */
export function maximumCapabilityReservationMinor(
  capability: AiCapabilityId,
  budget: AiGatewayBudget,
  inputBytes = AI_CAPABILITY_POLICY[capability].limits.maxInputBytes,
): number {
  const policy = AI_CAPABILITY_POLICY[capability];
  validateBudget(budget, policy.limits.costCurrency);
  if (!Number.isSafeInteger(inputBytes) || inputBytes < 0) {
    throw new AiGatewayError("AI_INVALID_REQUEST");
  }
  const perAttemptMinor = calculateCostMinor(
    inputBytes,
    policy.limits.maxOutputTokens,
    budget,
  );
  return maximumAttemptReservation(
    perAttemptMinor,
    policy.limits.maxFallbackProviders + 1,
    policy.limits.maxRetriesPerProvider + 1,
  );
}

function safeInputBytes(
  systemTemplate: string,
  outputSchema: Readonly<Record<string, unknown>>,
  userContent: unknown,
): number {
  try {
    return (
      Buffer.byteLength(systemTemplate, "utf8") +
      Buffer.byteLength(canonicalJson(outputSchema), "utf8") +
      Buffer.byteLength(canonicalJson(userContent), "utf8") +
      256
    );
  } catch {
    throw new AiGatewayError("AI_INVALID_REQUEST");
  }
}

function schemaName(capability: AiCapabilityId, schemaVersion: string): string {
  return `${capability}_${schemaVersion}`
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 64);
}

function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new AiGatewayError("AI_CANCELLED");
}

async function eligibleHealthyProviders(input: {
  request: AiGatewayRequest;
  maxFallbackProviders: number;
}): Promise<{
  adapters: JsonModelAdapter[];
  healthByProvider: Map<string, AdapterHealth>;
}> {
  const eligible: JsonModelAdapter[] = [];
  const healthByProvider = new Map<string, AdapterHealth>();
  const denialCodes: AiSafeErrorCode[] = [];
  const seenProviders = new Set<string>();
  for (const adapter of input.request.adapters) {
    if (
      !adapter ||
      !adapter.descriptor ||
      typeof adapter.descriptor.provider !== "string" ||
      !adapter.descriptor.provider.trim() ||
      !Array.isArray(adapter.descriptor.capabilities)
    ) {
      denialCodes.push("AI_PROVIDER_UNAVAILABLE");
      continue;
    }
    if (seenProviders.has(adapter.descriptor.provider)) continue;
    seenProviders.add(adapter.descriptor.provider);
    const requiredCapabilities =
      input.request.capability === "extract_pdf_multimodal"
        ? ["structured_json", "multimodal_pdf"]
        : ["structured_json"];
    if (
      !requiredCapabilities.every((capability) =>
        adapter.descriptor.capabilities.includes(capability),
      )
    ) {
      denialCodes.push("AI_PROVIDER_UNAVAILABLE");
      continue;
    }
    const decision = evaluateAiProviderEligibility({
      descriptor: adapter.descriptor,
      environment: input.request.environment,
      restrictedMode: input.request.restrictedMode,
      policy: input.request.providerPolicy,
    });
    if (!decision.eligible) {
      denialCodes.push(decision.code ?? "AI_PROVIDER_UNAVAILABLE");
      continue;
    }
    let health: AdapterHealth;
    try {
      health = await adapter.health();
    } catch {
      denialCodes.push("AI_PROVIDER_UNHEALTHY");
      continue;
    }
    if (
      !health ||
      health.healthy !== true ||
      typeof health.checkedAt !== "string" ||
      !health.checkedAt?.trim() ||
      !Number.isFinite(Date.parse(health.checkedAt))
    ) {
      denialCodes.push("AI_PROVIDER_UNHEALTHY");
      continue;
    }
    healthByProvider.set(adapter.descriptor.provider, health);
    eligible.push(adapter);
  }
  if (eligible.length === 0) {
    throw new AiGatewayError(denialCodes[0] ?? "AI_PROVIDER_UNAVAILABLE");
  }
  const primary = eligible[0];
  const primaryGovernance = primary.descriptor.dataGovernance!;
  const fallback = eligible
    .slice(1)
    .filter((adapter) =>
      providerGovernanceAtLeastAsProtective(
        adapter.descriptor.dataGovernance!,
        primaryGovernance,
      ),
    )
    .slice(0, input.maxFallbackProviders);
  return { adapters: [primary, ...fallback], healthByProvider };
}

export async function executeAiGatewayRequest(
  request: AiGatewayRequest,
  dependencies: { now?: () => number } = {},
): Promise<AiGatewayResult> {
  if (
    !request ||
    !new Set(["development", "test", "production"]).has(request.environment) ||
    typeof request.globalKillSwitchEngaged !== "boolean" ||
    typeof request.restrictedMode !== "boolean" ||
    typeof request.idempotencyKey !== "string" ||
    !request.idempotencyKey.trim() ||
    request.idempotencyKey.length > 200 ||
    !Array.isArray(request.adapters) ||
    !request.modelConfiguration ||
    !request.providerPolicy ||
    typeof request.providerPolicy.requiredRegion !== "string" ||
    typeof request.providerPolicy.requireZeroRetention !== "boolean"
  ) {
    throw new AiGatewayError("AI_INVALID_REQUEST");
  }
  throwIfCancelled(request.signal);
  const capabilityPolicy = AI_CAPABILITY_POLICY[request.capability];
  if (!capabilityPolicy) throw new AiGatewayError("AI_INVALID_REQUEST");
  const gate = await evaluateAiCapabilityGate({
    capability: request.capability,
    environment: request.environment,
    globalKillSwitchEngaged: request.globalKillSwitchEngaged,
    resolveCapabilityEnabled: request.resolveCapabilityEnabled,
  });
  if (!gate.allowed) {
    throw new AiGatewayError(gate.code ?? "AI_CAPABILITY_GATE_UNAVAILABLE");
  }
  if (
    typeof request.modelConfiguration.model !== "string" ||
    !request.modelConfiguration.model.trim() ||
    typeof request.modelConfiguration.configurationVersion !== "string" ||
    !request.modelConfiguration.configurationVersion.trim() ||
    request.modelConfiguration.status === "retired" ||
    !new Set(["draft", "promoted"]).has(request.modelConfiguration.status) ||
    (request.environment === "production" &&
      (request.modelConfiguration.status !== "promoted" ||
        request.modelConfiguration.evaluationApproved !== true))
  ) {
    throw new AiGatewayError("AI_MODEL_CONFIGURATION_UNAVAILABLE");
  }
  const prompt = getAiPromptDefinition(request.capability);
  const inputBytes = safeInputBytes(
    prompt.systemTemplate,
    prompt.outputSchema,
    request.userContent,
  );
  if (inputBytes > capabilityPolicy.limits.maxInputBytes) {
    throw new AiGatewayError("AI_INPUT_LIMIT_EXCEEDED");
  }
  validateBudget(request.budget, capabilityPolicy.limits.costCurrency);
  // UTF-8 bytes are a conservative upper bound for input token count. This
  // intentionally over-reserves budget before disclosure to a provider.
  const maximumEstimatedCost = maximumCapabilityReservationMinor(
    request.capability,
    request.budget,
    inputBytes,
  );
  if (
    maximumEstimatedCost > capabilityPolicy.limits.maxCostMinor ||
    maximumEstimatedCost > request.budget.remainingMinor
  ) {
    throw new AiGatewayError("AI_BUDGET_EXCEEDED");
  }

  const providers = await eligibleHealthyProviders({
    request,
    maxFallbackProviders: capabilityPolicy.limits.maxFallbackProviders,
  });
  throwIfCancelled(request.signal);
  const now = dependencies.now ?? Date.now;
  const startedAt = now();
  const providerIdempotencyKey = providerRequestIdempotencyKey({
    callerKey: request.idempotencyKey,
    capability: request.capability,
    model: request.modelConfiguration.model,
    modelConfigurationVersion: request.modelConfiguration.configurationVersion,
    promptVersion: prompt.promptVersion,
    promptHash: prompt.promptHash,
    schemaVersion: prompt.schemaVersion,
    schemaHash: prompt.schemaHash,
  });
  let completed: Awaited<ReturnType<typeof executeJsonWithFallback>>;
  try {
    completed = await executeJsonWithFallback({
      request: {
        model: request.modelConfiguration.model,
        messages: [
          { role: "system", content: prompt.systemTemplate },
          { role: "user", content: request.userContent },
        ],
        maxOutputTokens: capabilityPolicy.limits.maxOutputTokens,
        timeoutMs: capabilityPolicy.limits.timeoutMs,
        idempotencyKey: providerIdempotencyKey,
        signal: request.signal,
        outputSchema: {
          name: schemaName(request.capability, prompt.schemaVersion),
          strict: true,
          schema: prompt.outputSchema,
        },
      },
      adapters: providers.adapters,
      attemptsPerAdapter: capabilityPolicy.limits.maxRetriesPerProvider + 1,
      retryable: (error) => {
        if (request.signal?.aborted) return false;
        if (!(error instanceof Error)) return true;
        const status = (error as Error & { status?: number }).status;
        return (
          status === 408 ||
          status === 409 ||
          status === 429 ||
          (status != null && status >= 500) ||
          error.name === "AbortError" ||
          /timeout|network|socket|temporar/i.test(error.message)
        );
      },
    });
  } catch {
    if (request.signal?.aborted) throw new AiGatewayError("AI_CANCELLED");
    throw new AiGatewayError("AI_PROVIDER_FAILED");
  }
  const latencyMs = Math.max(0, Math.round(now() - startedAt));
  throwIfCancelled(request.signal);
  const { response, provider, attempt } = completed;
  if (
    response.promptTokens == null ||
    response.completionTokens == null ||
    !validNonNegativeInteger(response.promptTokens) ||
    !validNonNegativeInteger(response.completionTokens) ||
    response.completionTokens > capabilityPolicy.limits.maxOutputTokens
  ) {
    throw new AiGatewayError("AI_USAGE_UNAVAILABLE");
  }
  const selected = providers.adapters.find(
    (adapter) => adapter.descriptor.provider === provider,
  );
  const governance = selected?.descriptor.dataGovernance;
  const health = providers.healthByProvider.get(provider);
  if (!selected || !governance?.evidenceVersion || !health) {
    throw new AiGatewayError("AI_INTERNAL_FAILURE");
  }
  const costMinor = calculateCostMinor(
    response.promptTokens,
    response.completionTokens,
    request.budget,
  );
  const telemetry: AiGatewayTelemetry = {
    capability: request.capability,
    provider,
    providerRequestId: response.providerRequestId ?? null,
    providerAttempt: attempt,
    fallbackUsed: provider !== providers.adapters[0].descriptor.provider,
    latencyMs,
    promptTokens: response.promptTokens,
    completionTokens: response.completionTokens,
    costMinor,
    costCurrency: request.budget.currency,
    costRateCardVersion: request.budget.rateCardVersion,
    model: request.modelConfiguration.model,
    modelConfigurationVersion: request.modelConfiguration.configurationVersion,
    promptVersion: prompt.promptVersion,
    promptHash: prompt.promptHash,
    schemaVersion: prompt.schemaVersion,
    schemaHash: prompt.schemaHash,
    providerGovernanceEvidenceVersion: governance.evidenceVersion,
    providerHealthCheckedAt: health.checkedAt,
  };
  if (
    costMinor > capabilityPolicy.limits.maxCostMinor ||
    costMinor > request.budget.remainingMinor
  ) {
    throw new AiGatewayError("AI_BUDGET_EXCEEDED", telemetry);
  }
  let output: unknown;
  try {
    output = parseAndValidateAiOutput(request.capability, response.content);
  } catch {
    throw new AiGatewayError("AI_OUTPUT_SCHEMA_INVALID", telemetry);
  }
  return { output, telemetry };
}
