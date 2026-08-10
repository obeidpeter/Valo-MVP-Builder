# Browser and visual QA

Status: local evidence register, reviewed 10 August 2026. The current evidence is partial and does not certify cross-browser or production rendering.

## Environment and method

Manual checks used the Chromium-based in-app browser against the final local Vite preview. The browser version was not recorded. Responsive checks were completed at 320 by 700, 360 by 780, 667 by 375, 768 by 1024, 1024 by 768, 1440 by 900 and 1920 by 1080 CSS pixels.

## Evidence inventory

| File                                      | Purpose                         | Acceptance value                                              |
| ----------------------------------------- | ------------------------------- | ------------------------------------------------------------- |
| `evidence/before-landing-1440.jpg`        | Published baseline, desktop     | Baseline only                                                 |
| `evidence/before-landing-320.jpg`         | Published baseline, mobile      | Baseline only                                                 |
| `evidence/before-source-landing-1440.jpg` | Previous source build, desktop  | Baseline only                                                 |
| `evidence/before-source-landing-320.jpg`  | Previous source build, mobile   | Baseline only                                                 |
| `evidence/after-landing-1440.jpg`         | Redesigned landing, desktop     | Fresh final local-preview record                              |
| `evidence/after-request-1440.jpg`         | Request journey, desktop        | Fresh final local-preview record                              |
| `evidence/after-landing-320.jpg`          | Redesigned landing, 320px       | Fresh final local-preview record with no horizontal scrollbar |
| `evidence/after-request-320.jpg`          | Request journey, 320px          | Fresh final local-preview record with no horizontal scrollbar |
| `evidence/after-mobile-menu-320.jpg`      | Open mobile navigation, 320px   | Fresh final focus/menu-state record                           |
| `evidence/after-form-validation-320.jpg`  | Focused validation state, 320px | Fresh final error-state record                                |

The fresh after-state captures replace the earlier diagnostic images that exposed horizontal scrolling. The final pass also checked the rendered document dimensions numerically rather than relying on screenshots alone.

## Final local observations

| Check               | Final local observation                                                                                                                                                                                          | Evidence state                                                       |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Landing hierarchy   | Exactly one H1 and a visible primary CTA were present at every recorded viewport.                                                                                                                                | Passed in the local Chromium preview.                                |
| Horizontal reflow   | `scrollWidth <= clientWidth` at all seven recorded viewports for the inspected public routes.                                                                                                                    | Passed; fresh 320px screenshots retained.                            |
| Console             | No console warnings or errors were observed in the inspected landing and request states.                                                                                                                         | Passed in the local Chromium preview.                                |
| Mobile menu         | Opening focused the first navigation link; Escape closed it and restored trigger focus.                                                                                                                          | Component-covered and manually observed.                             |
| Route focus         | The primary CTA navigated to the request route, focused its H1 and updated the polite route announcement without initial-load focus theft.                                                                       | Component-covered and manually observed.                             |
| Form labels/errors  | Labels were exposed; empty submission immediately focused the linked validation summary and marked invalid controls. The alert top measured 96px against the sticky header's 65px bottom edge, with no clipping. | Component-covered, manually observed and captured at 320px.          |
| Form scope          | No upload control or free-text tender-details field was present.                                                                                                                                                 | Source, component and visual evidence.                               |
| Form control sizing | Inspected controls were at least 44 CSS pixels high.                                                                                                                                                             | Partial manual evidence; full rendered target audit remains pending. |

## Required final browser matrix

Before production activation, test the frozen production build in current Chrome, Edge and Firefox on desktop, plus Safari on macOS and iOS. Include an Android Chromium viewport. Record browser/OS versions.

For each required engine, cover:

1. `/`, `/request-bid-autopsy`, every supporting public route and a real 404;
2. 320, 360, 768, 1024, 1440 and 1920 CSS-pixel layouts, plus mobile landscape;
3. no clipped focus rings or text at narrow widths, retaining the completed `scrollWidth <= clientWidth` regression check;
4. mobile menu open, first-link focus, Escape close and focus restoration;
5. CTA navigation focus and live announcement;
6. FAQ keyboard disclosure and visible focus;
7. form initial, validation error, submitting, ambiguous/network error, unchanged retry, edited retry and success;
8. back/forward navigation and a reload after ambiguous submission;
9. 200 and 400 percent zoom/reflow; and
10. console, network and accessibility-tree inspection with no submitted PII in URLs or logs.

## Screenshot set still missing

The handover does not contain complete visual-regression evidence for:

- tablet layouts;
- complete keyboard focus-state coverage beyond the retained menu and validation captures;
- submitting, server-error, retry and success states;
- representative lower landing-page sections at all breakpoints;
- 200 and 400 percent zoom;
- non-Chromium engines; or
- production/deployed rendering.

## QA decision

The desktop direction, narrow-width reflow and core local interactions are evidenced in Chromium. All seven measured viewports passed without horizontal document overflow, and the landing/request after-state screenshots were freshly recaptured. Cross-browser, zoom, complete state screenshots and deployed smoke remain absent.

Production browser/visual status: **no-go**. The local Chromium responsive gate is suitable merge evidence, but it does not imply cross-browser or production acceptance.
