# Pre-ship live proof gate

The deterministic verification stack (typecheck, unit + DB tests, both builds,
and the **offline** halves of the doctrine, injection, and eval-harness checks)
runs on every push/PR in CI (`.github/workflows/ci.yml`).

The **live** proofs make real model calls, so they need the model key. That key
is the Replit AI integration proxy (`AI_INTEGRATIONS_OPENAI_*`), which exists in
the Replit environment (dev **and** deploy) and **not** in GitHub Actions. The
live proofs are therefore run in the Replit environment, not CI.

## When to run

Run the live gate before shipping a **model or prompt change** — in practice,
whenever you bump `MODEL_ID` or `PROMPT_PACK_VERSION` in
`artifacts/api-server/src/lib/provenance.ts`, or edit any system prompt in
`artifacts/api-server/src/lib/llm.ts`.

## How to run

From the Replit workspace (or the deploy shell), one command runs all three
live proofs in sequence and exits non-zero if any fails:

```bash
pnpm --filter @workspace/api-server prove:ship
```

That is equivalent to running, in order:

```bash
pnpm --filter @workspace/api-server prove:doctrine    # source-citation / no-fabrication / risk-gating e2e
pnpm --filter @workspace/api-server prove:injection    # hostile-corpus containment on real model output
pnpm --filter @workspace/api-server eval:harness       # engine recall vs the hand-labelled ground truth
```

Do not ship the model/prompt change if `prove:ship` fails.

## Reading the output

Each proof prints a `✓`/`✗` line per assertion and a final
`RESULT: N passed, M failed`. The eval harness additionally prints, per tender,
the recall (`matched/total`) and the exact **missed** requirements, then the
overall recall against the target and the list of tenders with misses — so a
recall regression names the failing cases directly.

## Tuning the eval-harness target

The eval harness fails when overall recall drops below the **v0 target (85%)**.
Override it for a stricter local run:

```bash
EVAL_RECALL_TARGET=0.9 pnpm --filter @workspace/api-server eval:harness
```

The v1.0 bar (≥95% recall over ≥25 documents) is a later milestone; this is v0
with ≥10 hand-labelled tenders (`artifacts/api-server/scripts/eval-corpus/`).
