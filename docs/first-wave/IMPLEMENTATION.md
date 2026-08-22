# First-wave product implementation

This increment turns the first product wave into a small set of connected, evidence-bound workflows. It does not enable autonomous submissions, external-provider effects, automatic approvals, or the internal durable-worker control router.

## Delivered product surfaces

### Pursuit Control Tower

The signed-in Dashboard now provides a consolidated pursuit queue with six stages: setup and intake, document processing, requirements review, issue resolution, package preparation, and delivery/close-out. It orders only from loaded project summaries and workflow alerts, excludes archived pursuits, and links each item to the relevant project tab.

The Control Tower is a read-only projection. A queue position, missing summary issue, or stage label is not a readiness, sign-off, release, or submission decision. When a source is missing, the UI says which signals could not be verified instead of presenting a false clear state.

### Tender Context and Eligibility Passport

The project-scoped Tender Context workflow records an explicit, versioned interpretation of the tender before downstream work relies on it. It binds requirements and supporting artefacts to immutable, verified document-version snapshots. A snapshot records the exact document byte hash, extracted text hash, parser identity, and redaction state. Capture and verification must be completed by different, currently authorised people.

Solicitations and addenda use a closed version-two structure. A solicitation records a complete starting set of fields. Each addendum either records the complete resulting field set or explicit set/remove operations against the immediately preceding verified version. Every value or removal instruction must match an exact UTF-16 source span. The chain fails closed on missing or skipped predecessors, ambiguity, changed source bytes, changed redaction state, quarantine, or malware status; it never fills gaps by inference.

The Eligibility Passport reports the deterministic checks and gaps for that exact context version. Context and passport acceptance re-check the current source snapshots, evidence approvals, jurisdiction rule pack, and named authority inside the write transaction.

The passport is advisory evidence. It cannot qualify a pursuit, approve a requirement, sign a report, release a package, or infer that a missing source is clear. Named people retain every review and approval decision.

### Addendum Impact Centre

The project-scoped Addendum Impact Centre follows a verified document chain and compares the selected addendum with the effective state immediately before it. The first solicitation is an explicit full snapshot. Each addendum is an explicit full replacement or a delta with exact set and remove instructions. Stable series, field, category, predecessor, byte-hash, redaction, and citation bindings prevent the system from guessing what an omission means or skipping an intervening version.

Every snapshot requires a named human verification. Existing values retain their original exact citations, while additions, changes, and removals cite the selected addendum instruction that caused them. The Centre then shows affected records and keeps review separate from application. A named reviewer may record a decision. Applying an accepted plan requires a separate, explicit action by a different currently authorised person, exact source and target versions, and optimistic-concurrency checks.

Application may reopen only the listed current work and mark downstream current decisions for re-check. It preserves the original decision makers, signers, timestamps, reasons, evidence hashes, and audit history. Released-project exceptions are limited to this controlled review/reopening path; archived projects remain terminal.

## Persistence and security boundary

Migration `0010_tender_context_and_addendum.sql` adds:

- immutable document-version snapshots;
- versioned tender contexts, requirements, and evidence bindings;
- versioned eligibility passports;
- addendum assessments and target-level impact items.

All seven tables are organisation-scoped and covered by PostgreSQL FORCE RLS. Tenant-parent relationships are guarded, source/content history is immutable, and the production runtime cannot delete these records. Database transition guards require an initial pending/captured state and permit only one-way, version-incrementing review and application transitions; terminal stamps cannot be rewritten. Actor authority and audit evidence remain application transaction boundaries rather than claims inferred from database session text. The runtime receives only the narrow insert/update rights required by the governed workflows. Production startup attestation pins the expanded table, policy, relationship, trigger, function, and privilege catalog.

## Capability truth

`config/product/capabilities.v1.json` is the checked-in first-wave capability register. Its verifier checks that every claimed surface has source evidence, remains role/tenant guarded, preserves named-human authority, and does not claim automatic mutation or connected external effects.

The durable worker and outbox foundation remains `foundation_only`, internally unmounted, and provider-disconnected. Its activation preconditions in `config/operations/worker-activation.v1.json` remain open and fail closed.

## Deployment boundary

Deploy migration `0010` only through the journaled migration runner and its exact catalog checks. Do not use schema push. A legacy cutover must pass the updated bridge artifact check and PostgreSQL rehearsal before production migration. The application must pass runtime database safety attestation before listening.

The checked-in unit, static-contract, type, migration, OpenAPI parity, and browser tests are development evidence. They do not replace a disposable PostgreSQL 16 apply/rehearsal, cross-tenant runtime proof, reviewed production migration, or deployment verification.
