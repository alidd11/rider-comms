# Toll passes, UK road charges and exemptions — Waze research

**Verified 21 November 2026** · Covers [PR #566](https://github.com/alidd11/rider-comms/pull/566). Research and implementation decisions only. The PR does **not** yet implement UK charge-aware routing.

## What Waze actually does

1. Waze offers **Toll and HOV passes**, a recognised pass/vignette catalogue. Users can select multiple passes, inspect all available passes and remove them. Names vary by country and the catalogue changes. On **CarPlay** passes must be managed on the phone; **Android Auto/AAOS** expose pass controls and search.
2. UK Waze supports clean-air passes for **CAZ, CCZ, LEZ and ULEZ**. Waze's map editors maintain **restricted areas** with vehicle types, permitted passes and time/date restrictions, plus toll-road segments where appropriate.
3. London's **Congestion Charge is not an ordinary toll** in Waze. Its UK guide explicitly states that `Avoid Toll` does not control CCZ; routing avoids the mapped restricted zone during operating hours by default unless the appropriate pass is added (subject to feasibility).
4. Ordinary toll avoidance is **preferential**, not an unconditional prohibition. Waze usually offers a toll-free route first when one exists. Waze's toll estimates factor in date/time, vehicle, route and passes; they are not guaranteed and some variable congestion prices cannot be calculated.
5. Vehicle category matters: motorcycles, private cars, taxis and certain permitted lanes have separate UK map constraints. Never equate a motorcycle with being exempt from every charge.

**Waze references**
- [Adding passes and vignettes](https://support.google.com/waze/answer/9214833?hl=en)
- [Clean-air passes](https://support.google.com/waze/answer/7670108?hl=en)
- [Avoiding toll roads](https://support.google.com/waze/answer/6262566?hl=en)
- [Toll estimates](https://support.google.com/waze/answer/9370512?hl=en)
- [UK Wazeopedia: roads, tolls and restrictions](https://www.waze.com/discuss/t/roads/379230)
- [UK Wazeopedia: restricted areas](https://www.waze.com/discuss/t/editor-features-restricted-by-rank-uk/379215)

## UK schemes — source-of-truth rules

| Scheme | Important distinction | Source |
| --- | --- | --- |
| **London Congestion Charge (CCZ)** | Zone + charging period rather than a toll road. Two-wheeled motorcycles/mopeds are exempt. Discounts may depend on registration and Auto Pay. As of November 2026, weekday charging is 07:00–18:00, weekend/bank-holiday charging 12:00–18:00; Christmas/New Year exception. | [TfL CCZ](https://tfl.gov.uk/modes/driving/congestion-charge), [TfL exemptions](https://tfl.gov.uk/modes/driving/discounts-and-exemptions) |
| **London ULEZ** | Emissions *compliance* is distinct from a legal exemption. Motorcycles can be chargeable. 24h daily, except Christmas Day. Never auto-declare a vehicle compliant from its category. | [TfL ULEZ](https://tfl.gov.uk/modes/driving/ultra-low-emission-zone) |
| **London LEZ** | Different vehicle categories, operates all day including Christmas Day. Not interchangeable with ULEZ. | [TfL where and when](https://tfl.gov.uk/modes/driving/congestion-charge/congestion-charge-zone) |
| **Blackwall & Silvertown tunnels** | Crossing-specific (not daily zone) charging, **06:00–22:00** except 25 December. Motorcycles generally pay, unlike CCZ. Fees changed on **21 September 2026**. Off-peak/discount rules may require Auto Pay or prior registration. | [TfL tunnels](https://tfl.gov.uk/modes/driving/silvertown-blackwall-tunnels-charge/new-silvertown-tunnel), [TfL exemptions](https://tfl.gov.uk/modes/driving/discounts-and-exemptions) |
| **English CAZs** | GOV.UK currently lists Bath, Birmingham, Bradford, Bristol, Portsmouth, Sheffield and Tyneside. Different Class A–D coverage; Class D *may* include motorcycles at the local authority's discretion. Do not offer a universal 'CAZ exempt' guarantee. | [GOV.UK CAZ](https://www.gov.uk/guidance/driving-in-a-clean-air-zone) |
| **Dart Charge** | Separate tolled crossing. Determine segment, vehicle-specific charge, applicable times and exemptions from the current operator data. | [GOV.UK Dart Charge](https://www.gov.uk/pay-dartford-crossing-charge) |

**Rules change.** Do not hard-code current prices or schedules into a long-lived app build without effective dates, update process and expiry validation. Official checkers must remain available to the user.

## Google Routes API capability boundary

The current backend uses Google Routes (`computeRoutes`) with legacy Directions fallback. `avoidTolls` can express a preference about standard toll roads. Google's published toll-pass enum does **not** contain UK passes; `extraComputations: ['TOLLS']` provides pricing only in supported markets and increases API billing. There is no documented option to pass a Waze-style UK ULEZ/CCZ exemption into our existing Google routing request.

- [Google toll estimation](https://developers.google.com/maps/documentation/routes/calculate_toll_fees)
- [Routes coverage and two-wheeler limitations](https://developers.google.com/maps/documentation/routes/coverage)
- [Google TollPass list](https://developers.google.com/maps/documentation/routes_preferred/reference/rest/Shared.Types/TollPass)

**Do not claim** a Waze SDK or Waze mapped-zone feed is generally embeddable or reusable. Obtain licensed/official geographic boundaries and road-level restrictions separately. External navigation to Waze, Google Maps or Apple Maps uses the **destination app's own** passes and toll settings; Rider Comms cannot silently transfer these user selections.

## Rider Comms design / implementation requirements

**Keep one discoverable child page:** Settings → Map & navigation → **Tolls & exemptions** (as in PR #566); native and PWA must have the same page, row order, wording and behaviour.

1. **Avoid toll roads**: existing working Google route-avoidance preference, independent from the zone passes. The route may still include a toll if no acceptable alternative exists.
2. **Vehicle profile**: link entitlement rules to vehicle type and, later only when justified and privacy-reviewed, emission standard or verified plate checks. Car, van and motorcycle eligibility differ.
3. **Distinct legal statuses**: `unknown | compliant | exempt | discounted | registered | paying`. Do not store all as equivalent 'free pass' booleans. Store a source `user_declared | official_checked`, `checkedAt`, effective dates, scheme version and optional expiry.
4. **Selected passes UI**: let users review/remove active declarations; offer a searchable local/supported catalogue rather than a huge flat list. Label scheme eligibility clearly with official check links. A checked option alone is **not proof** of exemption.
5. **Route calculation**: needs authoritative polygon boundaries and applicable *road segments* with exclusions, route intersection/crossing detection, directionality, vehicle classes, `Europe/London` clock times, bank holidays and rule-effective periods. Polygon overlap alone can mislabel elevated roads or tunnels.
6. **Route preview**: show matched fees/status only if computation is defensible. Otherwise say **'Charge may apply — check with the operator'**, not 'Free', '£0', or 'Toll avoided'. Distinguish daily charges from each tunnel/crossing use; handle overlaps without incorrectly doubling daily charges.
7. **Routing alternatives**: Google cannot be assumed to route around arbitrary restricted polygons through `avoidTolls`. Investigate road-network avoidance and realistic alternate-path options before promising charge-free navigation. Keep waypoints and multi-stop routes intact.
8. **CarPlay/Android Auto**: prepare for preferences to be configured on the phone and surfaced read-only while driving. No complex configuration during a ride. Device-local settings are **not** synced across devices yet.

### Verification matrix before implementing automated charge-free claims

- Motorcycle vs car vs van, compliant vs non-compliant, exempt vs discounted vs registered-but-chargeable.
- CCZ 06:59/07:00/18:00 and weekend 11:59/12:00; tunnels 05:59/06:00/22:00; ULEZ day boundary, Christmas exceptions, bank holidays, BST transitions.
- Route just outside a zone, road crossing a boundary, road under/over restricted polygon, multi-stop and alternative routes, repeated crossing and overlapping CCZ+ULEZ.
- Incorrect/self-declared entitlement, stale official source, failed API lookup, unknown eligibility, route provider failure and external handoff.
- PWA WebKit and native tests for navigation, saved preferences, profile switching, reset, corrupted storage, accessibility, and Ride Safe restrictions.

### PR #566 limits and CI requirement

The PR currently saves *user-declared, device-local* selections with an on-screen warning. They **do not yet alter routes, fees, legal eligibility or external provider settings**. Do not merge as a completed Waze-equivalent feature.

After modifying `docs/app/*.js`, regenerate and commit `docs/app.js` using `npm run build:pwa-app`; CI rejects stale generated output. Test lint, typecheck, unit tests, native Jest/coverage and affected PWA Playwright interactions on the **exact PR head** before marking ready. **All work for this effort remains in PR #566; no sibling PRs.**
