# Product and architecture decision log

| ID    | Class    | Decision                                                                              | Rationale                                                          | Status / ADR                                          |
| ----- | -------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------- |
| D-001 | Retain   | Narrow process warranty; no award guarantee                                           | Honest, controllable product outcome                               | Accepted                                              |
| D-002 | Retain   | Deterministic core, AI suggestion shell, human material gates                         | Protects integrity and explainability                              | Accepted                                              |
| D-003 | Retain   | Existing TypeScript/PostgreSQL/React/OpenAPI foundations                              | Substantial usable code; rewrite risk is unjustified               | [ADR-0001](adrs/0001-incremental-modular-monolith.md) |
| D-004 | Redesign | Client/project model into organisation tenancy, scoped grants and DB RLS              | Current broad member/client model cannot meet isolation/roles      | [ADR-0002](adrs/0002-tenancy-and-rls.md)              |
| D-005 | Add      | Durable persistent jobs/outbox/dead-letter operations                                 | Long/provider work cannot rely on request lifetime                 | [ADR-0003](adrs/0003-durable-jobs.md)                 |
| D-006 | Redesign | Audit hash chain plus external immutable anchoring                                    | Local hash chain can be rewritten with database control            | [ADR-0004](adrs/0004-audit-anchoring.md)              |
| D-007 | Redesign | Provider-neutral adapters and environment fail-closed guards                          | Portability, outage, privacy and production honesty                | [ADR-0005](adrs/0005-provider-adapters.md)            |
| D-008 | Add      | Server-enforced feature flags separate technical/commercial readiness                 | Later code may ship safely without premature activation            | [ADR-0006](adrs/0006-feature-flags.md)                |
| D-009 | Redesign | Current Nigeria/tender rules as approved effective rule packs                         | Law/instruments change and supplied docs contain discrepancies     | [ADR-0007](adrs/0007-nigeria-rule-packs.md)           |
| D-010 | Retain   | Autopsy as wedge; Vault v0.5; Capability/Drafting v1.0; portal/channel later          | Preserves validated sequencing intent                              |
| D-011 | Redesign | Requirement/evidence/package state and independent fatal reclassification             | Administrative bypass is prohibited                                |
| D-012 | Redesign | Exact decimal money and explicit UTC/Africa-Lagos calendar                            | Current floats/text dates are unsafe                               |
| D-013 | Add      | Malware quarantine, immutable originals, version/addendum impact and resumable intake | Required for hostile real documents                                |
| D-014 | Remove   | Single nominal `k >= 8` as sufficient anonymity control                               | Does not prevent small cells/differencing/re-identification        |
| D-015 | Remove   | Fixed legal/retention/tax/procurement constants without current authority             | Must be effective-dated and approved                               |
| D-016 | Add      | Fact-level provenance and unresolved-placeholder release blockers                     | Enforces anti-fabrication at render/sign                           |
| D-017 | Add      | Partner ownership/co-sign/branding boundary                                           | White label cannot change evidence/status/quality truth            |
| D-018 | Defer    | GCC/Arabic, native mobile, marketplace, e-submission, award prediction                | Beyond Nigeria v2.5 or conflicts with invariants                   |
| D-019 | Add      | Repository privacy/permission verification as security gate                           | Source archive cannot prove private visibility/history             |
| D-020 | Redesign | Roadmap begins with foundation remediation before v0.1 claims                         | Required to avoid retrofitting tenancy/security after product data |

## Document discrepancies/assumptions

- `DOC-001`: TRD v1.0 says BP v1.2/Roadmap v1.1; supplied/found baseline is BP v1.1/Roadmap v1.0. Open until owner reconciles.
- `DOC-002`: Repository archive lacks `.git`; branch/history/uncommitted work and visibility are not locally provable.
- `DOC-003`: Deployment target appears Replit-oriented from files, but no authorised staging/production target, domain, budget or credentials were supplied. Do not deploy or claim deployment.
- `DOC-004`: Current Nigerian rules are resolved only through approved rule packs; Business Plan Appendix B and commercial sources are working input, not authority.
- `DOC-005`: RPO is provisionally no worse than 24 hours while RTO is <=4 hours; owner/business impact analysis must approve or tighten RPO before GA.

Decisions that alter invariants, legal posture, tenant isolation, evidence grounding, fatal gates, irreversible data migration or paid infrastructure require explicit owner/security/privacy approval and an ADR amendment.
