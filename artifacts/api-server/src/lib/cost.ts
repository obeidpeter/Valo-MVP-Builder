/**
 * Per-engagement model-cost telemetry (FR-ANL-03 / NFR-CST-01).
 *
 * llm_runs stores raw token counts per call; cost is DERIVED here at read
 * time so a rate change never rewrites history. Rates are kobo per 1,000
 * tokens, configurable via env so the deploy environment can track the
 * provider's actual pricing; the defaults are deliberately conservative
 * (rounded up) so variance reads against the BP's ₦15–30k unit assumption
 * err on the honest side.
 */

function rateFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/** Kobo per 1,000 prompt tokens. */
export const INPUT_KOBO_PER_1K = rateFromEnv("LLM_COST_INPUT_KOBO_PER_1K", 400);
/** Kobo per 1,000 completion tokens. */
export const OUTPUT_KOBO_PER_1K = rateFromEnv("LLM_COST_OUTPUT_KOBO_PER_1K", 1600);

/** BP §8.2 unit assumption band, in kobo (₦15,000–₦30,000). */
export const UNIT_ASSUMPTION_KOBO = { low: 15_000_00, high: 30_000_00 } as const;

export interface CostEstimate {
  promptTokens: number;
  completionTokens: number;
  estimatedKobo: number;
}

export function estimateCostKobo(promptTokens: number, completionTokens: number): number {
  return Math.round(
    (promptTokens / 1000) * INPUT_KOBO_PER_1K + (completionTokens / 1000) * OUTPUT_KOBO_PER_1K,
  );
}

export function summarizeUsage(
  rows: Array<{ promptTokens: number | null; completionTokens: number | null }>,
): CostEstimate {
  let promptTokens = 0;
  let completionTokens = 0;
  for (const row of rows) {
    promptTokens += row.promptTokens ?? 0;
    completionTokens += row.completionTokens ?? 0;
  }
  return { promptTokens, completionTokens, estimatedKobo: estimateCostKobo(promptTokens, completionTokens) };
}
