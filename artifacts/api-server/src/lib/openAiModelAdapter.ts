import type {
  AdapterHealth,
  JsonModelAdapter,
  JsonModelRequest,
  JsonModelResponse,
} from "./providerContracts";

const configured = Boolean(
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL &&
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
);

export class OpenAiJsonModelAdapter implements JsonModelAdapter {
  readonly descriptor = {
    kind: "model" as const,
    provider: "openai",
    mode: (process.env.NODE_ENV === "production"
      ? "production"
      : "development") as "production" | "development",
    productionApproved:
      process.env.OPENAI_ADAPTER_PRODUCTION_APPROVED === "true",
    capabilities: ["structured_json", "multimodal_pdf", "usage_telemetry"],
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
    // Keep provider construction lazy so health checks, offline tests and
    // feature-gated deployments can start without evaluating a secret-bound
    // client module. Production policy still prevents this call unless the
    // adapter is explicitly approved.
    const { openai } = await import("@workspace/integrations-openai-ai-server");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), request.timeoutMs);
    try {
      const completion = await openai.chat.completions.create(
        {
          model: request.model,
          max_completion_tokens: request.maxOutputTokens,
          response_format: { type: "json_object" },
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
    }
  }
}

export function configuredModelAdapters(): JsonModelAdapter[] {
  const adapter = new OpenAiJsonModelAdapter();
  if (
    process.env.NODE_ENV === "production" &&
    (!configured || !adapter.descriptor.productionApproved)
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
