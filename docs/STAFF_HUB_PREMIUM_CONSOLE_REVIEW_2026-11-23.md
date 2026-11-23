# Staff Operations Hub — Premium Operations Console Design Review

**23 November 2026** · proposed-only, draft PR · base \`010815cffeee0115a3a3ca13cf986ec7d6279420\`

## What changed
The staff UI was passing regression tests, but lacked a consistent visual hierarchy. It had a white navigation rail against white cards, many equally weighted metrics, promotional-looking capability tiles, long mobile card stacks and bright focus rectangles around page titles.

This PR introduces one shared visual system for the existing **/admin.html** and **/staff/** surfaces:

- **A distinct ink-dark navigation rail and mobile header** with high-contrast labels, a visible current-section state, a clear close control and preserved keyboard focus.
- **A page hierarchy** with an intentional title scale, restrained scope disclosure, clearer toolbar grouping and shared control dimensions.
- **An actionable Overview** in which the attention card leads and secondary platform metrics become a connected strip; mobile uses fewer long single-column cards.
- **Compact Insights** and consistent borders, type and chart framing instead of eight competing marketing-style cards.
- **Company Areas as a capability directory** with a shared row structure, grounded connection statuses and actions.
- **Case Desk as a scannable work queue** with a compact workload strip, uniform filter toolbar, text-labelled priorities and preserved due-target distinctions.
- **Common polish** for Riders, Moderation, Action Inbox, Audit, Staff, System, case detail and Staff sign-in.

## Security and functional constraints
No backend, database, role permissions, authenticated API calls, user input flows, reporting time semantics, billing, Map/Tolls or Rider Social product files changed. The base brand colour generation block remains untouched. Dark mode, iPhone safe areas, keyboard focus, 44px touch targets where required, reduced motion and screenshot fixtures remain in scope.

## Acceptance gates
1. Exact-head CI, isolated security staging, visual and accessibility checks all pass.
2. Compare genuinely rendered **before** (#587 CI visual artifact 14784175529) and **after** screenshots at desktop, mobile and dark WebKit. Inspect every major view, not merely the Overview.
3. Confirm no horizontal overflow at tested mobile widths, visible accessible navigation focus and correct active menu state.
4. Keep PR draft and do not merge/deploy without owner approval.

## Verification limits
Playwright Staff screenshots contain deterministic mock API data; physical installed iPhone testing and authenticated production interactions are not represented by the artifacts.
