/**
 * Provenance identifiers (NFR-AUD-01): the single source of truth for which
 * engine, prompt pack, and model are in service. Every generated report is
 * stamped with all three so a signed deliverable can always be traced back to
 * the exact configuration that produced it.
 *
 * Bump PROMPT_PACK_VERSION whenever any system prompt in `lib/llm.ts`
 * changes; bump ENGINE_VERSION on releases of the deterministic core or
 * report assembly.
 */
export const ENGINE_VERSION = "valo-autopsy-engine/gate0-v1";
export const PROMPT_PACK_VERSION = "gate0-v1";
export const MODEL_ID = "gpt-5.4";
