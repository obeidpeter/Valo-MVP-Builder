# Valo — Expansion Opportunities

Audit of the codebase against the Valo Business Plan v1.1/v1.2, the Replit Build Brief, the Product Roadmap v1.0, and the TRD v1.0. Originally written July 2026 against the Gate 0 MVP; updated after the Phase 1 hardening milestone (PR #1, merged July 2026) to separate what is now built from what remains.

## Shipped in the Phase 1 hardening milestone (PR #1)

- **Fatal-block invariant** (TRD I3 / FR-CSM-02) — sign-off is impossible with open fatal/likely-fatal defects; no override path.
- **Hash-chained, tamper-evident audit log** (FR-WFM-02) with verifier script, external head-anchor workflow, and DB-ordinal stray detection.
- **Fail-closed document intake** (FR-INT-01/02) — server-side SHA-256 manifests, measured sizes, NDA gate with audited denials and post-download re-check, integrity re-verification endpoint + UI, `documents_manifest.csv` in exports.
- **Full provenance stamps** (NFR-AUD-01) — engine/prompt-pack/model on every report row and DOCX sign-off block.
- **Certificate Vault v1 + expiry telemetry** (FR-VLT-01/02) — CRUD + client Vault section, deterministic T-3/T-14/T-30 bands (widened by renewal lead time), dashboard renewal radar. Delivery channels (FR-NTF-01) deliberately not faked — in-app only.
- **Exact-kobo BOQ arithmetic** (FR-BOQ-01) — BigInt money paths, zero default tolerance; **kobo-aware words-vs-figures** (FR-BOQ-02) fixing the historical fifty-cents bug.
- **LLM output containment** (FR-EXT-02, offline half) — sanitizeLlm schema clamping, fail-closed defect taxonomy, untrusted-input guardrail clause, hostile-payload suite.
- **Gate 0 Technical Scorecard** (FR-EXT-03/04/05) — origin/engineText/reviewer stamps on requirements, fixed recall definitions, live endpoint + `scorecard.json` in exports, scorecard strip vs the 85% gate.
- **Human verification queue UI** — confirm/edit/reject/add with engine-proposal diffs.
- **Capability Library v1** (FR-CAP-01 / I4 seam) — evidence-linked claims, approval hard-blocked without evidence, `claimable` derived never stored.
- **BOQ Verifier upload** — CSV/XLSX with column mapping (incl. section + amount-in-words), preview, declared grand total.

## Remaining — near-term (current gate)

1. **Async extraction pipeline** — document OCR (incl. the multimodal scanned-PDF fallback) and LLM extraction still run synchronously inside request handlers; large scanned tenders risk timeouts. `extraction_status` exists; needs a lightweight job runner + polling UI. (Build brief background-jobs requirement.)
2. **Live prompt-injection corpus** (FR-EXT-02, model-in-the-loop) — ≥10 hostile documents run against the real model in CI, in the deploy environment where the OpenAI key lives. The containment layer is in place; the live proof is not.
3. **Eval harness v0** (FR-EXT-05, §9) — ≥10 hand-labelled tenders as a recall regression suite; the scorecard measures production reviews, the harness measures the engine against ground truth.
4. **Configurable scoring + real Settings** — severity weights and band cutoffs are hard-coded; the Settings screen (thresholds, report template details, retention) is unbuilt. Keep engine-version stamping so historic sign-offs stay traceable.
5. **PDF export** — reports are DOCX-only; brief says PDF follows once DOCX is stable (it is).
6. **Requirement merge** — the review queue lacks merge for near-duplicate AI extractions (brief lists it; preserve both source citations).
7. **Gate 0 founder metrics completeness** — decision-maker conversations count (≥8 threshold) and mandate-quality breakdown are still not tracked in-app.
8. **Retention automation** (NFR-PRV-02) — 12-month engagement retention, ≤14-day deletion with certificate; manual deletion exists, scheduling does not.

## Remaining — v1.0 trio (gated on Phase 1 commercial exit; do not build early)

- **Drafting Engine v1** (FR-DRF-01/02, FR-CAP-02) — criteria-mapped responsive sections generated ONLY from `claimable` Capability Library records; an unevidenced claim hard-fails the render. The claimable seam is already enforced at the data layer.
- **Red-Team Scorer v1** (FR-RTS-01) — rubric-driven hostile-evaluator pass at T-72h, unskippable, feeding the defect taxonomy; needs SLA clocks (FR-CSM-03) first.
- **Assembly Engine v1** (FR-ASM-02) — full package to tender spec (pagination, tabbing, TOC, cross-refs, copies manifest, signature/seal checklist) with golden-file tests.
- Supporting: extraction recall ≥95% on a ≥25-doc harness, BPP SBD format detection (FR-EXT-06), cross-document BOQ consistency (FR-BOQ-03), anonymised defect dataset with the k≥8 gate (FR-ANL-02), runbooks (NFR-OPS-01).

## Remaining — Phase 2+ (explicitly out of scope until gates pass)

Client portal (v1.5), self-serve tier + billing/entitlements (v2.0), automation graduation via confidence scores, Restricted Mode in-country inference, white-label channel, flagship defect report, GCC localisation. Per the roadmap's own rule: none of this is entitled to exist before its commercial gate.

## Deploy note

Schema changes from the milestone (audit chain columns, document sha256, report provenance, requirement scorecard fields) require `pnpm --filter @workspace/db run push` in the deploy environment. The two DB-dependent test suites pass only where `DATABASE_URL` exists.
