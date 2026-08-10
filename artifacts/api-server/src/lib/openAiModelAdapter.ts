import type {
  AdapterHealth,
  JsonModelAdapter,
  JsonModelRequest,
  JsonModelResponse,
  ProviderDataGovernance,
  ProviderRetentionMode,
} from "./providerContracts";
import { hasVerifiedModelDataGovernance } from "./providerContracts";

const configured = Boolean(
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL &&
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
);

function normalizedEndpoint(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    ) {
      return null;
    }
    return parsed.href.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

/** Production content may go only to the exact reviewed HTTPS endpoint. */
export function configuredOpenAiBaseUrlApproved(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  const configuredEndpoint = normalizedEndpoint(
    environment.AI_INTEGRATIONS_OPENAI_BASE_URL,
  );
  const approvedEndpoint = normalizedEndpoint(
    environment.OPENAI_ADAPTER_APPROVED_BASE_URL,
  );
  return (
    configuredEndpoint !== null &&
    approvedEndpoint !== null &&
    configuredEndpoint === approvedEndpoint
  );
}

function retentionModeFromEnvironment(
  raw: string | undefined,
): ProviderRetentionMode {
  return new Set<ProviderRetentionMode>([
    "zero",
    "bounded",
    "provider_default",
  ]).has(raw as ProviderRetentionMode)
    ? (raw as ProviderRetentionMode)
    : "unknown";
}

function boundedRetentionDays(
  mode: ProviderRetentionMode,
  raw: string | undefined,
): number | null {
  if (mode !== "bounded" || !raw?.trim()) return null;
  const days = Number(raw);
  return Number.isInteger(days) && days >= 0 ? days : null;
}

function approvedRegions(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return Array.from(
    new Set(
      raw
        .split(",")
        .map((region) => region.trim().toLowerCase())
        .filter(Boolean),
    ),
  ).sort();
}

export function configuredOpenAiDataGovernance(
  environment: NodeJS.ProcessEnv = process.env,
): ProviderDataGovernance {
  const retentionMode = retentionModeFromEnvironment(
    environment.OPENAI_ADAPTER_RETENTION_MODE,
  );
  return {
    externallyHosted: true,
    noTrainingVerified:
      environment.OPENAI_ADAPTER_NO_TRAINING_VERIFIED === "true",
    retentionMode,
    maxRetentionDays: boundedRetentionDays(
      retentionMode,
      environment.OPENAI_ADAPTER_RETENTION_DAYS,
    ),
    regions: approvedRegions(environment.OPENAI_ADAPTER_APPROVED_REGIONS),
    dpaApproved: environment.OPENAI_ADAPTER_DPA_APPROVED === "true",
    // Restricted Mode is deliberately unavailable for this external adapter.
    restrictedModeEligible: false,
    evidenceVersion:
      environment.OPENAI_ADAPTER_GOVERNANCE_EVIDENCE_VERSION?.trim() || null,
  };
}

export function openAiResponseFormat(
  outputSchema: JsonModelRequest["outputSchema"],
):
  | { type: "json_object" }
  | {
      type: "json_schema";
      json_schema: {
        name: string;
        strict: true;
        schema: Readonly<Record<string, unknown>>;
      };
    } {
  if (!outputSchema) return { type: "json_object" };
  return {
    type: "json_schema",
    json_schema: {
      name: outputSchema.name,
      strict: true,
      schema: outputSchema.schema,
    },
  };
}

export class OpenAiJsonModelAdapter implements JsonModelAdapter {
  readonly descriptor = {
    kind: "model" as const,
    provider: "openai",
    mode: (process.env.NODE_ENV === "production"
      ? "production"
      : "development") as "production" | "development",
    productionApproved:
      process.env.OPENAI_ADAPTER_PRODUCTION_APPROVED === "true" &&
      configuredOpenAiBaseUrlApproved(),
    capabilities: ["structured_json", "multimodal_pdf", "usage_telemetry"],
    dataGovernance: configuredOpenAiDataGovernance(),
  };

  async health(): Promise<AdapterHealth> {
    return {
      healthy: configured,
      checkedAt: new Date().toISOString(),
      message: configured
        ? "OpenAI adapter is configured."
        : "OpenAI adapter secrets are unavailable.",
    };
  }

  async completeJson(request: JsonModelRequest): Promise<JsonModelResponse> {
    if (!configured) {
      throw new Error("OpenAI adapter secrets are unavailable");
    }
    if (
      process.env.NODE_ENV === "production" &&
      (!this.descriptor.productionApproved ||
        !hasVerifiedModelDataGovernance(this.descriptor))
    ) {
      throw new Error("OpenAI adapter production governance is unavailable");
    }
    // Keep provider construction lazy so health checks, offline tests and
    // feature-gated deployments can start without evaluating a secret-bound
    // client module. Production policy still prevents this call unless the
    // adapter is explicitly approved.
    const { openai } = await import("@workspace/integrations-openai-ai-server");
    const controller = new AbortController();
    const abortFromCaller = () => controller.abort();
    request.signal?.addEventListener("abort", abortFromCaller, { once: true });
    if (request.signal?.aborted) controller.abort();
    const timeout = setTimeout(() => controller.abort(), request.timeoutMs);
    try {
      const completion = await openai.chat.completions.create(
        {
          model: request.model,
          max_completion_tokens: request.maxOutputTokens,
          response_format: openAiResponseFormat(request.outputSchema) as never,
          store: false,
          messages: request.messages as never,
        },
        {
          signal: controller.signal,
          headers: { "Idempotency-Key": request.idempotencyKey },
        },
      );
      return {
        content: completion.choices[0]?.message?.content ?? "{}",
        promptTokens: completion.usage?.prompt_tokens ?? null,
        completionTokens: completion.usage?.completion_tokens ?? null,
        providerRequestId: completion.id,
      };
    } finally {
      clearTimeout(timeout);
      request.signal?.removeEventListener("abort", abortFromCaller);
    }
  }
}

export function configuredModelAdapters(): JsonModelAdapter[] {
  const adapter = new OpenAiJsonModelAdapter();
  if (
    process.env.NODE_ENV === "production" &&
    (!configured ||
      !adapter.descriptor.productionApproved ||
      !hasVerifiedModelDataGovernance(adapter.descriptor))
  ) {
    return [];
  }
  return [adapter];
}

export function isRetryableModelError(error: unknown): boolean {
  if (!(error instanceof Error)) return true;
  const status = (error as Error & { status?: number }).status;
  if (status != null)
    return status === 408 || status === 409 || status === 429 || status >= 500;
  return (
    error.name === "AbortError" ||
    /timeout|network|socket|temporar/i.test(error.message)
  );
}
