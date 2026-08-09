# Browser QA evidence

Status: retained local Chromium evidence for the public overhaul. This is not a production smoke test or a substitute for the remaining authenticated, assistive-technology, and cross-browser gates.

## Build and target

- Source: current UI-overhaul working tree based on commit `92fff5fb5e50069c2fff57cabec9b4e8d689185e`.
- Target: local Vite production preview at `http://127.0.0.1:4173/`.
- Browser: Chromium controlled through the Codex in-app browser.
- Data: public content only; no client or tender data was used.

## Responsive sweep

The landing page was inspected at 320, 768, 1024, 1440, and 1920 CSS pixels. At every width:

- document width equalled viewport width;
- no page-level horizontal scrollbar appeared;
- no visible interactive control extended outside the viewport;
- navigation remained reachable;
- the primary commercial action and existing-customer sign-in remained distinct.

The 320-pixel run exercised the accessible mobile menu and verified that it closes after navigation. The menu trigger was 44 by 44 CSS pixels and displayed a two-pixel solid focus indicator under keyboard focus.

## Public route and metadata sweep

The following indexable routes were opened directly: `/`, `/product`, `/solutions`, `/how-it-works`, `/security`, `/about`, `/contact`, `/privacy`, and `/terms`. Each rendered one primary heading, a descriptive title, canonical metadata, and indexable robots metadata. Server composition tests also verify that each public deep link returns route-specific crawler-readable HTML before JavaScript executes. Unknown routes return an explicit not-found experience with HTTP 404 and `noindex` metadata rather than a soft 404.

`/sign-in` and a protected pursuit deep link were sampled both immediately and after lazy identity loading. Both removed public canonical/Open Graph URL metadata and applied `noindex, nofollow` before provider resolution, preventing transient private-route indexing.

The social preview is a crawler-compatible 1200 by 630 PNG, with dimensions and signature enforced by a source test. Canonical and Open Graph URLs are emitted only for the fixed public-route allowlist; request paths are never reflected into metadata.

## Interaction and integrity checks

- Mobile navigation opened, received visible focus, and closed on navigation.
- Every public link resolved to a real route or configured external destination.
- The unconfigured contact state exposed no pretend form, dead action, or outgoing commercial link.
- No empty interactive element or hash-only dead link was detected.
- Browser console inspection found zero errors and zero warnings during the retained sweep.
- Public pages did not expose tender, organisation, or user data.

## Retained images

- `evidence/landing-320.jpg`
- `evidence/landing-1440.jpg`
- `evidence/contact-unconfigured-1024.jpg`

These are after-state images only. No trustworthy baseline image set existed, so this pack does not claim pixel-level before/after regression coverage.

## Performance evidence

Protected application routes and all eight pursuit tabs are lazy-loaded. The final production build measured the protected shell at 113.40 kB raw / 31.49 kB gzip, down from approximately 856.6 kB / 246.3 kB before route splitting. The spreadsheet dependency is isolated to the BOQ chunk (376.19 kB / 127.63 kB gzip), project details are 44.99 kB / 13.02 kB gzip, and no generated chunk exceeded 500 kB.

These bundle measurements demonstrate delivery improvement, not field Core Web Vitals. LCP, INP, and CLS at the 75th percentile still require production or representative staging telemetry.

## Remaining browser gates

Before public promotion, run the full role-and-tenant matrix with a configured Clerk test tenant in current Chrome, Edge, Firefox, and Safari/WebKit where supported; add axe automation; complete NVDA plus keyboard-only testing; inspect 200% and 400% zoom; exercise slow/offline upload recovery; and record authenticated screenshots for loading, empty, partial, error, blocked, expired, long-content, and high-density states.
