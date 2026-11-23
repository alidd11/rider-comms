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

## Commercial-use approval required for imported zone files (21 November 2026)

The *future-only* checksum-pinned data loader now fails closed unless the manifest includes an explicit human-approved commercial redistribution review: approval state, valid review date, traceable internal approval reference, and a licence URL that exactly matches the source provenance. Rejection returns `licence_not_approved` rather than accepting any HTTPS URL as a legal licence. Regression tests exercise absent, false, malformed, inconsistent and excessively long approval metadata. **This technical attestation is not proof of legal rights; the real rights, source terms, attribution and applicable version must be checked by a responsible reviewer before setting the flag.** All current test data remains synthetic: the project still ships no production boundary assets, no unlicensed map data and no live navigation integration.

## UK motorway tolls, bridges and tunnels: reference coverage (21 November 2026)

- The 8 July 2026 Department for Transport written answer lists **20 named or grouped toll infrastructures in England** (not a complete United Kingdom list and not a live licence/charging feed). It includes the **M6 Toll motorway**, M25 Dartford Crossing, Blackwall/Silvertown Tunnels, Humber Bridge, Tyne Tunnels, the Mersey crossings, Tamar Bridge and minor local bridges. https://questions-statements.parliament.uk/written-questions/detail/2026-06-30/hl1520
- A future-only **English toll infrastructure catalogue** in \`backend/src/ukTollInfrastructure.ts\` lists all 20 DfT groups, with safely distinct mechanisms: M6 Toll journey zones; per-passage crossings; the one-way Tamar charge; Warburton daily passage caps; or **operator review required** when rules aren't independently confirmed. It does not assert the list is current, England is the whole UK, any amount is payable, or a user-selected motorcycle is automatically exempt.
- The M6 Toll operator confirms 1–3 tariff zones, a **vehicle class determined by wheels, axles and first-axle height**, varying entry/exit prices and discounted Breeze accounts. Published rates changed 7 July 2026 and are reviewed quarterly. https://www.m6toll.co.uk/pricing/ and https://www.m6toll.co.uk/price-change-jul-26-v4/ . Never infer a tariff class from "Car", "Van", "Motorcycle" or "Scooter" preferences alone.
- \`backend/src/m6TollJourney.ts\` is a **separate offline candidate journey screener**. It validates operator-listed T1–T8 junction entry/exit directions and chronological passage timestamps, counts **one candidate per entry-to-exit journey** rather than one per toll plaza, and accepts only optional unverified 1–3-zone observations. It never calculates fees or discounts and always requires official entry/exit, operator vehicle class and tariff review. Its no-network tests use synthetic journeys. Junction constraints were checked against the operator's official map: https://www.m6toll.co.uk/using-the-m6toll/what-to-expect/ . Temporary slip-road closures, motorway access restrictions and road matching still require real-time/official confirmation before release.
- Official **vehicle rules genuinely differ** across infrastructure. Merseyflow says motorbikes cross both Mersey Gateway and Silver Jubilee free without registering (https://www.merseyflow.co.uk/faqs/). Humber Bridge lists motorbikes and trikes free (https://www.humberbridge.co.uk/plan-your-trip/tolls-ways-to-pay/). The Tamar Bridge is tolled **Saltash→Plymouth only**, with ordinary motorcycles free but trikes, quad bikes and motorcycles with sidecars charged as cars (https://www.tamarcrossings.org.uk/prices/tamar-bridge-tolls/). Rixton/Warburton Bridge currently caps paid trips at **two per calendar day**, with motorcycles exempt (https://www.warburtontollbridge.co.uk/). M6 Toll charges Class 1 vehicles and can grant a person-/registration-linked mobility pass, not a blanket motorcycle exemption (https://www.m6toll.co.uk/pricing/).
- **Outstanding:** add verified, licensed road-level entrance/exit and vehicle classification datasets, confirm separate Scottish/Welsh/Northern Irish coverage, and design a future preview UX that differentiates *toll avoidance*, *possible tolls*, *operator checks* and *rider-declared passes*. No change is permitted to current production navigation; both release gates remain false, no new paid map API calls or redistribution of unlicensed operator data.


## Combined UK toll candidate preview (future-only)

\`backend/src/ukRoadChargePreview.ts\` combines the existing **daily charging-zone exposure counts**, **per-crossing charge counts**, and separate **M6 Toll entry-to-exit journey candidates** without treating toll plazas as extra payable motorway journeys. It strictly compares rider vehicle selection across the component assessments and rejects malformed/duplicated infrastructure hints. It records any infrastructure listed in the DfT English toll catalogue as **requiring separate operator review**; unknown English/Scottish/Welsh/Northern Irish infrastructure is not silently treated as free. Results always have \`completeRouteCoverageVerified: false\` and \`needsOperatorReview: true\`, contain no payable prices or verified exemptions, and are not imported by production routing or UI. Tests use synthetic route/vehicle fixtures.

Before any live rollout, a separate complete route-matching source and operator licensing decision is necessary. In particular M6 Toll zone counts must NOT be calculated from simple 2D line contacts or guessed from Google route polylines; operator-defined entrances, exits, carriageway movement, vehicle height/wheels and tariff version all matter. Do not request any new paid Google routing/tolls SKU or modify the live toll-avoidance setting.

## Research correction: Oxford ended charging, and Durham local RUC (22 November 2026)

**Oxford's temporary congestion charge is NOT still active.** Oxfordshire County Council confirms that the temporary congestion charge **ended on 27 September 2026** and was replaced on **28 September 2026** with six permit-based **traffic filter restrictions**. Motorists cannot simply pay the old £5 charge to pass these locations. A permit and vehicle-specific access rules may apply; this is not a charge-free road or proof of permission. Official: https://www.oxfordshire.gov.uk/transport-and-travel/oxford-traffic-filters/about-traffic-filters

The **Oxford Zero Emission Zone (ZEZ)** still has its **separate charging rules** and official vehicle checker. Never confuse it with the ended Oxford temporary congestion charge or traffic filters. Official: https://www.oxfordshire.gov.uk/transport-and-travel/oxford-zero-emission-zone-zez/check-your-vehicle-and-pay

**Durham Road User Charge Zone** is a separate local road-user charging scheme on Durham city's peninsula, **not one of the seven national Clean Air Zones and not covered by the July DfT list of 20 tolled infrastructure groups**. GOV.UK lists Durham under other road-charging schemes: https://www.gov.uk/uk-toll-roads . The Traffic Penalty Tribunal explains the authority and road-entry charge mechanism: https://www.tpt.gov.uk/faq/ . Verify current authority tariff, scheme operating hours, restrictions and any motorcycle exemption *directly with Durham County Council* before modeling any payable charge; these were not incorporated into the charging calculator.

The future-only module \`backend/src/ukLocalRoadControlResearch.ts\` records **four distinct source-checked scheme statuses** with strict review-date bounds, requires road/access and operator verification for all, and does not calculate money or connect to the released app. Do not treat an omitted scheme as toll-free.

**Free map-data licensing caveat:** OpenStreetMap road data is licensed under ODbL; attribution to OpenStreetMap and access to the licence are required, and ODbL may impose share-alike obligations for derived databases. Commercial reuse of OSM data is possible under its terms, but do **not** combine it into a proprietary road-data asset without checking compatibility and proper notices. Official: https://osmfoundation.org/wiki/Licence/Attribution_Guidelines and https://osmfoundation.org/wiki/Licence/Licence_and_Legal_FAQ . This research does not import or scrape any maps or make additional paid routing calls.


## Road graph evidence quality gate for motorway, bridge and tunnel tolls (22 November 2026)

A 2D map crossing is not proof that a rider entered a tolled way: **bridges, tunnels, underpasses and nearby parallel carriageways can overlap in WGS84 latitude/longitude but have different topology/layers**. An OpenStreetMap \`toll=yes\` tag is a valuable candidate hint, not proof of legal applicability, current operator rates or vehicle-class exemption. OSM documents \`toll:motorcycle=no\` as an optional exception, making absence of that tag particularly unsafe to interpret as a definitive motorcycle charge. Sources: https://wiki.openstreetmap.org/wiki/Toll , https://wiki.openstreetmap.org/wiki/Key:layer and https://wiki.openstreetmap.org/wiki/Access . OSM data is under ODbL and has attribution/share-alike obligations; see https://www.openstreetmap.org/copyright .

New future-only \`backend/src/tollRoadTopologyReview.ts\` checks candidate *matched road way ID, specific layer, travel direction, pinned source-graph SHA256, independent operator review, source freshness and a human-approved commercial-reuse provenance*. Raw GPS geometry, visually overlapping bridges/tunnels, OSM tags alone, mismatched map versions, old permissions, missing graph identities and unknown travel directions **cannot be upgraded to even a topologically screened candidate**. Every result remains \`requiresOperatorReview: true\` and \`routeCoverageComplete: false\`; it NEVER emits a confirmed chargeable road passage, charge amount, discount or exemption. The synthetic tests contain no actual OSM road geometry or commercial operator data. It is **not wired into live routing or Settings**.

The module is intentionally scoped to the 20 historically DfT-listed English infrastructure groups; no claim of complete England, Scotland, Wales or Northern Ireland coverage. Before release, an actual licensed road graph, independent operator road-level assessment, current direction rules, source lineage and required third-party attribution would be needed. The M6 Toll additionally needs operator-specific entry/exit zones and vehicle categories, independently of a single way match.


## Central Auditor source-freshness & motorcycle eligibility response (22 November 2026)

### Freshness policy (new draft-only code, not a regulator's rule)

A scheme's \`effectiveThrough\` and \`exceptionsReviewedThrough\` dates are **not enough**: an operator can change a charge or an exemption while a historically published timetable still says it is valid. The strict offline validator \`backend/src/chargeSourceFreshness.ts\` uses the **predicted local passage instant, not today's day or route departure** as a deterministic comparison reference. Maximum time since authority review, by evidence type:

- **Charging policy, class applicability and operating hours:** 30 days
- **Financial tariff/charge amount tables:** 7 days (future integration only; this PR ships no tariffs or price quotes)
- **Operator-verified vehicle entitlements/waivers:** 7 days, even when the operator's nominal exemption expiration remains months away
- **Pinned reviewed zone geometry:** 30 days, independently of effective zone boundaries and approval of dataset redistribution rights

These are conservative internal **maximum ages**, not evidence that every operator guarantees stable policy within that period. Every subject still requires latest source checks, exceptional/public-holiday calendars, operator notices, exact scheme ID and vehicle/plate/permit check and suitable data-licensing approval. A review timestamp that postdates the prospective passage also fails closed; no future-reviewed source may prove a historical trip. There is no production auto-refresh, no authority API, and no reason to trust a metadata string merely because the time comparison succeeds: provenance/authenticity must be independently reviewed before release.

\`backend/src/chargingRules.ts\` now returns **unknown** on stale or future-dated rule reviews **before** concluding outside hours, vehicle out-of-scope, verified exemption, or absent road crossing. If an entitlement is stale, invalid or has only been user-declared, it **cannot** produce \`verified_exempt\`; a potential charge remains possible when the current authority rule and road evidence support one. \`backend/src/chargeZoneGeometry.ts\` also returns unknown for stale or future-dated geometry snapshots, even when the data's nominal effective window hasn't ended. All route summaries remain \`routeCoverageComplete: false\` and \`needsVerification: true\`, including on apparently empty routes. Test fixtures are synthetic and updated to model recent operator review relative to the simulated travel instant. Separate regression tests exercise stale, future, expired and mixed vehicle cases.

### Official-source findings reverified on 22 November 2026

- **TfL London Congestion Charge** states **£18** when paid same day/in advance or **£21** when paid by midnight three days after travel; core windows are **07:00–18:00 Monday–Friday and 12:00–18:00 weekends/bank holidays**, with a Christmas-to-New-Year bank-holiday interval that must be recorded as a date-specific exception. Official: https://tfl.gov.uk/modes/driving/congestion-charge. **Do not place these figures into the route preview as a payable tariff.**
- **TfL ULEZ** applies to **motorcycles and mopeds**, with Euro 3 emissions compliance for motorcycles; the published £12.50 daily rate is conditional on failure to meet emissions standard and lack of an exemption. Charging applies 24/7 **except Christmas Day**. Check individual vehicle status via the official TfL checker rather than vehicle preference. Official: https://tfl.gov.uk/modes/driving/ultra-low-emission-zone and https://tfl.gov.uk/modes/driving/ultra-low-emission-zone/motorcycles-mopeds-and-more . A ULEZ-compliant motorcycle is **not** automatically free from the separate tunnel user charge.
- **TfL Blackwall/Silvertown tunnel charges** include motorcycles and operate **06:00–22:00**, with peak/off-peak, direction and registration differences; **tariffs changed on 21 September 2026**, so 2025 operator tables must not be used to quote 2026 fees. Official: https://tfl.gov.uk/modes/driving/silvertown-blackwall-tunnels-charge and https://tfl.gov.uk/modes/driving/silvertown-blackwall-tunnels-charge/new-silvertown-tunnel .
- **Dartford Crossing:** GOV.UK lists **motorcycles, mopeds and quad bikes as Class A, free**, with paid classes charged **06:00–22:00 daily**; payment-account categories and qualifying disability exemptions differ. Official: https://www.gov.uk/pay-dartford-crossing-charge/charges .
- **M6 Toll:** the operator currently describes **three toll zones** and vehicle classification by wheels, axles and first-axle height. Charges depend on entry/exit and account status, pricing reviews are usually **quarterly**, and non-standard exemptions (such as mobility passes) need individual eligibility. Official: https://www.m6toll.co.uk/pricing/ .
- **Oxford:** the temporary congestion charge ended **27 September 2026**; the **traffic-filter trial** began **28 September** and restricts **M1 passenger cars/motorhomes** rather than charging drivers to use a filter; motorcycles/scooters and vans are not covered by those filters, **but** the **separate Oxford ZEZ** can still charge petrol and diesel motorcycles. The council says zero-emission motorcycles are not charged in the ZEZ; the vehicle fuel, emissions and individual status must be validated. Official: https://www.oxfordshire.gov.uk/transport-and-travel/oxford-traffic-filters/about-traffic-filters and https://www.oxfordshire.gov.uk/transport-and-travel/oxford-zero-emission-zone-zez/about-zero-emission-zone .
- **National CAZs** require local-authority class, vehicle records and exemptions: not the same charging policy as London ULEZ. The UK government provides a separate checker and guidance. Official: https://www.gov.uk/guidance/driving-in-a-clean-air-zone .

**Outstanding launch blockers:** no legally reviewed complete UK road graph, fully verified motorway toll-zone road matching, operator data licences/refresh pipeline, authenticated official vehicle/permit lookups, signed/traceable review attestations, date-specific exceptions, audited source change alerts, or final PWA/native/Maps Settings integration. These blockers cannot be waived by green CI. No user-facing routing/fee/exemption decision has been enabled.


## Free-first Maps ↔ Tolls coordination, UK lane access, and data provenance (23 November 2026)

**Review-only contract feedback, NOT integration approval.** Maps #572 remains the sole owner of lane guidance, bus-lane/road-access decisions, route generation, navigation UI and graph builds. Tolls #566 remains sole owner of charging assessments, source freshness, charging scheme-to-road evidence and tariff/verified exemption logic. Neither PR is merged or released. No Maps code or production route is changed by this research.

### Maps contract v0.1 — Tolls assessment and required clarifications

The proposed Maps contract on PR #572 (https://github.com/alidd11/rider-comms/pull/572#issuecomment-7088711577) is a sound design baseline. Before approving any shared code:

1. **Pin distinct map-build identities.** Preserve the downloaded OSM PBF SHA-256, *separate* Valhalla graph-build/checksum, routing-profile revision, source extract date and map region. Valhalla graph-edge IDs are only valid in that exact build; OSM way IDs alone do not identify a directed carriageway, stacked bridge, lane or toll. A new graph or profile revision invalidates previously reviewed road-to-charge correspondences until independently rematched.
2. **Provide directed road traversals, not GPS/polygon guesses.** Each candidate must include plan/revision/alternative/leg/traversal occurrence IDs, scoped graph-edge ID, OSM way/node references if available, known bridge/tunnel/layer, forward/backward direction, match method/confidence, road-level coverage and a bounded passage-time interval. Repeated U-turns and tunnel crossings are separate occurrences.
3. **Use absolute passage instants.** Supply earliest, estimated and latest UTC instants per traversal. Tolls must assess *all* relevant local Europe/London windows, bank holidays and effective periods; an interval straddling a charging boundary is uncertain unless every plausible passage has the same outcome. Do not infer passage time from route departure; reject bare local time.
4. **Separate access from monetary consequences.** Maps must return independent lane/road access decisions; Tolls must return separate potential charges, compliance/exemption assessments, source and coverage status. A self-declared exemption, legal toll discount or charging-zone compliance is NEVER permission to enter a prohibited bus lane, bus gate, traffic filter or cycle lane. Do not share an overloaded `allowed` or `free` boolean.
5. **Avoid false certainty.** A charge-free route verdict is forbidden while any section has unknown/missing charge coverage. An OSM `toll=yes` or `motorcycle=yes` tag, bare polygon contact or a Valhalla route preference is not operator evidence. Charge-avoidance suggestions are versioned *advisory* graph-scoped hints, not unconditional route exclusions or guarantees.
6. **Invalidate and bound.** Every reroute increments plan revision; reuse assessments only on an identical plan, graph build, vehicle and data snapshot. Compare *all* alternatives and waypoints using deterministic bounded work, with daily scheme charge dedup by scheme/zone/UK day and each crossing charge counted per occurrence. Unknown road or stale authority source cannot silently become zero.
7. **Keep legal/data licences separated.** Map graph provenance is not permission to redistribute third-party charging polygons/TROs; operator data rights and authentic charging policy require separate review. Do not build a combined database without reviewing ODbL/OGL compatibility and notices.

**No shared TypeScript module yet:** The owner has not approved contract v1, so #566 must not implement the proposed RouteCandidatesV1 adapter, Valhalla edge bridge, lane evaluator, cross-PR imports or live charge-aware rerouter.

### Lane arrows versus legal bus-lane permission (Maps-only)

* A generic Valhalla turn-lane arrow shows maneuver geometry; it is not a legal permission for motorcycles to occupy a reserved bus lane.
* Maps should model a particular directed **lane** separately from its parent road and turn arrow. Proposed Maps-side statuses: `verified_permitted`, `verified_prohibited`, `unknown`. Display a positive motorcycle/bus-lane permission marker **only** for verified affirmative current evidence for the actual vehicle, lane, carriageway direction and *entire* predicted passage-time window. Unknown/contradictory/stale evidence must not show a positive icon.
* Candidate evidence fields for Maps (not Tolls): exact graph and directed road/lane identity, traffic authority, relevant TRO and amendments, applicable road sign, permitted solo-motorcycle/moped category, official source URL, licence/attribution and review timestamp, effective dates, lane-specific/seasonal hours, UK bank-holiday exceptions, closure/suspension notices, direction and match confidence. A turn-only geometry response or generic OSM tag is not a substitute for these.
* Distinguish **with-flow bus lane**, **contra-flow bus lane**, **bus gate**, **bus-only road**, **cycle lane**, and **other traffic filter**. They can have different rules and physical safety requirements. Do not silently infer that a moped, scooter, e-scooter or motorcycle with passenger gets identical access: actual signed/TRO class matters.
* The Department for Transport confirms that traffic regulation orders determine permitted vehicle types and operating hours, and that the motorcycle traffic sign represents a *solo* motorcycle; the DfT advisory definition includes mopeds but excludes e-scooters. UK Highway Code Rule 141 states lane use during operating times requires permission on accompanying signs. England rules are not automatic evidence for devolved authorities or all UK lanes.

Source anchors:
- Highway Code Rule 141: https://www.gov.uk/guidance/the-highway-code/general-rules-techniques-and-advice-for-all-drivers-and-riders-103-to-158
- DfT Motorcyclists using bus lanes (TAL 1/24), local TROs, vehicle definition and signs: https://www.gov.uk/government/publications/motorcyclists-using-bus-lanes-tal-124/motorcyclists-using-bus-lanes-tal-124
- London TfL/borough differences: https://www.london.gov.uk/who-we-are/what-london-assembly-does/questions-mayor/find-an-answer/motorcycles-bus-lanes-1-0
- OSM lane and conditional access tags (candidate evidence only): https://wiki.openstreetmap.org/wiki/Bus_lanes and https://wiki.openstreetmap.org/wiki/Conditional_restrictions

### Legally reusable free-first sources and limitations

| Source | Free-development role | Why it is not a verified bus-lane or toll decision |
| --- | --- | --- |
| Geofabrik regional/UK OSM PBF | Download pinned extract for Maps-owned local Valhalla graph, with separate snapshot SHA-256 and ODbL notices | Community road/toll/access tags can be missing, outdated or contradictory; no statutory licence for riding in a lane |
| OS Open Roads | OGL Great Britain high-level road-network cross-check | Lacks authoritative lane-by-lane TRO/sign coverage; **not Northern Ireland** |
| DfT Digital TRO (D-TRO) | OGL v3 regulation data; useful candidate UK road restrictions, licence reviewed separately | API requires registration/credentials; completeness, freshness, region, real-world sign state and edge correspondence must be assessed |
| Local council / TfL official orders and operator tariff pages | Source of scheme-specific legal restrictions, charges, permitted vehicles, amended hours | Often different publication formats/terms; not proof of reusable licensed road geometry or real-time availability |
| OSM bus-lane/conditional access tags | Candidate mapping data useful for targeted manual authority checks | ODbL and variable coverage/quality; not enough for an affirmative motorcycle lane icon |

Reference links:
- Geofabrik UK extract: https://download.geofabrik.de/europe/united-kingdom/index.html
- Geofabrik download/source rights: https://www.geofabrik.de/en/data/download.html
- OpenStreetMap ODbL legal FAQ and attribution: https://osmfoundation.org/wiki/Licence_and_Legal_FAQ and https://osmfoundation.org/wiki/Licence/Attribution_Guidelines
- OS Open Roads: https://www.ordnancesurvey.co.uk/products/os-open-roads
- D-TRO access: https://www.gov.uk/guidance/digital-traffic-regulation-orders-d-tro-service
- D-TRO licence and registration: https://d-tro.dft.gov.uk/terms_and_conditions and https://d-tro.dft.gov.uk/
- Valhalla route / map-matching APIs: https://valhalla.github.io/valhalla/api/route/api-reference/ and https://valhalla.github.io/valhalla/api/map-matching/api-reference/

### Tolls-only metadata validator — versioned, synthetic, offline

The new backend module `backend/src/chargeDatasetManifest.ts` and synthetic test `backend/tests/chargeDatasetManifest.test.ts` define an independent *charging-only*, schema-versioned manifest. A dataset snapshot records publisher/version, HTTPS source, retrieval date, original-byte SHA-256, licence URL, attribution, human rights-review reference, transform tool/version, output SHA-256, charge evidence kind (rule, tariff, geometry, entitlement) and authority-reviewed dates.

The validator rejects unknown contract keys, lane-permission content, broken checksums, malformed timestamps, inconsistent chronology, missing rights-review metadata and evidence that is out of date at the predicted passage instant. Existing conservative source policies apply: **30 days** for charging rules/geometry and **7 days** for tariffs/entitlements. London daylight-saving and reviewed-through dates are checked; unknown evidence fails closed.

**Critical distinction:** checking a SHA-256 *string* is not hashing actual downloaded bytes; a source URL and a human review-reference field do not grant reuse rights, verify a TRO, prove geographic coverage or confer legal permission. The manifest result always reports `productionApproved: false` and `requiresIndependentAuthorityAndLicenceVerification: true`. Actual binary download/archive/hash verification, signature/attestation, operator legal review and graph matching remain separate release gates. No paid API, downloaded official data, hosted service, route change or production feature flag is added.

### Remaining £0-development / production blockers

Development target is **£0 additional infrastructure spending**. Use local static synthetic graphs, locally pinned extracts when rights are verified, local transformation scripts and deterministic test fixtures. Do not provision paid compute, card-backed trials, subscriptions, paid routes/search or live third-party APIs without owner authorisation.

Features not defensibly deliverable from currently demonstrated *free, licensed, complete, timely* data include: guaranteed UK-wide legally permitted bus-lane guidance, definitive live/temporary lane closures, verified nationwide motorcycle exemption eligibility and number-plate compliance checks, guaranteed charge-free route alternatives, current operator-level tariff coverage for every bridge/tunnel/authority, and reliable real-time traffic. Some areas may become feasible with authority data, manual review or future infrastructure; **do not claim production readiness or £0 long-term hosting** in the absence of evidence.

Both PRs remain draft, unmerged and unreleased; classic navigation and existing Avoid tolls are preserved.
