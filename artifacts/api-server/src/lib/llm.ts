import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  db,
  llmRuns,
  projects,
  withIndependentTenantDatabase,
} from "@workspace/db";
import { MODEL_ID, PROMPT_PACK_VERSION } from "./provenance";
import {
  sanitizeExtractedRequirements,
  sanitizeMappedEvidence,
  sanitizeSuggestedDefects,
} from "./sanitizeLlm";
import { AiGatewayError, type AiGatewayTelemetry } from "./aiGateway";
import { aiSourceSha256, pdfOcrIdempotencyKey } from "./aiIdempotency";
import type { AiCapabilityId } from "./aiPolicy";
import {
  buildRegisteredDefectPrompt,
  buildRegisteredEvidencePrompt,
  buildRegisteredPdfOcrContent,
  buildRegisteredRequirementPrompt,
  buildRegisteredResponsivenessPrompt,
  type CONFIDENCE_LEVELS,
  type DEFECT_SEVERITIES,
  type DEFECT_TYPES,
  type EVIDENCE_STATUSES,
  type REQUIREMENT_CATEGORIES,
} from "./aiPromptRegistry";
import { executeProjectAi } from "./aiRuntime";
import { completeBoundedInput } from "./sourceGrounding";

const MODEL = MODEL_ID;
const PROMPT_VERSION = PROMPT_PACK_VERSION;
export interface LlmUsage {
  promptTokens: number | null;
  completionTokens: number | null;
}

async function logRun(params: {
  projectId?: string | null;
  task: string;
  input: string;
  output?: unknown;
  usage?: LlmUsage;
  error?: string;
  telemetry?: AiGatewayTelemetry;
}): Promise<void> {
  const [project] = params.projectId
    ? await db
        .select({ organisationId: projects.organisationId })
        .from(projects)
        .where(eq(projects.id, params.projectId))
    : [];
  const organisationId = project?.organisationId;
  if (!organisationId) throw new Error("AI telemetry tenant is unavailable");
  await withIndependentTenantDatabase(organisationId, () =>
    db.insert(llmRuns).values({
      organisationId,
      projectId: params.projectId ?? null,
      task: params.task,
      model: params.telemetry?.model ?? MODEL,
      promptVersion: params.telemetry?.promptVersion ?? PROMPT_VERSION,
      inputHash: createHash("sha256")
        .update(params.input)
        .digest("hex")
        .slice(0, 32),
      outputSummary:
        params.output || params.telemetry
          ? JSON.stringify({
              result: params.output ?? null,
              provenance: params.telemetry
                ? {
                    provider: params.telemetry.provider,
                    providerRequestId: params.telemetry.providerRequestId,
                    providerAttempt: params.telemetry.providerAttempt,
                    fallbackUsed: params.telemetry.fallbackUsed,
                    latencyMs: params.telemetry.latencyMs,
                    costMinor: params.telemetry.costMinor,
                    costCurrency: params.telemetry.costCurrency,
                    costRateCardVersion: params.telemetry.costRateCardVersion,
                    modelConfigurationVersion:
                      params.telemetry.modelConfigurationVersion,
                    promptHash: params.telemetry.promptHash,
                    schemaVersion: params.telemetry.schemaVersion,
                    schemaHash: params.telemetry.schemaHash,
                    providerGovernanceEvidenceVersion:
                      params.telemetry.providerGovernanceEvidenceVersion,
                    providerHealthCheckedAt:
                      params.telemetry.providerHealthCheckedAt,
                  }
                : null,
            }).slice(0, 2000)
          : null,
      promptTokens:
        params.telemetry?.promptTokens ?? params.usage?.promptTokens ?? null,
      completionTokens:
        params.telemetry?.completionTokens ??
        params.usage?.completionTokens ??
        null,
      error: params.error ?? null,
    }),
  );
}

async function callJson(
  capability: AiCapabilityId,
  projectId: string,
  userContent: unknown,
  opts?: { signal?: AbortSignal },
): Promise<{ data: any; telemetry: AiGatewayTelemetry }> {
  // Configured adapters do not promise revocable provider processing. Check
  // immediately before disclosure and again after the provider settles; route
  // callers keep their tenant transaction/lock held across that full window.
  const idempotencyKey = createHash("sha256")
    .update(
      `${projectId}\0${capability}\0${PROMPT_VERSION}\0${JSON.stringify(userContent)}`,
    )
    .digest("hex");
  const result = await executeProjectAi({
    capability,
    projectId,
    userContent,
    idempotencyKey,
    signal: opts?.signal,
  });
  return {
    data: result.output,
    telemetry: result.telemetry,
  };
}

function safeAiErrorCode(error: unknown): string {
  return error instanceof AiGatewayError ? error.code : "AI_INTERNAL_FAILURE";
}

async function logFailureDurably(params: {
  projectId: string;
  task: string;
  input: string;
  error: unknown;
}): Promise<void> {
  await logRun({
    projectId: params.projectId,
    task: params.task,
    input: params.input,
    error: safeAiErrorCode(params.error),
    telemetry:
      params.error instanceof AiGatewayError
        ? params.error.telemetry
        : undefined,
  });
}

/**
 * Multimodal fallback for scanned / low-text PDFs. Sends the PDF itself to the
 * multimodal model for verbatim transcription (OCR) when embedded-text
 * extraction yields little or nothing. Every call is logged to llm_runs. The
 * transcription is a SUGGESTION the reviewer verifies against the source, in
 * keeping with the no-fabrication doctrine — the prompt forbids interpretation.
 */
export async function extractPdfTextMultimodal(
  buffer: Buffer,
  opts?: {
    projectId?: string | null;
    filename?: string;
    signal?: AbortSignal;
  },
): Promise<string> {
  // Provider adapters do not claim revocable processing once a request has
  // been accepted. Check cancellation immediately before disclosure; if the
  // request disconnects after this point, the caller keeps its project lock
  // until the provider attempt actually settles.
  opts?.signal?.throwIfAborted();
  if (!opts?.projectId) throw new AiGatewayError("AI_INVALID_REQUEST");
  const filename = opts?.filename ?? "document.pdf";
  const dataUrl = `data:application/pdf;base64,${buffer.toString("base64")}`;
  const inputTag = `pdf:${filename}:${buffer.length}b:sha256:${aiSourceSha256(buffer)}`;
  try {
    const result = await executeProjectAi({
      capability: "extract_pdf_multimodal",
      projectId: opts.projectId,
      userContent: buildRegisteredPdfOcrContent(filename, dataUrl),
      idempotencyKey: pdfOcrIdempotencyKey({
        projectId: opts.projectId,
        promptVersion: PROMPT_VERSION,
        filename,
        bytes: buffer,
      }),
      signal: opts.signal,
    });
    const parsed = result.output as { text?: unknown };
    const text = typeof parsed?.text === "string" ? parsed.text.trim() : "";
    await logRun({
      projectId: opts.projectId,
      task: "extract_pdf_multimodal",
      input: inputTag,
      output: { chars: text.length },
      telemetry: result.telemetry,
    });
    return text;
  } catch (error) {
    await logFailureDurably({
      projectId: opts.projectId,
      task: "extract_pdf_multimodal",
      input: inputTag,
      error,
    });
    throw error;
  }
}

export interface DocForLlm {
  id: string;
  filename: string;
  type: string;
  contentText: string | null;
}

export interface ExtractedRequirement {
  text: string;
  category: (typeof REQUIREMENT_CATEGORIES)[number];
  expectedEvidence?: string | null;
  isMandatory: boolean;
  confidence?: (typeof CONFIDENCE_LEVELS)[number];
  pageRef?: string | null;
  clauseRef?: string | null;
  sourceDocId?: string | null;
  sourceQuote?: string | null;
}

export async function extractRequirements(
  projectId: string,
  docs: DocForLlm[],
  opts?: { signal?: AbortSignal },
): Promise<{ requirements: ExtractedRequirement[]; model: string }> {
  opts?.signal?.throwIfAborted();
  // Sampling a tender makes a partial extraction look complete. Until the
  // versioned chunking/retrieval pipeline exists, fail closed before provider
  // disclosure instead of silently truncating source text.
  const input = completeBoundedInput(buildRegisteredRequirementPrompt(docs));
  try {
    const { data: parsed, telemetry } = await callJson(
      "extract_requirements",
      projectId,
      input,
      opts,
    );
    opts?.signal?.throwIfAborted();
    // Schema containment (FR-EXT-02): model output never reaches the caller
    // unsanitized — enums clamped, strings capped, doc references restricted
    // to the supplied set.
    const requirements = sanitizeExtractedRequirements(
      parsed?.requirements,
      new Set(docs.map((d) => d.id)),
    );
    await logRun({
      projectId,
      task: "extract_requirements",
      input,
      output: { count: requirements.length },
      telemetry,
    });
    return { requirements, model: telemetry.model };
  } catch (error) {
    await logFailureDurably({
      projectId,
      task: "extract_requirements",
      input,
      error,
    });
    throw error;
  }
}

export interface MappedEvidence {
  requirementId: string;
  documentId?: string | null;
  evidenceStatus: (typeof EVIDENCE_STATUSES)[number];
  excerpt?: string | null;
  notes?: string | null;
}

export async function mapEvidence(
  projectId: string,
  requirements: { id: string; text: string; expectedEvidence: string | null }[],
  docs: DocForLlm[],
  opts?: { signal?: AbortSignal },
): Promise<{ items: MappedEvidence[]; model: string }> {
  opts?.signal?.throwIfAborted();
  // Evidence mapping must see the complete selected corpus or explicitly
  // abstain. A silently truncated bid can turn present evidence into "missing".
  const input = completeBoundedInput(
    buildRegisteredEvidencePrompt(requirements, docs),
  );
  try {
    const { data: parsed, telemetry } = await callJson(
      "map_evidence",
      projectId,
      input,
      opts,
    );
    opts?.signal?.throwIfAborted();
    const items = sanitizeMappedEvidence(
      parsed?.items,
      new Set(requirements.map((r) => r.id)),
      new Set(docs.map((d) => d.id)),
    );
    await logRun({
      projectId,
      task: "map_evidence",
      input,
      output: { count: items.length },
      telemetry,
    });
    return { items, model: telemetry.model };
  } catch (error) {
    await logFailureDurably({
      projectId,
      task: "map_evidence",
      input,
      error,
    });
    throw error;
  }
}

export interface SuggestedDefect {
  requirementId?: string | null;
  type: (typeof DEFECT_TYPES)[number];
  severity: (typeof DEFECT_SEVERITIES)[number];
  description: string;
  remediation?: string | null;
}

export async function suggestDefects(
  projectId: string,
  requirements: { id: string; text: string; isMandatory: boolean }[],
  evidence: {
    requirementId: string;
    evidenceStatus: string;
    notes: string | null;
  }[],
  opts?: { signal?: AbortSignal },
): Promise<{ defects: SuggestedDefect[]; model: string }> {
  opts?.signal?.throwIfAborted();
  const input = completeBoundedInput(
    buildRegisteredDefectPrompt(requirements, evidence),
  );
  try {
    const { data: parsed, telemetry } = await callJson(
      "suggest_defects",
      projectId,
      input,
      opts,
    );
    opts?.signal?.throwIfAborted();
    // Fail closed on taxonomy: a defect whose type/severity is outside the
    // schema is dropped by the sanitizer, never coerced into a guess.
    const defects = sanitizeSuggestedDefects(
      parsed?.defects,
      new Set(requirements.map((r) => r.id)),
    );
    await logRun({
      projectId,
      task: "suggest_defects",
      input,
      output: { count: defects.length },
      telemetry,
    });
    return { defects, model: telemetry.model };
  } catch (error) {
    await logFailureDurably({
      projectId,
      task: "suggest_defects",
      input,
      error,
    });
    throw error;
  }
}

export async function responsivenessReview(
  projectId: string,
  context: {
    tenderTitle: string;
    requirements: { text: string; isMandatory: boolean }[];
    defects: { type: string; severity: string; description: string }[];
  },
  opts?: { signal?: AbortSignal },
): Promise<{ review: string; model: string }> {
  opts?.signal?.throwIfAborted();
  const input = completeBoundedInput(
    buildRegisteredResponsivenessPrompt(context),
  );
  try {
    const { data: parsed, telemetry } = await callJson(
      "responsiveness_review",
      projectId,
      input,
      opts,
    );
    opts?.signal?.throwIfAborted();
    const review = typeof parsed?.review === "string" ? parsed.review : "";
    await logRun({
      projectId,
      task: "responsiveness_review",
      input,
      output: { chars: review.length },
      telemetry,
    });
    return { review, model: telemetry.model };
  } catch (error) {
    await logFailureDurably({
      projectId,
      task: "responsiveness_review",
      input,
      error,
    });
    throw error;
  }
}
