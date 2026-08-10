# Validation and release handover

Status: unreleased merge-candidate record, reviewed 10 August 2026. No production deployment or activation is claimed.

## Decision summary

| Decision                     | Current status                                 | Reason                                                                                                                |
| ---------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Source implementation        | Substantially complete                         | Landing, request journey, bounded API, database queue, security controls, SEO boundary and focused tests are present. |
| Final merge acceptance       | Local gates passed; final review and CI remain | Frozen automated, build and Chromium evidence passes; adversarial sign-off and branch CI remain separate gates.       |
| Production intake activation | **No-go**                                      | Required privacy, secret, ownership, database, accessibility, performance and operational gates are open.             |
| Production deployment        | Not performed                                  | There is no deployed smoke evidence and activation configuration is intentionally incomplete.                         |

## Final local merge-check evidence

These results were recorded against the frozen local source and test tree. They do not substitute for the branch CI/PostgreSQL run.

| Check                                       | Final result                                                                                                                                                | Evidence boundary                                                                                     |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Source and test typechecks                  | Passed                                                                                                                                                      | Frozen-tree local evidence.                                                                           |
| Security policy lint                        | Passed                                                                                                                                                      | Frozen-tree local evidence.                                                                           |
| Release configuration                       | Passed; output reported 11 rules and 11 alerts                                                                                                              | Frozen-tree local evidence; committed lead secrets and retention remain forbidden.                    |
| Migration journal                           | Passed                                                                                                                                                      | Static/local validation only; live PostgreSQL remains open.                                           |
| Legacy bridge static check                  | Passed; output reported `94/256/86`                                                                                                                         | Static/local validation only; output counts are not reinterpreted here.                               |
| Focused public API and production web tests | 18 of 18 passed                                                                                                                                             | Frozen-tree local evidence.                                                                           |
| Generated client contract                   | 2 of 2 passed                                                                                                                                               | Frozen-tree local evidence.                                                                           |
| Database runtime/security suite             | 18 of 18 passed                                                                                                                                             | Frozen-tree source/static evidence; not a live PostgreSQL integration run.                            |
| Focused public journey, Axe and SEO suite   | 3 files, 34 tests passed                                                                                                                                    | Includes zero reported Axe violations on landing and initial request; colour contrast remains manual. |
| Full workbench suite                        | 29 files, 188 tests passed in 16.27 seconds                                                                                                                 | Frozen-tree local evidence.                                                                           |
| API production build                        | Passed                                                                                                                                                      | Frozen-tree local build evidence.                                                                     |
| Workbench production build                  | Passed; 1,971 modules transformed                                                                                                                           | Frozen-tree local build evidence.                                                                     |
| Public route budget                         | Passed: JS 84,269/102,400 gzip bytes; CSS 23,240/25,600; request chunk 6,474/8,192; public-pages chunk 6,712/10,240; images 40,977/819,200; fonts 0/102,400 | Frozen-build asset evidence; not runtime performance data.                                            |
| Responsive Chromium pass                    | Seven viewports passed with one H1, a visible primary CTA and `scrollWidth <= clientWidth`; fresh landing, request, menu and validation captures retained   | Local Chromium only; cross-browser and zoom evidence remain open.                                     |

No branch CI run has been observed because the candidate has not been pushed. No local PostgreSQL service or usable `DATABASE_URL` was available, so migration application, database-backed intake integration and populated rehearsal have not been proved locally. The configured CI PostgreSQL job remains authoritative and must pass on the exact candidate commit.

## Implemented release safeguards

- Production intake selects only the database destination and fails closed when activation configuration is incomplete.
- The public route requires exact Origin, JSON content type, supported content encoding, a closed payload, bot timing/honeypot checks and a shared database-backed rate limit.
- The rate-limit key is an HMAC of a canonical client address; raw addresses are not stored.
- Idempotency stores a hash of the key and a normalised payload fingerprint. The browser persists no raw form values; it retains a session-scoped version, UUID key, form-start time and SHA-256 digest derived from the normalised fields for retry integrity. That digest is pseudonymous request metadata and remains within the privacy and retention activation review.
- The application runtime has no direct privilege on either intake table and cannot execute owner-only lead or rate-bucket purge functions.
- Production has no inferred lead-retention default.
- Preview, staging, private and unknown pages fail closed for indexing.
- No public analytics transport is active.

## Production activation blockers

Every item below requires an owner and retained acceptance evidence:

1. **Retention approval:** no authorised integer `VALO_PUBLIC_LEAD_RETENTION_DAYS` from 1 through 3650 has been selected or recorded.
2. **Rate-limit secret:** `PUBLIC_LEAD_RATE_LIMIT_HMAC_SECRET` of at least 32 bytes has not been installed in Replit Secrets.
3. **Queue ownership:** no named authorised operator owns queue reconciliation, requester follow-up and incident handling.
4. **Lifecycle schedule:** no approved owner-side schedule or runbook exists for both expired lead records and expired HMAC rate-limit buckets.
5. **Privacy rights:** the public experience has no approved contact channel for access, correction, deletion or other privacy-rights requests.
6. **Operational retrieval:** no approved CRM/email adapter or narrowly authorised queue read/reconciliation surface exists. A database receipt is not a human follow-up workflow.
7. **Database proof:** migrations `0003`-`0005`, least-privilege runtime attestation, idempotency, retention and shared limiter behaviour have not passed on a live PostgreSQL candidate environment in this branch.
8. **CI:** the complete GitHub workflow, including secret scan, dependency audit, DB integration, builds and route budget, has not run on the candidate commit.
9. **Accessibility:** landing and initial request Axe checks pass, but colour contrast is disabled in jsdom and there is no representative screen-reader pass, complete keyboard/state coverage, 200/400 percent zoom proof or high-contrast evidence.
10. **Browser coverage:** final Chromium measurements pass at seven responsive viewports and fresh screenshots are retained, but no Chrome/Edge/Firefox/Safari production-build matrix exists.
11. **Runtime performance:** no Lighthouse, slow-mobile trace or measured LCP/INP/CLS evidence exists.
12. **Prerender stability:** generic server prerender followed by React `createRoot` replacement presents an unmeasured CLS risk.
13. **Deployed smoke:** origin/proxy indexing, form acceptance/replay/conflict, rate limiting, retention, purge, queue reconciliation and log redaction have not been tested in a deployment.
14. **Analytics approval:** public analytics remains disabled pending an approved provider, purpose, lawful basis/consent decision, property allowlist and retention period.
15. **Complete intake ACL audit:** startup attests the intended runtime and `PUBLIC` restrictions, but an owner-side audit has not yet proved that no other database role holds unexpected `valo_intake` schema, table, column or function privileges.
16. **Encrypted transport:** the live Replit environment has not yet proved encrypted PostgreSQL transport or HTTPS and HSTS behaviour at the public edge. Runtime URL-option equality is not transport-encryption evidence.

Until retention and secret configuration are supplied, the production public route is expected to return a safe 503. That fail-closed behaviour is intentional and must not be bypassed for launch.

## Remaining merge/release sequence

1. Freeze and format the final documentation, verify local references and run `git diff --check` across all changed files.
2. Complete adversarial review and resolve every S1/S2 finding.
3. Run the full CI workflow with PostgreSQL on the exact candidate commit after publication of the branch.

Only then may the candidate be described as merge-ready. The completed local checks do not authorise production activation.

## Required production activation sequence

1. Record the approved retention duration, named queue/privacy owner, reconciliation cadence and both purge schedules.
2. Publish an approved privacy-rights contact channel and update the notice through review.
3. Install the HMAC secret in Replit Secrets without exposing it in source, logs or screenshots.
4. Apply and verify migrations with owner credentials; prove the application uses the dedicated least-privilege runtime role and complete an owner-side ACL/grantee audit for the entire `valo_intake` boundary.
5. Prove encrypted PostgreSQL transport and public-edge HTTPS/HSTS behaviour in the target Replit environment.
6. Complete the accessibility, browser and runtime-performance evidence listed above, including resolution of the prerender/CLS risk.
7. Deploy to the intended origin and execute the privacy-safe synthetic smoke in `MEASUREMENT_AND_LEAD_ROUTING.md`.
8. Verify an authorised operator can reconcile the opaque request ID and that logs/alerts contain no submitted PII.
9. Confirm expiry and owner-only purge of synthetic lead and limiter records, then record the go/no-go decision.

No real person's information or real tender material should be used in automated, preview or activation tests.
