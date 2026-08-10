# Accessibility report

Status: implementation evidence and open-gate record, reviewed 10 August 2026. This is not a WCAG conformance claim, accessibility certification or production acceptance.

## Scope

This report covers the signed-out public shell, landing page, public supporting pages and `/request-bid-autopsy` journey. It records source controls, component tests and the limited local Chromium checks completed during the overhaul. It does not extend to the authenticated workbench.

## Implemented controls

| Area                        | Implemented behaviour                                                                                                                                                                                  | Evidence boundary                                                                                                                                                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Structure                   | The public shell provides a skip link, labelled navigation, one `main` landmark and a footer. Page content uses a single level-one heading in the inspected routes.                                    | Source inspection and the final local Chromium responsive pass.                                                                                                                                                                  |
| Keyboard navigation         | Mobile navigation moves focus to its first link when opened, closes on Escape and restores focus to the menu trigger.                                                                                  | Component test plus an earlier local Chromium interaction check.                                                                                                                                                                 |
| SPA route changes           | Client-side navigation focuses the destination H1 and announces the new page through a polite live region; an initial page load does not take focus.                                                   | Component tests cover both navigation focus and the no-initial-focus rule. Manual assistive-technology confirmation is pending.                                                                                                  |
| Focus visibility            | Global focus-visible styling is present. Header, footer and primary controls have focus-ring classes. FAQ summaries retain the browser outline and add a ring instead of suppressing focus indication. | Source and component assertions. Visual checks of every focus state on the final bundle are pending.                                                                                                                             |
| Target size                 | Public navigation, CTAs, header mark, menu trigger, footer links and form controls use a minimum 44 CSS-pixel height or a 44 by 44 CSS-pixel box where applicable.                                     | Source-class assertions and limited manual form checks; this is not a complete rendered-size audit.                                                                                                                              |
| Form labelling              | Every business field has a programmatic label. Required fields are identified in text, hints and field errors are connected with `aria-describedby`, and invalid fields use `aria-invalid`.            | Source and component tests.                                                                                                                                                                                                      |
| Form errors                 | Client validation focuses a linked error summary with `role="alert"`; invalid controls retain their own messages. No request is sent when client validation fails.                                     | Component test and final 320px browser evidence. Focus was immediate; the alert began at 96px below the sticky header's 65px bottom edge.                                                                                        |
| Form status                 | Submitting disables the submit action, exposes progress text and announces status. Failure uses an alert and a retry action. Accepted submission uses a polite status region and a clear next step.    | Source and component tests for validation, retry and accepted states; no screen-reader run has been completed.                                                                                                                   |
| Motion and zoom foundations | The stylesheet includes a reduced-motion rule, and the viewport declaration does not disable pinch zoom or set a maximum scale.                                                                        | Static source test only.                                                                                                                                                                                                         |
| Decorative graphics         | Decorative Lucide icons in the reviewed public journey are hidden from assistive technology, while interactive elements retain text labels.                                                            | Source inspection.                                                                                                                                                                                                               |
| Automated rules             | Axe-core is run against the rendered landing page and initial Bid Autopsy request page.                                                                                                                | Both checks passed with zero reported violations as part of the final 3-file/34-test public journey, Axe and SEO suite. Colour contrast is disabled because jsdom cannot measure it reliably; it remains a browser/manual check. |

## Recorded local browser observations

The final Chromium-based local-preview pass found one H1 and a visible primary CTA at 320 by 700, 360 by 780, 667 by 375, 768 by 1024, 1024 by 768, 1440 by 900 and 1920 by 1080 CSS pixels. At each size, `document.documentElement.scrollWidth` did not exceed `document.documentElement.clientWidth`. Fresh 320px and 1440px landing/request screenshots were retained.

The interaction pass also found no console errors, predictable mobile-menu focus, Escape-to-close with trigger restoration, and a focused validation summary with labelled field errors. At 320px, focus was immediate and the alert's top measured 96px against the sticky header's 65px bottom edge, leaving it unclipped. Form controls inspected in that pass met the intended 44 CSS-pixel minimum. `evidence/after-mobile-menu-320.jpg` and `evidence/after-form-validation-320.jpg` retain those two states.

## Open accessibility gates

The following evidence is absent and blocks production accessibility acceptance:

1. Axe coverage currently proves the landing and initial request routes only. Validation-error, submitting, server-error, retry, success and supporting public-page states are not all included.
2. Axe colour-contrast analysis is disabled in jsdom; rendered colour contrast still requires a reliable browser/manual check.
3. No representative screen-reader test has been completed. At minimum, the final journey needs coverage with a supported Windows screen reader and browser, including navigation announcements, FAQ disclosure state, validation summary links, submitting, retry and success.
4. No keyboard-only pass has been recorded for every public route and interactive state on the final bundle.
5. No 200 percent or 400 percent browser-zoom/reflow evidence exists.
6. No high-contrast or forced-colours pass has been recorded.
7. No cross-browser accessibility matrix has been completed for Chrome, Edge, Firefox and Safari.
8. Route-focus behaviour is component-tested but has not been confirmed with a representative screen reader after lazy-route loading.

## Acceptance decision

The source has materially stronger semantics, keyboard behaviour and form feedback than the baseline. The focused component and Axe checks plus final Chromium reflow measurements are appropriate merge evidence, but they are not enough to declare WCAG 2.2 AA conformance or production readiness.

Production activation remains **no-go** until the open accessibility gates above have owners, evidence and resolved findings. No exception should be inferred from the absence of an automated failure.

## Required final evidence

Before activation, retain:

- expanded Axe output for every indexable public route and the initial, validation-error, submitting, server-error and success form states;
- keyboard and screen-reader notes with browser, assistive technology and version;
- 200 and 400 percent zoom screenshots or recordings at narrow and desktop widths;
- rendered target-size and colour-contrast checks for all interactive controls; and
- defects, severity, remediation owner and retest result for every failure found.
