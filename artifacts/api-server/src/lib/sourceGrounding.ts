/**
 * Deterministic source grounding for model-proposed quotes.
 *
 * Provider output is untrusted. A quote is grounded only when, after narrow
 * Unicode/whitespace normalization, it occurs verbatim in the exact source
 * document selected by the caller. We deliberately do not use fuzzy matching,
 * stemming, punctuation removal, or case folding: those transformations can
 * turn a plausible paraphrase into apparent evidence.
 */

const INVISIBLE_FORMATTING = /[\u00ad\u200b-\u200d\u2060\ufeff]/gu;
const WHITESPACE = /\s+/gu;
export const MAX_COMPLETE_MODEL_INPUT_CHARS = 60_000;

export class ModelInputTooLargeError extends Error {
  readonly code = "AI_SOURCE_CORPUS_TOO_LARGE";

  constructor(
    readonly actualChars: number,
    readonly maxChars = MAX_COMPLETE_MODEL_INPUT_CHARS,
  ) {
    super(
      `Selected source corpus is ${actualChars} characters; the safe limit is ${maxChars}. No model output was produced. Narrow the document selection or use a versioned chunking workflow.`,
    );
    this.name = "ModelInputTooLargeError";
  }
}

export function completeBoundedInput(text: string): string {
  if (text.length > MAX_COMPLETE_MODEL_INPUT_CHARS) {
    throw new ModelInputTooLargeError(text.length);
  }
  return text;
}

export function normalizeSourceText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(INVISIBLE_FORMATTING, "")
    .replace(WHITESPACE, " ")
    .trim();
}

export function isSourceQuoteGrounded(
  sourceText: string | null | undefined,
  sourceQuote: string | null | undefined,
): boolean {
  if (!sourceText || !sourceQuote) return false;
  const normalizedSource = normalizeSourceText(sourceText);
  const normalizedQuote = normalizeSourceText(sourceQuote);
  return (
    normalizedSource.length > 0 &&
    normalizedQuote.length > 0 &&
    normalizedSource.includes(normalizedQuote)
  );
}

export function isQuoteGroundedInSourceMap(
  sources: ReadonlyMap<string, string>,
  sourceId: string | null | undefined,
  sourceQuote: string | null | undefined,
): boolean {
  if (!sourceId || !sources.has(sourceId)) return false;
  return isSourceQuoteGrounded(sources.get(sourceId), sourceQuote);
}

/**
 * A model may call evidence "present" or "expired" only when its named
 * in-scope document contains the supplied excerpt. Other statuses remain
 * proposals for human review; an unsupported positive assertion is
 * deterministically downgraded. Expiry-date semantics still require a later
 * deterministic date check and named-human ruling.
 */
export function groundedEvidenceStatus<TStatus extends string>(
  status: TStatus,
  sources: ReadonlyMap<string, string>,
  documentId: string | null | undefined,
  excerpt: string | null | undefined,
): TStatus | "unclear" {
  if (status !== "present" && status !== "expired") return status;
  return isQuoteGroundedInSourceMap(sources, documentId, excerpt)
    ? status
    : "unclear";
}
