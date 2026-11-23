# Staff Operations Hub — full-page UX density review (22 November 2026)

## Evidence and scope

Reviewed the **actual rendered Staff PWA** test screenshots from merged PR #582's successful exact-head CI, run [#45073243268](https://github.com/alidd11/rider-comms/actions/runs/45073243268), [artifact #14774209669](https://github.com/alidd11/rider-comms/actions/runs/45073243268/artifacts/14774209669).

The artifact includes 30 distinctive full-page renders for **Overview, Action Inbox, Riders, Moderation, Case Desk, Audit Log, Staff, System, Rider detail and Case detail** across modern-phone Chromium/light, iPhone WebKit viewport emulation/dark and 1280×800 desktop Chromium/light, with synthetic staff data only.

These renders are from actual browser execution of the built PWA, **not visual mockups or production authenticated staff sessions**. Physical iPhone home-screen / Safari verification remains outstanding.

## Diagnosis

1. **All pages:** Every screen repeated branding in the app shell, a prominent all-caps “Operations hub” eyebrow, the page name, a paragraph and another row of reporting/scope controls. On phones, the initial viewport was dominated by chrome rather than staff tasks.
2. **Overview:** Long company hero + company service inventory repeated rider/activity figures before the actual operational summary, KPIs, charts and trends. The mobile full-page Overview screenshot was 20,415 physical pixels tall (device DPR differs from CSS pixels).
3. **Action Inbox / Moderation:** Source filters were attached to page header alongside date/scope controls, competing with the main queue. Inbox also started with a large tutorial-like explanation.
4. **Riders:** A long explanation of sample-scoped reporting displaced search and the actual account list.
5. **Staff:** The add-member form and the complete staff-permission matrix competed for attention with the primary team table.
6. **Case Desk / Audit / System / Rider and Case details:** The same header repetition appeared above live work and detail records. Preserve exact-ID work, audit provenance, date range semantics, staff authorisation, health status and mandatory reasons.

## Implemented in PR #583

- Shared lightweight title/action row for **every** Operations Hub view, without repeating the app name; static header explanations live in keyboard-operable **About this view** details.
- Date selector displays only the chosen period, with its descriptive label still available to assistive technology; live/full-record indicators retain truthful scope.
- The existing source tabs are adjacent to Inbox and Moderation work; the Inbox tutorial is collapsed to a short **How this queue works** disclosure.
- **Overview** now starts with real operational status, KPI tiles and trends. The full, existing company inventory and company pulse remain behind an **expandable** section, with real data and disconnected service labels unchanged.
- **Riders** shows search and records before the returned-sample methodology note.
- **Staff** prioritises the team, with Add member and the complete permission matrix available in clear, expandable sections.
- Search keyboard support now includes Up/Down/Home/End navigation, native Enter activation and a shortcut legend in both the ordinary dashboard and installable Staff PWA.

## Regression and accessibility requirements

- No operational queue items disappear because of date filters; all reported sample counts remain sample-only and must not imply completeness.
- Do not alter permissions, password step-up, case ownership, text sanitisation, navigation routes, mobile update behaviour or the native Rider Comms client.
- Verify title focus/accessible headings and disclosure controls via keyboard; keep 7/30-day select reachable and labelled; no horizontal overflow at 320px.
- Verify the existing 10-view × 3 browser/device screenshot matrix **again on the exact PR head**, comparing first-fold information density and full-page clarity.
- Check the Cases, Inbox, Staff and Rider record workflows after navigating between views and opening disclosures.
- Keep the PR draft; do not merge, deploy or claim physical-device validation without owner authorisation.

## Next suggested refinement (separate PR)

After the compact shell settles, measure actual staff task completion times and tune individual dense working screens (Case Desk triage, Rider 360 panels, System diagnostics) using authenticated, redacted real-data walkthroughs. Do not simply delete provenance disclosures, required notes, or available moderation actions to make screenshots shorter.
