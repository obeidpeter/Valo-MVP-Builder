# Third-wave implementation

This wave connects five delivery controls around the existing tender evidence and package lifecycle: Citation-first Response Studio, independent red-team review, governed package assembly, portal submission rehearsal, and tenant-local portfolio intelligence. Every result remains deterministic evidence for a named human decision.

The wave does not activate a model provider, authorise autonomous workflow changes, approve evidence, lower or clear a fatal finding without the governed decision path, sign or export a package, use procurement-portal credentials, submit a tender, predict an award, train a model, or reuse data across tenants.

## Response Studio

Response Studio projects the current version-bound response material and runs the existing citation-first validator over bounded claims. Exact factual and instructional claims require in-scope source support; paraphrases remain subject to semantic review; unresolved placeholders and stale, missing, foreign, or non-matching citations remain blockers.

The connected workflow records named review responsibility against the exact source manifest and optimistic version. A validation result is not evidence approval or package authority. The author of a factual or instructional claim cannot turn the validation output into final evidence approval or release authority by themselves.

## Independent red-team review

Red-team review binds one governed run to the exact project source snapshot and reviewed policy version. Findings remain visible until a named reviewer records a permitted disposition. Delivery Studio cannot clear a fatal or likely-fatal finding with a note: the source must be remediated and subjected to a new independent run. Red-team approval is never inferred from an empty queue. The independent approver's attestation is retained with the immutable action receipt and exposed on the run.

A changed source snapshot makes the previous run stale. A run cannot approve itself, erase a finding, bypass the defect-decision policy, or make a package ready. Submission readiness and downstream package actions continue to recompute the current red-team and defect state.

## Governed package assembly

Package assembly binds the exact reviewed source snapshot to a deterministic, content-addressed manifest. Unsafe or duplicate names, invalid hashes, missing items, stale versions, readiness blockers, and conflicting aggregate versions fail closed. A changed source creates a new package version rather than rewriting a signed one.

Assembly cannot sign, export, deliver, or submit a package. Render success, named visual QA, independent approvals, sign-off, and current-governance checks remain separate gates. The package view exposes manifest identity and readiness evidence without exposing object paths or package bytes in ordinary metadata responses.

## Portal submission rehearsal

Submission rehearsal compares frozen package files with a reviewed portal profile. It checks exact field labels, file-to-field mappings, upload order, filename rules, extensions, byte limits, hashes, and manual declarations. Every frozen package file must have an exact cited file-field mapping before the rehearsal can be ready. An accepted rehearsal review binds to the exact source, field, file, mapping, and constraint facts; any fact change invalidates it. Each recorded review remains attributed to the current named operator with a server-held timestamp.

No route logs in, uploads to, declares on, or submits through a procurement portal. Credentials are never accepted. A declaration always requires the real operator, and a rehearsal-ready result is not submission readiness or proof of submission.

## Tenant-local portfolio intelligence

Portfolio intelligence is tenant-local and never predicts an award. It reports bounded workflow statuses from the selected organisation's authorised projects and counts authorised client-confirmed outcome records. Missing or unreviewed outcome evidence stays explicit; it is not converted into a win probability, recommendation, or hidden evaluator score.

Lesson derivation is unavailable in this wave because cited outcome and defect bindings plus named lesson review are not yet persisted. Model training, cross-tenant reuse, benchmark publication, external sharing, and small-cohort disclosure remain unauthorised. Any future lesson or benchmark workflow requires separate evidence binding, review, consent, minimum-cohort, small-cell suppression, differencing, withdrawal-impact, and disclosure-review controls.

## Shared authority and privacy boundary

Reads require the selected tenant, resource scope, and the complete capability permissions. Mutations require a current direct membership, named user, exact project scope, optimistic source and record versions, bounded bodies, and atomic audit evidence. Private responses remain `no-store`; a UI control never widens server authority.

Archived pursuits are terminal. Released content remains immutable except for the repository's exact append-oriented operational ledgers. Restricted draft, defect, package, portal-profile, and outcome content does not enter ordinary logs. Existing retention and legal-hold controls remain authoritative; these workflows do not create a deletion or publication shortcut.

Project deletion is guarded at the database boundary and is available only through the owner-held governed retention purge; deleting a client cannot cascade around that control. If a source-row writer overlaps the purge's inverse lock order, detach retries only a bounded PostgreSQL deadlock-victim transaction and otherwise fails closed.

## Capability truth and release

`config/product/third-wave.v1.json` is the frozen release-evidence registry for this wave. It distinguishes source integration from deployment verification and pins all five capabilities to deterministic runtime level 0, no model execution, no autonomous mutation, no external action, no release authority, no cross-tenant reuse, and named-human authority.

The registry verifier proves the exact scope, evidence files, and safety assertions. Passing source checks is not deployment evidence. PostgreSQL integration, tenant-isolation tests, OpenAPI/generated-client parity, component and accessibility checks, package render QA, an immutable release candidate, and formal production deployment verification remain release gates.
