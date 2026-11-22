# Rider Comms Staff — cross-device dashboard visual quality gate

This design pass builds on the already shared `docs/admin.html` / `docs/admin.css` / `docs/admin.js` implementation and the installable `/staff/` shell. It does not introduce a second design system or independent staff UI.

## What the date dropdown means

- **Overview:** last 7 or 30 days changes the existing first-party rider and social activity metrics and their previous-period comparisons. Live and lifetime metrics remain explicitly live/lifetime, rather than pretending to be period sums.
- **Audit:** 7 or 30 days filters only the most recent 200 returned decisions, by recorded action time; it is not a complete historical query. CSV exports contain only the visibly filtered rows.
- **Staff:** 7 or 30 days filters the 20 returned security sign-in events. The entire staff roster remains visible regardless of when a person joined.
- **Riders:** reports the number of accounts among the most recent returned results whose registration falls inside the selected range. Search results are never hidden.
- **Case Desk and Action Inbox:** reports recent activity within their bounded response snapshots. Existing case workload counts, active cases, and safety work stay visible regardless of age. Case paging and ownership permissions do not change.
- **Moderation, System and individual case/rider records:** use the same scope-indicator style, but never offer a misleading date selector where the backend only exposes live, rolling-hour or full-history data.

The range is a display preference, not an authorization boundary. Backend permission checks, signed-in session handling, note requirements, and private-data limitations remain unchanged. Preferences are kept locally; no rider information is written to the preference key.

## Real rendered screenshot matrix

The Playwright test `staff Operations Hub screenshot evidence` loads the real built `/staff/` PWA from the repo, using test-only, in-memory network fixtures—not screenshots of Figma or a mockup. It captures **Overview, Action Inbox, Riders, Moderation, Case Desk, Audit Log, Staff, System, Rider detail and Case detail**, in:

1. Mobile Chromium emulation (modern phone, light).
2. Mobile WebKit emulation (iPhone 17 Pro Max CSS viewport, dark).
3. Desktop Chromium (1280 × 800, light).

The test attaches full-page PNGs to its Playwright HTML report and `test-results/playwright`. GitHub CI uploads both in its **pwa-visual-audit** artifact. These are genuine browser renders with **synthetic fixtures**; staff must separately review real data on an authorised instance. No production token, customer record, private map location or password appears in screenshot fixtures.

## Review checks

Check the visible fixed mobile header beneath the safe area; sticky desktop toolbar; keyboard navigation; dropdown labels and selected value persistence; no clipped report actions, case controls or system tables; no horizontal document overflow at narrow widths; readable status colours in dark and light modes; and unfocused stale network responses never overwriting newer views. For screenshots, check title and data scope above the fold, consistent spacing, card density and no masked focus outlines.

Manual **installed iOS Home Screen PWA** and desktop Safari/Chrome capture and interaction remain release sign-off tasks. Playwright viewport emulation cannot prove real iPhone safe area, service worker updates, or native browser rendering.

## Design references and acceptance criteria

- [Linear's March 2026 UI refresh](https://linear.app/changelog/2026-03-12-ui-refresh): keep navigation lightweight, hierarchy legible and repetitive tasks low-friction. The Staff shell keeps role-scoped navigation, slim breadcrumb toolbar and consistent density.
- [Linear filters](https://linear.app/docs/filters): date controls belong with the specific data affected, and selection state must survive navigating between views.
- [Shopify Polaris date-picker guidance](https://shopify.dev/docs/api/admin-extensions/latest/web-components/forms/date-picker): common presets such as last 7 and last 30 days should be easy to select. A custom range must not be suggested until corresponding backend range queries are implemented.
- [WCAG 2.2 focus not obscured](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum): sticky headers must not hide a keyboard focus target. Test on tall desktop reports and mobile screens, including visible focus of the date selector.

Accessibility review includes reduced-motion behaviour, pointer/touch target sizing, field labels, safe-area padding, keyboard navigation, and descriptive unavailable-data states. Screenshot tests are regression evidence, not an accessibility conformance certification.
