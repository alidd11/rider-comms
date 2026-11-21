# Toll passes, UK road charges and exemptions — Waze research

**Verified 21 November 2026** · Covers [PR #566](https://github.com/alidd11/rider-comms/pull/566). Research and implementation decisions only. The PR does **not** yet implement UK charge-aware routing.

## What Waze actually does

1. Waze offers **Toll and HOV passes**, a recognised pass/vignette catalogue. Users can select multiple passes, inspect all available passes and remove them. Names vary by country and the catalogue changes. Waze **does not currently support clean-air passes on CarPlay** according to its own clean-air-pass Help page; **Android Auto/AAOS** expose pass controls and search. Avoid promising CarPlay parity based on Waze.
2. UK Waze supports clean-air passes for **CAZ, CCZ, LEZ and ULEZ**. Waze's map editors maintain **restricted areas** with vehicle types, permitted passes and time/date restrictions, plus toll-road segments where appropriate.
3. London's **Congestion Charge is not an ordinary toll** in Waze. Its UK guide explicitly states that `Avoid Toll` does not control CCZ; routing avoids the mapped restricted zone during operating hours by default unless the appropriate pass is added (subject to feasibility).
4. Ordinary toll avoidance is **preferential**, not an unconditional prohibition. Waze usually offers a toll-free route first when one exists. Waze's toll estimates factor in date/time, vehicle, route and passes; they are not guaranteed and some variable congestion prices cannot be calculated.
5. Vehicle category matters: motorcycles, private cars, taxis and certain permitted lanes have separate UK map constraints. Never equate a motorcycle with being exempt from every charge.

**Waze references**
- [Adding passes and vignettes](https://support.google.com/waze/answer/9214833?hl=en)
- [Clean-air passes, including CarPlay limitation](https://support.google.com/waze/answer/7670108?hl=en)
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
| **Dart Charge** | Separate tolled crossing. GOV.UK says motorcycles, mopeds and quad bikes cross free of charge; cars and vans can be charged. Confirm applicability by vehicle and route rather than making riders select a blanket exemption. | [GOV.UK Dart Charge](https://www.gov.uk/pay-dartford-crossing-charge/charges) |

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

## Implemented development increment — charging rule evaluator (future only)

- `backend/src/chargingRules.ts` implements a typed, **unwired**, fail-closed contract to evaluate a charging exposure only when road-level crossing evidence, the exact passage time, vehicle class and an authority-backed scheme rule are present. **No production rule feed or geography is bundled.**
- Every rule must carry HTTPS source attribution, an effective date range and a date through which *all exceptions* (for example, bank holidays and Christmas) have been reviewed. Invalid, unsupported or out-of-coverage information yields `unknown`, never an unsupported fee or charge-free claim.
- Daily charges and per-crossing charges remain distinct. The evaluator converts an offset-aware crossing instant to `Europe/London`, handling summertime correctly; charging windows are start-inclusive and end-exclusive. Calendar exceptions override ordinary weekdays. **Passage time is not necessarily route departure time.**
- `operator_verified` eligibility for the exact scheme and vehicle can only suppress a potential charge if the waiver type is scheme-appropriate, has a checked timestamp and has not expired. A self-declared checkbox, discount, Auto Pay registration or unverified emissions claim does **not** produce an exemption.
- `backend/tests/chargingRules.test.ts` checks invalid/stale inputs, polygon-only uncertainty, scheme and vehicle mismatches, London BST, bank holidays, Christmas, pass proof requirements and daily/per-crossing classification.
- This is an engine foundation, **not** a charge schedule or route avoidance system. Until a licensed road/zone dataset, versioned policy feed, reliable crossing geometry and route alternatives exist, keep `TOLLS_EXEMPTIONS_RELEASED = false` on both clients and do **not** call this evaluator from live route previews or endpoints.

## Free-first geospatial screening increment (draft feature)

`backend/src/chargeZoneGeometry.ts` now compiles **in-memory**, separately reviewed GeoJSON `Polygon`/`MultiPolygon`/`FeatureCollection` sources with source and licence attribution, strict coordinate validation, effective dates and a CPU budget. Its companion tests use **synthetic geometries only**. It neither downloads GeoJSON nor calls Google, Waze, TfL or a plate/compliance provider. There are **no new external API calls or subscriptions**.

The screening output is deliberately `possible_polygon_contact`, `no_polygon_contact` or `unknown`. It is **never** a verified legal charging verdict. Line/polygon intersection alone cannot distinguish exempt road corridors, bridges, tunnels, crossing direction, uncertain/sparse polylines or the relevant fee and passage time; those require independently verified road-level restrictions, per-scheme eligibility and updated charging policy. Never convert `no_polygon_contact` into `confirmed_no_crossing` in the existing charge assessor.

Official source catalogue to assess before real imports:
- [GLA London-wide ULEZ GeoJSON](https://data.london.gov.uk/dataset/london-wide-ultra-low-emission-zone-2023-vd455) — **OGL v2**, attribution required, one-off 2024 boundary, refresh/revalidation needed before enabling.
- [TfL Congestion Charge GIS feature layer](https://services1.arcgis.com/YswvgzOodUvqkoCN/arcgis/rest/services/Congestion_Charge_Zone/FeatureServer/8) — original TfL copyright, **confirm specific licence rights** before redistribution.
- [TfL open data users](https://tfl.gov.uk/info-for/open-data-users) — access and data reuse conditions. An API key may be required for live feeds; don't assume one is necessary for downloaded GeoJSON.
- [OpenStreetMap ODbL reuse](https://osmfoundation.org/wiki/License/Licence_and_Legal_FAQ) — **no data licence fee**, but attribution and database share-alike obligations apply. Public OSM tile servers are not unlimited free commercial infrastructure.
- [Google Routes API terms](https://cloud.google.com/maps-platform/terms/maps-service-terms) — respect map/route content caching, downstream use, attribution and relevant EEA restrictions; **do not persist or redistribute Google polylines** as a new zone mapping database.

A future server integration may screen a licensed, current route line **transiently in memory** when already available from the user's normal route request. It must avoid extra paid `computeRoutes` calls and must not become a public route-data ingestion endpoint. The production feature flag remains `false` on native and PWA.

## Offline route-level assessment (21 Nov 2026)

`backend/src/routeChargeSummary.ts` now brings together **two deliberately separate, future-only stages**. `screenChargeAreasForRoute` screens existing route geometry against reviewed charging polygons, returning possible contacts and always requiring road-level review. `summarizeRouteChargePassages` aggregates **separately verified road-passage events** through `assessChargeExposure` and counts potential *daily charges once per scheme/zone/London-local day* while counting *per-crossing events individually*. It cannot determine an amount due, does not make any extra Google Routes calls, never attempts charge-free rerouting, and is not imported by live navigation. Empty, malformed or duplicate evidence is explicitly marked for verification. Tests use synthetic fixtures.

**Release remains off:** no real road-passage detector, no licensed production zone dataset and no authoritative fee catalogue yet. Never convert polygon contact into confirmed crossing evidence, and never treat the output count as a payable price or verified free route.

## Free-first intake and source catalogue — 21 November 2026

- \`backend/src/chargeZoneAsset.ts\` verifies a **human-pinned SHA-256 checksum** before parsing a locally supplied GeoJSON asset, caps each asset at 5 MiB, refuses malformed UTF-8/JSON and legacy \`crs\` declarations, and reuses the existing conservative polygon validator. **No HTTP calls, keys, subscriptions or data storage** are introduced.
- A matching hash proves only byte integrity relative to the supplied manifest. It **does not prove** that a map is correct, current, comprehensive, or licensed for commercial redistribution. Each import needs a documented source/licence review, attribution and update date. The asset module is **not wired to live routing**.
- \`backend/src/englishCazCatalogue.ts\` contains a reviewed, static **reference list only** for England's seven GOV.UK CAZ authorities, their official classes and check links. It does **not** infer any vehicle class exemption, real tariff or boundary. After 90 days, the source should be reviewed again.
- GOV.UK confirms the zones are Bath (C), Birmingham (D), Bradford (C), Bristol (D), Portsmouth (B), Sheffield (C) and Tyneside (C) as of 21 November 2026: https://www.gov.uk/guidance/driving-in-a-clean-air-zone . The service says CAZ charges run midnight-to-midnight and operate 24/7; **Class D can optionally include motorcycles depending on the local authority**, so no universal motorcycle waiver is implied.
- The London Datastore describes the GLA 2023 ULEZ GeoJSON under **OGL v2**, last dataset update January 2024, one-off frequency; the National Data Library lists a September 2026 directory update with the resource licence not separately set. Resolve/reconfirm the original dataset's distribution licence before packaging. https://data.london.gov.uk/dataset/london-wide-ultra-low-emission-zone-2023-vd455
- TfL's Congestion Charge ArcGIS polygon layer is under **TfL copyright** and does not itself grant an unrestricted redistribution licence; keep it out of the app bundle until specific permissions are confirmed. https://services1.arcgis.com/YswvgzOodUvqkoCN/arcgis/rest/services/Congestion_Charge_Zone/FeatureServer/8

**Feature is still gated off** on PWA and native. Source metadata and polygon contact are not definitive proof of chargeability.

## UK scheme coverage caveats — 21 November 2026

- **Oxford Zero Emission Zone is not one of England’s seven national Clean Air Zones.** Its pilot charge runs **07:00–19:00 every day**, is charged daily, and **non-zero-emission two- and three-wheeled vehicles can incur a charge** despite ordinary Euro-compliance. Oxford Council's sources: https://www.oxfordshire.gov.uk/transport-and-travel/oxford-zero-emission-zone-zez/charges-oxfords-zez and https://www.oxfordshire.gov.uk/transport-and-travel/oxford-zero-emission-zone-zez/discounts-and-exemptions . It needs a **separate scheme ID and authority-verified eligibility** before public release; never infer it from a generic CAZ record, ULEZ compliance, or the motorcycle setting.
- **Scottish Low Emission Zones are a different regime from English CAZ daily charging.** Treat them as distinct restrictions/penalty exposure rather than automatically modelling a daily toll. Confirm exemptions, current zone boundaries and enforcement with the official Scottish LEZ service before implementation: https://lowemissionzones.scot/ .
- **Scope/road-data integrity:** The geometry compiler now also rejects GeoJSON with legacy `crs` overrides and zero-area bow-tie rings when called directly, not merely when wrapped by the checksum asset loader. This guards against misinterpreted coordinate systems; a formal offline source review still needs to validate full polygon topology and road corridors.

## Oxford ZEZ backend-only scheme support (21 November 2026)

Official Oxfordshire Council guidance confirms the pilot Oxford Zero Emission Zone (ZEZ) is **not** a national CAZ or London ULEZ. Charging is **daily**, from **07:00 to 19:00 seven days a week**, with a single daily charge covering repeated use; a parked vehicle that does not move is not charged. The charge bands distinguish fully zero-emission vehicles from non-zero-emission two/three-wheelers. Official sources: https://www.oxfordshire.gov.uk/transport-and-travel/oxford-zero-emission-zone-zez/charges-oxfords-zez and https://www.oxfordshire.gov.uk/transport-and-travel/oxford-zero-emission-zone-zez/discounts-and-exemptions

The *unreleased, offline-only* evaluator now models `oxford_zez` as a **distinct daily scheme**. Merely meeting Euro standards, being ULEZ-compliant, or having an Oxford discount does **not** waive the charge. Only an explicitly operator-verified, current Oxford `exempt` entitlement could qualify; user declarations cannot. Synthetic tests cover motorcycles, BST charging windows, discounts and scheme isolation. **No Oxford zone geometry, official entitlement feed, tariffs or active route integration has been added.** Do not extrapolate these sample schedules into production.

## Rider vehicle selection mapping (draft-only)

\`backend/src/riderVehicleChargePreview.ts\` is a pure, future-only adapter between the existing native/PWA \`VehicleCategory\` choices and the coarser road-charge classes used by the charging evaluator. It covers motorcycles, small motorcycles, scooters, cars and vans, and **fails closed** on unknown input. It does **not** infer motorcycle Euro compliance, Oxford ZEZ zero-emission status, engine emissions, registration, toll waivers, license classes or verified exemption status from a user selection. Preview results always require an official vehicle check, never certify a charge-free route, and do not affect live routing or stored user preferences. Synthetic tests exercise five vehicle categories, invalid/prototype inputs, road-specific tunnel exposure and empty routes.

The feature remains fully gated off in native and PWA, and neither the adapter nor tests adds API calls or a paid dependency.

## Candidate road-gate screening (draft-only)

`backend/src/chargeRoadGate.ts` is a synthetic, no-network *candidate* road-gate screen that uses line crossing and reviewer-assigned direction to find possible road-charge gate contacts in an already available route polyline. It validates scheme and local-authority IDs, date coverage, source URL, WGS84 endpoints and input size, and fails closed on malformed/duplicate gates, repeated GPS fixes and ambiguous/touching intersections. The result always carries `requiresRoadReview: true`. It deliberately NEVER emits `confirmed_crossing`, real costs, road legality or eligibility, because a two-dimensional line crossing could be an overpass, underpass, unsuitable carriageway or otherwise non-chargeable road. Reviewer-specified gates also need source and licence auditing before any actual deployment. No paid data service, additional Google route request, production zone data or live-navigation integration is included.

## Boundary import licence and coordinate review (21 November 2026)

Only import or redistribute charging polygons **after an exact-source commercial-use licence review**, copyright attribution, coordinate validation, and an update plan. The free-first code intentionally provides a checksum-validated data loader but **does not include any production boundary files**.

- **GLA/TfL 2023 London-wide ULEZ GeoJSON**: London Datastore directly labels the 1.23 MB GeoJSON resource **Open Government Licence v2**. Resource last updated **11 January 2024** and published as a *one-off* dataset. It is a plausible zero-licence-fee baseline if attribution and original terms are met, but its age requires the current road/zone exemptions to be rechecked before use. https://data.london.gov.uk/dataset/london-wide-ultra-low-emission-zone-2023-vd455
- **National Data Library "Clean Air Zone Boundary - GeoJSON"**: the July 31, 2025 resource listing explicitly says **"Licence: No Licence Provided"**. Do **not** treat a public GeoJSON download as proof of permission to redistribute or use it commercially; check the underlying publisher for specific rights. https://ckan.publishing.service.gov.uk/dataset/clean-air-zone-boundary5/resource/50359b54-e726-4010-a9e3-a9739f9c1962
- **Oxfordshire ZEZ ArcGIS MapServer**: an official service advertises GeoJSON query support but its native coordinate system is **British National Grid EPSG:27700 (metres)**, not WGS84 longitude/latitude. The associated Oxfordshire ArcGIS web map contains Ordnance Survey copyright and states a **non-commercial viewing licence**. Do not scrape, embed or redistribute that hosted map data for Rider Comms until a source-specific commercial-use licence is confirmed. If permission is obtained, legally convert the reviewed source offline to RFC 7946 WGS84 lon/lat, check every shape, store attribution and pin the output checksum; never interpret raw metres as degrees. https://mymaps2.oxfordshire.gov.uk/server/rest/services/WMS/ZeroEmissionZone/MapServer and https://oxfordshiremaps.maps.arcgis.com/apps/webappviewer/index.html?id=67834fc6611247ed8495ec2ba05b3fd6
- **TfL Congestion Charge GIS data**: identify exact licensed source/reuse terms and road-level restrictions separately; publisher copyright is not automatically an OGL grant. Official TfL open data hub: https://tfl.gov.uk/info-for/open-data-users

**Prioritisation:** start with reusable, attributed GLA OGL geometry after independent coverage verification. Do not ship unlicensed Oxford/CAZ geometry or assert road-level charges from 2D polygon/gate intersections. No new paid map, licence or API subscription is approved.

## Official hours audit reference — 21 November 2026

The offline \`backend/src/officialChargingHoursReference.ts\` provides a frozen, documented, **source-backed ordinary weekly-hours reference** for the seven supported charging schemes, plus \`auditChargingHoursAgainstOfficialReference\` to detect imported rules with missing days, wrong periods or incorrect per-day/per-crossing units. A matching result is **NOT an approval**, proof of complete road coverage, holiday coverage, a charge quote, or verification of emissions/discounts: \`requiresAuthorityReview\` is always true. Reference data becomes due for rechecking after 30 days and is **not connected to live navigation or automatically imported into the charge engine**.

Official sources checked:
- TfL Congestion Charge: 07:00–18:00 Mon–Fri, 12:00–18:00 weekends and bank holidays; suspended from Christmas Day through the New Year's Day bank holiday inclusive: https://tfl.gov.uk/modes/driving/congestion-charge
- TfL ULEZ: 24 hours daily, except 25 December (including chargeable motorcycles that do not meet emissions rules): https://tfl.gov.uk/modes/driving/ultra-low-emission-zone
- TfL LEZ: 24 hours every day of the year, with a separate heavy-vehicle applicability regime: https://tfl.gov.uk/modes/driving/low-emission-zone
- TfL Blackwall/Silvertown: 06:00–22:00 daily, except Christmas Day; motorcycle charges are not universally waived; the amount differs by registration, vehicle and direction/peak, and TfL increased charges in September 2026: https://tfl.gov.uk/modes/driving/silvertown-blackwall-tunnels-charge
- GOV.UK Dartford Crossing: 06:00–22:00 daily including holidays, motorcycles and mopeds listed as **free** in official class A; cannot automatically verify whether a selected vehicle really belongs to that class: https://www.gov.uk/pay-dartford-crossing-charge/charges
- National England CAZ: 24h each day, midnight-to-midnight charging; Class D motorcycle inclusion is *optional for each authority*: https://www.gov.uk/guidance/driving-in-a-clean-air-zone
- Oxfordshire ZEZ: 07:00–19:00 daily; motorcycles with non-zero emissions fall into a paid category, while zero-emission vehicles are charged £0: https://www.oxfordshire.gov.uk/transport-and-travel/oxford-zero-emission-zone-zez/charges-oxfords-zez

These are documentary **ordinary-window references** only. Holiday closures must be separately checked in \`ChargingRule.exceptions\`, and zone-specific source/road-level charging rules must be independently verified before any production use. No extra paid API, fee catalogue or government dataset redistribution.
