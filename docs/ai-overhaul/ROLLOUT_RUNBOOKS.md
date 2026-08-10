# AI rollout and runbooks

## Preconditions

Do not activate while `aiReleaseGate` has any blocker. Every production project
AI call now recomputes that gate from the private
`VALO_AI_RELEASE_EVIDENCE_PATH` before the central gateway. Required evidence is
a live production-profile evaluation, authorised corpus, exact real
model/prompt/schema/retrieval/index version match, approved
provider/privacy/budget records, global and per-capability kill switches,
tested rollback and an approved staged-rollout record. Production AI is
currently disabled; retrieval/index versions and valid release evidence are
absent.

## Stages

1. **Offline:** deterministic policy, schema, injection and corpus-contract tests.
2. **Shadow:** authorised inputs; no user-visible output or authoritative writes.
3. **Internal pilot:** named reviewers; suggestions only; all corrections captured.
4. **Tenant pilot:** selected tenants/roles/capabilities with explicit approval.
5. **Canary:** bounded traffic with automatic stop thresholds.
6. **General availability:** only after canary, incident drill and owner sign-off.

No stage advances on quality, tenant isolation, privacy, cost or latency failure.
Production flags must remain disabled between stages except for the expressly
approved tenant/capability/traffic slice.

## Emergency disable

1. Activate the server-enforced global AI kill switch before new disclosure.
2. Disable the affected provider and workflow and, if durable orchestration is
   introduced later, its queue class.
3. Preserve pseudonymous run/version/error evidence without source content.
4. Stop retries; quarantine uncertain outputs and pending actions.
5. Verify no unauthorised state/external action and no cross-tenant exposure.
6. Notify security/privacy/quality owners under the incident policy.

Then verify each capability returns a safe denial, in-flight calls have settled,
no partial suggestion persisted, manual workflows remain available, and alert
delivery/audit evidence was retained.

## Rollback/provider outage

Pin the last evaluated model, prompt, schema, retrieval and index versions.
Fallback only to an independently approved/evaluated configuration; otherwise
create a manual task. Reprocessing is explicit, idempotent and audited. Test
provider timeout, rate limit, total outage, partial result, replay, cost
exhaustion and rollback before canary.

## Monitoring minimum

Alert on invalid schemas, citation failures, abstentions, injection attempts,
denied tools, tenant denials, retrieval/model drift, reviewer correction,
provider failure, queue depth, latency, unit cost/budget, unusual tool behaviour
and safety regression. Retain synthetic trigger and delivery receipts.

Queue-depth and tool-behaviour signals are future requirements; there is no AI
queue/outbox or model tool plane in the current implementation.

## Automatic stop conditions

Stop the active stage on any cross-tenant access, unauthorised authoritative
mutation, fatal miss, unsupported released claim, governance/residency drift,
release version mismatch/bypass, budget breach, ordinary-log content leak,
alert/kill-switch failure, or high/critical security finding. Owners must set
sample-aware thresholds for schema/citation failures, reviewer corrections,
provider failure and latency before shadow.
