# Draft for owner review: lifetime-cap retention migration

Status: **draft — not wired, not runnable, no approval recorded.**
Owner action required: review, amend, and approve before any journalled
migration is authored from this draft. Nothing in this document changes
runtime behaviour.

## Why this draft exists

Two roadmap-wave registers carry deliberate lifetime caps with **no archive**:

| Register                            | Cap                                        | Declared consequence at capacity                               |
| ----------------------------------- | ------------------------------------------ | -------------------------------------------------------------- |
| Official Opportunity Source Network | 250 receipts / 500 events per organisation | Intake stops pending a reviewed retention migration            |
| AI Shadow Programme                 | 25 plans per organisation                  | Plan registration stops pending a reviewed retention migration |

The caps are a safety feature: they force a deliberate, reviewed retention
decision before unbounded growth, instead of silently deleting or silently
growing. This draft is that decision's raw material. An organisation that
reaches a cap in production is the trigger to take this draft through review.

## Constraints any approved migration must honour

1. **Append-only evidence stays append-only.** Receipts and observations are
   evidence records. The migration may _move_ them to a colder register; it
   may never rewrite, renumber, or summarise them in place.
2. **No destructive step without a certificate.** If the approved decision is
   deletion after archival, the deletion must follow the existing retention
   doctrine: a named human request, a completed archival with digest, and a
   certificate recording exactly what was removed.
3. **Tenant isolation is preserved.** Archive tables carry the same
   `organisation_id`, FORCE RLS, and `tenant_isolation` policies as their
   live counterparts, and the migration is journalled (000N) so the catalog
   attestation pins move with it.
4. **Caps do not grow silently.** The live-register caps stay exactly as they
   are; the migration adds headroom only by archiving, never by raising the
   bound.

## Where the capped records actually live

Both registers are event-sourced **into the per-tenant `audit_events` hash
chain itself** (see `opportunitySourceNetwork/auditRepository.ts` and
`aiShadowProgramme/auditRepository.ts`). There are no dedicated receipt/plan
tables to move rows out of, and rows can never be moved out of `audit_events`
without breaking the chain.

## Draft mechanism (for review, not execution)

Retention for these registers must therefore follow the chain-preserving
archive pattern the codebase already uses for the legacy v1 history
(`legacy_audit_events` plus a boundary event plus a stored integrity
assessment), not a row move:

1. A journalled migration introduces a dedicated, append-only,
   RLS-protected archive table for register events (same tenant posture as
   `legacy_audit_events`), reachable by the register repositories read-only.
2. A named-human archival command per register:
   - selects only **closed/decided** receipts or **closed** plans — open
     records never archive;
   - exports the selected chain events verbatim, records their count and a
     content digest, and copies them into the archive table in one
     transaction;
   - appends a **boundary audit event** to the live chain carrying the
     digest, so the chain remains verifiable across the archival;
   - only then are the archived aggregates excluded from the live register's
     cap accounting (the events themselves stay in `audit_events`; the cap
     counts aggregates, so archival changes the count without touching the
     chain).
3. The archival command is bounded per invocation and produces an audit
   receipt; the archive register is readable through the existing UIs,
   clearly badged as archived, and is itself append-only.

Whether the underlying chain events may _ever_ be physically removed after
archival is exactly the kind of decision that requires the retention
doctrine's certificate path and is left as an open question below.

## Open questions the reviewer must answer

1. Is archival alone acceptable, or must archived records eventually be
   deleted under a retention basis (and if so, after how long)?
2. Should the archival command require maker-checker like the commercial
   ledger, or is a single named human with an audit receipt sufficient for
   non-commercial registers?
3. Do archived shadow-programme observations remain hash-only forever, or is
   there any future evidentiary need that changes their retention class?

Until these are answered and this draft is superseded by an approved,
journalled migration, the caps and their stop-at-capacity behaviour remain
authoritative.
