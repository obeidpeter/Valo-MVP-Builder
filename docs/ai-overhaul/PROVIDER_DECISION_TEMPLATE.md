# Provider and model decision template

Status: **not approved; production AI disabled**.

Complete one record per primary or fallback configuration.

| Field                                      | Decision/evidence |
| ------------------------------------------ | ----------------- |
| Provider and legal entity                  | Pending           |
| Model/version allowlist and task           | Pending           |
| Processing purpose and data classes        | Pending           |
| Processing region and residency route      | Pending           |
| DPA/subprocessor/transfer reference        | Pending           |
| Training use disabled                      | Pending           |
| Retention period and deletion verification | Pending           |
| Encryption and tenant-isolation posture    | Pending           |
| Restricted Mode eligibility                | Pending           |
| Input/output/token limits                  | Pending           |
| Per-run and monthly cost limits/currency   | Pending           |
| P95 latency and timeout budget             | Pending           |
| Retry, fallback and circuit-breaker policy | Pending           |
| Safety/quality evaluation run              | Pending           |
| Security/privacy/quality owner approvals   | Pending           |
| Effective date and review/expiry date      | Pending           |
| Rollback configuration and test evidence   | Pending           |
| Decision owner and approval reference      | Pending           |

Approval must be a retained reference. Environment variables or the presence of
a secret are configuration, not approval. Fallback must pass the same privacy,
residency, budget, quality and security gates as the primary provider.

The working tree currently contains one externally hosted OpenAI adapter. It is
declared ineligible for Restricted Mode and uses strict structured output with
`store: false`, but provider, model, region, retention, DPA and governance
evidence are not approved by this pack. Those source settings do not pre-fill
the decision table.
