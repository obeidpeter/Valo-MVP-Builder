---
name: Eval harness design (recall regression suite)
description: Why the extraction eval harness is shaped the way it is — v0 target, matcher semantics, and why the live gate is a documented pre-ship step not a deploy hook.
---

# Eval harness (extraction recall regression)

The eval harness measures the extraction ENGINE (LLM `extractRequirements`) against a
fixed, hand-labelled corpus of tenders with verified ground-truth requirement lists.
This is DISTINCT from the production scorecard (engine vs what humans ruled on in live
reviews). Pure logic in `src/lib/evalHarness.ts`; corpus in `scripts/eval-corpus/`;
runner `scripts/run-eval-harness.ts` (offline self-check + live recall modes).

## Durable decisions

- **v0 target is 0.85 recall, NOT the v1.0 bar (≥95% / ≥25 docs).** The v0 harness is a
  regression tripwire, not the launch-grade proof. Do not silently raise it to 0.95 or
  conflate the two bars.
  **Why:** task spec explicitly separates v0 (ship-now guard) from v1.0 (later, larger corpus).

- **Recall is measured at the REQUIREMENT-OBLIGATION level, not the numeric-detail level.**
  Ground-truth `match` uses AND-of-ORs (`string[][]`): every group must be satisfied by a
  SINGLE extracted text; within a group any alternative counts. Keep match specs anchored
  on a distinctive discriminating phrase (e.g. `"bid security"`), and avoid weak fallback
  alternatives (bare digits like `"2"`/`"3"`, generic words like `"bank"`/`"document"`) —
  they inflate recall and can mask a specificity regression.
  **Why:** code review flagged that broad single-token alternatives over-credit matches.
  **How to apply:** when adding corpus rows, prefer phrase-level alternatives
  (`"2 percent"`, `"2%"`) over bare tokens; the offline self-check only exercises each
  group's FIRST alternative, so a bad fallback won't be caught by self-check.

- **The LIVE gate is `prove:ship` (= prove:doctrine && prove:injection && eval:harness),
  run manually before shipping model/prompt changes — deliberately NOT wired into the
  `.replit` deploy pipeline.**
  **Why:** the model key is the Replit AI proxy (present in dev+deploy runtime, absent in
  GitHub CI); the deploy BUILD phase lacks reliable DB/model access, and gating every
  autoscale deploy on non-deterministic live model calls would make unrelated deploys
  flaky. This mirrors the repo's existing reviewed pattern for the doctrine/injection live
  proofs. CI runs only the deterministic offline self-check.
  **How to apply:** run `prove:ship` in the Replit env when touching `llm.ts` prompts or
  `provenance.ts` (MODEL_ID / PROMPT_PACK_VERSION); see `docs/PRE_SHIP_PROOFS.md`.
