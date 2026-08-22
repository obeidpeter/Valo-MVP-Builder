# Second-wave implementation

This increment implements the source-side controls for the current near-term gate without claiming operational evidence that does not exist. It delivers a durable retention completion protocol behind a checked activation boundary, adds a private controlled-evaluation manifest binder, and records the authorised production corpus as externally blocked.

It does not activate destructive retention in production, install a storage-reconciliation schedule, connect an AI provider or private fixture loader, persist raw evaluation fixtures or model output, or represent synthetic test data as an authorised production corpus.

## Durable retention completion

Retention completion has three public mutations separated by an owner-held purge boundary:

1. **Detach** — an authorised administrator supplies an explicit irreversible attestation against the current request version. In one tenant transaction, the service re-checks project authority and protected-record policy, writes a canonical source manifest, creates durable storage-deletion intents and their exact event bindings, and moves the action to `detached` at version 2. It never deletes an object synchronously.
2. **Owner purge** — a separately reviewed database execution identity may invoke the manifest-bound purge routine against action version 2. The routine re-locks and revalidates the exact tenant project graph, current protected-record policy, storage bindings, and retained categories; removes the eligible relational graph; and atomically stamps an immutable, hashed purge receipt while advancing the still-detached action to version 3. The checked-in application runtime has no execute grant for this routine.
3. **Reconcile** — only after the owner purge receipt exists and the storage lifecycle worker has reached a trusted terminal result for every bound event may an authorised preparer attest action version 3. Only `completed` events whose final attempt proves `deleted` or `already_absent` count as deletion evidence. A cancelled, unresolved, retriable, failed, or dead-letter event prevents reconciliation without destroying its replay path. The canonical reconciliation manifest and preparer stamp move the action to `reconciled` at version 4.
4. **Certify** — a different, currently authorised checker attests action version 4. The service re-verifies the immutable source manifest, owner purge receipt, reconciliation evidence, protected-record dispositions, actor separation, and optimistic version before inserting one canonical deletion certificate and moving the action to version 5 and the request to its terminal state in the same transaction.

The request and action retain an immutable subject project identifier after the live project foreign key is detached. Financial, accounting, retainer, Claims Desk, legal-hold, audit, lifecycle-control, and deletion-certificate evidence follow their own retention rules; they are not silently erased with engagement content. Active legal holds and unresolved policy decisions fail closed. Vault versions tied to project document versions, signed or delivered package versions, and rule overrides tied to project evaluations are explicit completion blockers until a separately governed, independently retained lineage exists. Cross-project rows that still point at the subject's documents, versions, requirements, processing runs, tender contexts, notification events, or project identity also block completion; the owner routine never silently nulls their provenance or cascades another project's records.

Migration `0011` upgrades only well-formed pending requests into protocol one. Historical completed, blocked, or already-reconciling records stay protocol zero and are never relabelled as carrying an owner receipt or canonical certificate they did not produce.

Every public mutation requires `If-Match`, `Idempotency-Key`, and an exact `{ "attestation": "..." }` body. Completion is restricted to administrators and private no-store responses. The Settings workflow exposes readiness blockers, owner purge proof, pending reconciliation, dead-letter or unresolved evidence, retained record categories, preparer/checker separation, and immutable certificate details. Loading, stale, offline, forbidden, and server-error states never expose a destructive control.

## Activation boundary

`config/operations/retention-completion-activation.v1.json` is authoritative. Production activation remains denied while any checked precondition is open. Source integration is not deployment proof: migration rehearsal, runtime database attestation, an installed and monitored storage reconciler, trusted provider receipts, reviewed protected-record selectors, a restore-aware deletion rehearsal, and a named activation approval are still required.

Migration `0011` installs the exact manifest-bound relational purge as an owner-held routine and revokes its execution from both `PUBLIC` and the application runtime role. Consequently, the checked-in runtime cannot cross the destructive boundary even if an environment variable is set. A separately reviewed execution identity and grant are still required operational evidence; neither the source registry nor a passing test authorises that grant. Direct application DML remains guarded by database transitions and current named-member checks, but the finer `retention:manage` decision is still enforced by the application authority layer; the production threat model and execution identity must be reviewed before activation.

The legacy direct project-deletion path remains unavailable. Moving the source workflow behind an activation gate does not authorise bypassing the durable storage lifecycle or using schema push.

## Controlled evaluation foundation

The controlled-evaluation foundation accepts metadata-only private manifests. It rejects unknown fields so raw tender text, labels, or model output cannot be smuggled into the manifest. Each case is bound by hashes to an existing tenant, project, capability, and shadow plan. A production-eligible source binding requires at least 25 approved-redacted holdout cases, complete technical-risk and document cohorts within that holdout, and independently adjudicated labels.

This binder is not an execution plane. A supplied authorisation-reference hash is a binding claim, not proof that an approval exists. The private authorisation evidence plane, fixture loader, central model gateway, continuous-evaluation writer, customer-output path, and production activation remain disconnected. The result therefore always reports `readyForExecution: false`, raw persistence false, and production activation denied even when a source manifest is structurally valid.

The authoritative production thresholds are at least 95% recall, at least 98% citation precision, complete material-claim citation coverage, no unsupported claims, complete injection containment, and exact expected-disposition accuracy. Labels may not be changed to make a run pass.

## Authorised corpus boundary

The repository still contains only synthetic development evidence. Unit-test fixtures exercise the binder contract but are not production cases, privacy approvals, independent adjudications, or deployment evidence. An authorised production corpus remains externally blocked until at least 25 real, approved-redacted, independently adjudicated holdout cases and their immutable authorisation references exist in the private evidence plane.

## Capability truth and deployment

`config/product/second-wave.v1.json` separates second-wave truth from the frozen first-wave registry. Its verifier distinguishes source integration, blocked production activation, foundation-only code, and externally blocked evidence.

Deploy migration `0011` only through the checked-in, hash-pinned migration runner. A disposable PostgreSQL 16 rehearsal, tenant-isolation proof, runtime safety attestation, generated-client parity, focused service/UI tests, and production deployment verification remain required. No checked-in test, document, manifest, or passing CI run may be substituted for the operational evidence named by an open activation precondition.
