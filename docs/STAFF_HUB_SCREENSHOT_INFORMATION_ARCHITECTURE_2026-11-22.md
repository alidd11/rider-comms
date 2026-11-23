# Staff Operations Hub — screenshot-led navigation and reporting pass
**Date:** 22 November 2026  **Base:** production PWA #584, commit `60af41cef466fa9d4c850a474b00a265908d9952`

## What was inspected

Actual **full-page Playwright browser captures**, not concept drawings, from PR #584's successful exact-head CI run [#45080614722](https://github.com/alidd11/rider-comms/actions/runs/45080614722), [artifact #14777563759](https://github.com/alidd11/rider-comms/actions/runs/45080614722/artifacts/14777563759). Three targets × ten staff views:
- Desktop Chromium 1280×800 viewport, full-page Overview **1280×2626**.
- Mobile Chromium, full-page Overview **1179×13347** device pixels.
- Emulated iPhone 17 Pro Max WebKit dark, full-page Overview **1320×13326** device pixels.

These are real browsers running the Staff PWA with deterministic, synthetic staff fixtures. **They are not authenticated live customer-data screenshots or physical iPhone testing.** Production deployment for the same #584 feature set succeeded in GitHub Pages; this does not itself certify authenticated user-facing visual behaviour.

## Findings and concrete design response

1. **Overview was a report dump, not a landing screen.** It combined four operational cards, eight KPI tiles, four trend charts, a growth funnel, company service inventory and community/safety tables. More than thirteen thousand device pixels on phones made finding the primary staff tasks unnecessarily difficult.
   - New landing page: current action priorities, clear shortcuts and three short platform indicators. No graphs or hidden long inventory.
2. **The reporting date selector appeared on unrelated operational views**, including accounts, staff and action queues; it did not filter the primary work. Some views displayed a 7/30-day preference against full-history records, creating a misleading impression.
   - The *same labelled Period: Last 7/30 days* control now appears on **Insights** and **Case Desk**, where it governs real historical metrics and explanatory sample counts. It never hides open cases or moderation items. Other pages show context as needed without an ineffective selector.
3. **Analytical and company inventories had no clear home.**
   - A role-gated **Insights** sidebar page now owns the period comparisons, eight existing KPIs, four charts, growth funnel and community/safety tables, backed by the same existing API and explicit source limits.
   - A role-gated **Company areas** sidebar page owns the eight existing operational/service sections, with disconnected billing clearly labelled and the platform pulse available through a disclosure control.
4. **Different devices made the same content compete for attention.**
   - Overview becomes a responsive four-across / two-across / one-across action grid depending on width, followed by three compact labelled indicators. Header metadata stays short and date controls are consistent and keyboard-operable.

## Scope and quality gates

- Shared JavaScript, CSS and both shells (`/admin.html` and installable `/staff/`) must remain the same product.
- No backend API, permission scope, payment provider, native Rider Comms client, experimental Maps/Tolls code, or security-role changes.
- Preserve all original data and charts; reorganise them into named pages, not delete them or invent metric coverage.
- Include the two new pages in role-aware sidebar, command search, navigation hashes, accessibility scans and full-page screenshot verification.
- Assert Overview has no charts, funnels or time selector; Insights still has all eight KPI values, four chart readouts, period persistence and funnel conversion; Company keeps authorisation-gated actions and 'Not connected' finance caveat.
- Capture **12 views × 3 browser/device targets = 36 new screenshots** and compare first fold, mobile overflow, focus and dark-mode legibility before marking ready to merge.
- Never claim a physical installed-PWA test or live authenticated service smoke test was performed without actual evidence.

## Reviewed rendering evidence — PR head `64d7ef19`

The complete generated `pwa-visual-audit` artifact [#14779943455](https://github.com/alidd11/rider-comms/actions/runs/45086669212/artifacts/14779943455) was downloaded and inspected across all 36 full-page images. The original exact-head CI and isolated security staging both passed. This is browser-emulated fixture evidence, not live authenticated or physical iPhone validation.

- Overview full-page **desktop: 2626 → 800 px**, **mobile Chromium: 13347 → 3858 device px**, **WebKit dark: 13326 → 3834 device px**. All four operational cards and three snapshot highlights are readable, and analytics have moved into Insights.
- Case Desk full-page **desktop: 1125 → 976 px**, **mobile: 4455 → 4107 px**, **WebKit dark: 4359 → 4011 px**. Three rows of segmented filters are replaced by Workstream/Status/Ownership fields with correct mobile wrapping.
- New Insights holds the existing historical reporting; new Company areas contains the eight service categories and visibly unconnected finance. Long reporting and catalogue views are deliberately separate from Overview.
- No obvious visual overlap or horizontal document overflow was observed in the 36 screenshots. This is not a substitute for live permissions, installed PWA, interaction or accessibility testing.
- Follow-up refinement: make snapshot timestamps explicitly UTC, make Audit and Staff sign-in time controls accurately scoped, and remove misleading complete-history claims. Re-test and re-capture screenshots at the new exact head before declaring release readiness.
