# Rider Comms Maps — low-cost mapping platform foundation

Status: research/prototype only. Dedicated draft PR. Do not merge, publish or wire into the live Rider Comms map without explicit release approval and native/PWA parity verification.

## Goal
Build Rider Comms' own map experience with OSM data, our own UI, our own hazard/ride overlays and eventually open-data motorcycle routing, while avoiding per-map-view licensing fees and unexpected usage-based billing. “Own map” means we control the renderer, design, map provider, data pipeline and navigation UX; we do NOT claim ownership of OpenStreetMap contributors' geographic data.

## Existing baseline (main branch, 21 November 2026)
- PWA: Google Maps JavaScript API, live location, hazards, group rides, directions display.
- Android: react-native-maps using Google; iOS: react-native-maps using Apple MapKit.
- Directions: backend Google Directions / Routes implementations; search: Google Places. Rider Comms already owns navigation guidance, rider puck, safe-driving UI, camera, reroute decisions.
- External Google Maps, Waze and Apple Maps handoff remains a user option.
- This proof of concept does not change any of those paths, accounts, feature flags, API keys or billing.

## Prototype, map-lab/
- Separate local browser preview; no link from the production PWA and no deployment configuration.
- MapLibre GL JS 6.3.0 loaded from a pinned CDN module, OpenFreeMap Bright/Dark vector basemap.
- Manual day/night, zoom/rotate/pitch controls, sample London camera, provider attribution, accessible controls and explicit tile-error state. No real user location or Rider Comms API requests.
- Opt-in illustrative route layer (**not real road geometry, not turn-by-turn directions**), with source/layer rehydration when changing day/night styles. This is a renderer test only, not a navigation product.
- `map-lab/open-route.mjs` provides a bounded [longitude, latitude] open-routing geometry boundary, whitelist for Valhalla/OSRM backed by OSM, explicit no-traffic/no-navigation-ready metadata, cloning of input coordinates and rejection of unverified traffic/speed/toll/Google fields. This does not yet connect a real routing server.
- `map-lab/route-adapters.mjs` now normalises offline **OSRM GeoJSON** and **Valhalla polyline6** responses (including multi-leg seam de-duplication, km/mile conversion, geometry/range validation). Outputs are still `navigationReady: false`, without live routing requests. A response's engine provenance is assigned by its own adapter, not accepted from arbitrary input.
- Hardcoded unreleased state with provider-compatibility guard and repository check script.
- Run from repository root: python3 -m http.server 8765, then visit http://localhost:8765/map-lab/ . Internet access is required for MapLibre and tiles.
- Verify: node scripts/check-rider-maps.mjs (also included in npm run lint).
- The preview is not a production-ready map and has not been field-tested on native devices.

## Provider and commercial-licensing boundary — mandatory
Google Maps Platform terms explicitly forbid showing Google Directions, Routes or Places API content on a non-Google map. Do not display Google-generated directions, route polylines, ETA, nearby place results, place details or search results inside MapLibre, including through a backend proxy. Google navigation stays with the current Google map until open-source directions/search are operational. The legacy Google basemap must not be swapped to MapLibre with an unchanged Google Directions backend.

Allowed open-basemap layers need provenance and licences:
- OSM-based vector tiles with required OSM attribution and host attribution.
- Rider-owned hazards, private-ride member positions subject to existing opt-in/authorisation, and our own route data.
- Open-data routing output from appropriately licensed/self-hosted Valhalla or OSRM and an independent places/search backend.
- No claim of real-time traffic, speed limits, lane guidance, toll-avoidance or exemption eligibility unless supported by qualified fresh data.

## Platform plan with zero-to-low cost focus
1. Map rendering and cost audit: evaluate MapLibre web plus MapLibre React Native v11 on Expo SDK 58 / new architecture. Only enable PWA/native together after performance, safe-area, accessibility, gestures, camera, avatar and overlays parity checks. MapLibre on native requires a custom development/production build; Expo Go is insufficient. Native upgrade risks are real; do not alter the current production map until tested.
2. Tiles: OpenFreeMap hosted styles for research and potentially early production subject to its current Terms of Service, availability and privacy review. No API key or usage charge currently; no SLA. Do not bulk scrape tiles. Prefer a first-party tile domain and a regional static PMTiles extract once scale or reliability requires it; investigate Protomaps + Cloudflare R2 or another static storage/CDN host. Style JSON, sprites and fonts need hosting too. Evaluate caching and cache invalidation. Offline packaging must use licensed/self-hosted data, not OSM public tiles.
3. Routing: prefer piloting Valhalla's supported `motorcycle` and `motor_scooter` costing models, while keeping OSRM as a driving-only comparison unless a legally and technically verified bespoke motorcycle profile exists. Compare both with a UK regional graph. Require motorcycle access classification and UK turn restrictions, robust alternative routes, ferries, motorway/toll avoidance, geometry, turn-level manoeuvres, traffic-free ETA labelling, rerouting and route quality against real rider trips. Host on a small server when ready; public demo routing servers are not a production backend.
4. Search: use own/paid-if-needed geocoding and POI index (for example Photon or Nominatim self-hosted/legit hosted API); an existing public Nominatim endpoint is not appropriate for multi-user production autocomplete. Support favourite places, search ranking, categories and parity, with latency budgets and cost caps.
5. Migration: introduce a fully separate open-map data source interface. Turn on only when open routes and places can replace Google responses for that map. Preserve external navigation choice, consent, Ride Safe, active navigation visibility, curated routes, PWA/native parity and unreleased tolls/exemptions gates. A feature flag must remain off until product, legal, QA and budget sign-off.

## Actual cost exposure
- OpenStreetMap data and MapLibre code: £0 software/data licence fee subject to ODbL attribution/obligations.
- OpenFreeMap hosting: currently no API key or fee, but as-is, no availability guarantee or indefinite promise.
- Cloudflare R2 Standard: 10 GB-month storage, 1M Class A and 10M Class B requests/month free (as of 30 October 2026); above free tier costs apply; a UK PMTiles extract size and request pattern must be measured before claiming £0. Cloudflare Workers have separate quota/cost considerations.
- Routing, address search, tile builds and routine OSM updates require compute/storage/monitoring time even with free software. Battery, data use and third-party failure are material costs. Keep usage budgets and alerts, and never enable automatic pay-as-you-go services without owner approval.
- Real-time traffic, verified speed limits, street-level imagery, paid address/POI enrichment and full offline worldwide maps are NOT included in this £0 prototype.

## Non-negotiable acceptance criteria before migration
- Navigation/ride map works 1:1 on installed PWA, iOS and Android; no hiding controls on unreliable GPS and no violation of the ~8 mph Ride Safe threshold behaviour.
- Rider identity/avatars, hazard markers, private-ride consent, map camera, route preview, turn-by-turn visuals, ETA, speech, reliable rerouting and readable day/night labels.
- Non-Google map receives no Google Directions/Routes/Places data; verified legal attributions and privacy notices.
- Mobile network/poor connectivity and graceful failure; no invented route, traffic, toll waiver, lane or posted speed-limit claims.
- Measured real-device navigation UX at 4–6h battery/thermal use, zoom performance and tile/data bandwidth; production observability and cost caps.
- Explicit sign-off before merge, feature enablement or deployment. Do not touch active tolls/exemptions draft PR #566.

## Sources checked 21 November 2026
- MapLibre GL JS: https://maplibre.org/maplibre-gl-js/docs/
- MapLibre React Native Expo setup: https://maplibre.org/maplibre-react-native/docs/setup/expo/
- OpenFreeMap terms (updated 14 Oct 2026): https://openfreemap.org/tos/
- OpenFreeMap quick start: https://openfreemap.org/quick_start/
- Google Maps Platform service-specific terms: https://cloud.google.com/maps-platform/terms/maps-service-terms
- OSM standard tile policy: https://operations.osmfoundation.org/policies/tiles/
- OSM Nominatim usage policy: https://operations.osmfoundation.org/policies/nominatim/
- Protomaps PMTiles: https://protomaps.com/
- Cloudflare R2 pricing: https://developers.cloudflare.com/r2/pricing/
- Valhalla: https://valhalla.github.io/valhalla/start/introduction/
- Valhalla API response, polyline6 and motorcycle/motor_scooter costing: https://valhalla.github.io/valhalla/api/route/api-reference/ and https://valhalla.github.io/valhalla/api/decoding/
- OSRM GeoJSON route response: https://project-osrm.org/docs/v26.6.1/http.html


## Admin beta launch — draft only
- Under Map & navigation, admins have a server-verified entry after `GET /admin/me` returns `role: "admin"`; support/moderator/analyst and unreachable sessions fail closed. Re-check at tap to handle role revocation.
- The PWA navigates to `docs/map-beta/`; the native build launches that same stand-alone beta in the system browser. MapLibre Native is not installed yet. Both provide a return to classic map. This is a **map-only preview, not an in-app routing mode**; Google Directions/Places, rider positions, overlays and active navigation are untouched.
- The static preview URL is accessible by direct link because it serves public OSM data only; the **button is admin-only**, not the static public geography. Never add confidential rider/admin data there.
- No automatic rollout, preference persistence, Google content mixing or cost-bearing API calls. Do not merge/deploy without owner approval.


## In-app PWA admin preview (research iteration, 22 Nov 2026)
- Under Map & navigation, authorized admins now open a **full-screen in-app beta dialog**, not a full tab navigation. The classic map component and its live navigation state remain mounted behind the dialog; it is never reused in the experimental renderer.
- The dialog mounts the standalone `map-beta/` on demand, so simply opening Settings causes no MapLibre tile requests or new third-party scripts. On closing it, the iframe source is removed to stop network activity. The parent CSP permits only a same-origin iframe, keeping all other frame rules.
- The hosted preview's **Use classic map** control sends a same-origin, frame-source-verified close message when embedded; when opened directly, the link remains normal navigation. Escape and the PWA header button also close the modal. A Ride Safe lock closes it automatically.
- **Important security limitation:** this is a same-origin experimental iframe and not a privilege boundary. No staff or account data is sent to the preview, and MapLibre's CDN script must be reviewed/pinned or self-hosted before any production promotion.
- Native Android/iOS still launch the standalone preview externally. An actual in-app native renderer requires installing `@maplibre/maplibre-react-native` v11 with a synchronized npm lockfile, registering its Expo plugin (which changes iOS Podfile), native build test on Expo SDK 58, and dedicated renderer tests. Do not substitute generic OSRM car directions for motorcycle routing or mix Google directions/search with an OSM basemap. Source: https://maplibre.org/maplibre-react-native/docs/setup/expo/


## Central Auditor security/CI follow-up — 22 November 2026
- Prior CI `44965807941` failed 5 PWA visual tests (the embedded map return-link test on five device projects), with `GET /map-beta/` returning **404**. `scripts/build-pwa.mjs` omitted the beta directory from its public-file allowlist; copying it now fixes the real failure instead of extending Playwright timeouts. The prior run passed lint/typecheck/coverage and Android, while iOS was still running at diagnosis.
- The PWA iframe is now `sandbox="allow-scripts"` **without** `allow-same-origin`. This blocks access to parent DOM, cookies and localStorage. Child-to-parent messaging is a fixed close-only event; parent checks both iframe window identity and opaque origin `null`. The beta is destroyed on close, Ride Safe activation or sign-out; admin role is refreshed periodically and revoked/failed checks close the dialog.
- A CSP-compatible local classic `preview.bundle.js` is generated at PWA build time with esbuild from the preview's local ESM imports. An opaque-origin iframe cannot ordinarily load those imports via same-site module URLs without CORS headers. This build must verify output exists; no sandbox flag is relaxed to make it work.
- MapLibre GL JS version `6.3.0` is still pinned to unpkg and CSS to unpkg. **Residual supply-chain risk:** sandboxing protects the Rider Comms parent but does not validate third-party binary/code integrity; self-host a verified pinned MapLibre distribution, worker and styles before any wider release. No new paid data sources or unrestricted storage are added.
- Existing Google Directions, Routes and Places remain in their licensed classic system; no Google data is sent to the OSM/MapLibre demo. A public OSM style with a synthetic overlay cannot represent traffic, toll legality, motorcycle restrictions or routing accuracy.
- Native beta still opens a separate browser rather than the embedded PWA, because MapLibre Native + Expo plugin and real native parity are untested. Keep it explicitly map-only and non-navigation until this gap is closed.
- Research: OpenFreeMap publicly advertises free tile access and attribution, not a committed reliability SLA for our app; the OSM Foundation's tile services prohibit bulk/offline scraping. Valhalla has motorcycle and motor_scooter costing but UK road legality, road charge rules, access policies, performance, outage behavior and routing data updates require verification before deployment. Budget £0 for the demo does not guarantee £0 production operations.
- Security PR #562 and Tolls PR #566 overlap future PWA settings/auth and route options. Coordinate via review and avoid modifying either agent's branches. No merge or release authorized.


## Standalone beta hardening — Central Auditor high-priority finding (22 November 2026)
The initial `docs/map-beta/` was a direct top-level Rider Comms origin document executing third-party MapLibre CDN JavaScript. A parent iframe sandbox does **not** protect users who open that URL directly, including the native system-browser handoff.
- The **published** `/map-beta/` is now a first-party launcher with a small fixed inline handler whose SHA-256 CSP hash is calculated at build time. It never imports external JavaScript or CSS in its top-level document. The interactive MapLibre renderer is assembled at build time from local, checked-in `map-lab` inputs and run **only inside a nested `srcdoc` iframe** with `sandbox="allow-scripts"` and **no `allow-same-origin`**. Its bundled local script is inline and guarded by a second build-calculated SHA-256 CSP hash, enabling strict CSP without a same-origin ESM loading exception.
- The PWA's existing outer iframe stays sandboxed, so the PWA path uses **two opaque-origin frames**; direct URL and native browser path now use a first-party launcher and **one opaque-origin frame**. No live tokens, GPS, Google map layers, rider positions, group ride data or backend API values enter the renderer.
- The launcher has a small, fixed close-only `postMessage` handler to the PWA parent and is otherwise safe as a standalone static page. The PWA parent checks the exact iframe window, opaque `null` origin, and fixed message type. Esc/dismissal, focus restoration, Ride Safe, token switch and periodic staff role rechecks continue in the PWA dialog. There is still no true native in-app MapLibre view.
- The entire original map-lab HTML/CSS/preview implementation remains in the **unpublished** repository `map-lab/`; build output publishes **only** the safe launcher HTML. There is no separately navigable static map document which can execute the CDN on the Rider Comms origin.
- **Authentication caveat:** the static launcher and its public OSM geography are still directly accessible to anyone who has the URL. `GET /admin/me` restricts the in-app button, NOT the static page. Enforcing access to even the public preview requires an edge/server-side admin gate and/or a dedicated independently hosted preview origin; GitHub Pages cannot enforce a session check with hidden UI alone. Never place sensitive data in this static preview. A separate origin plus reviewed, self-hosted MapLibre scripts, worker and styles, restrictive response-header CSP and a proper access mechanism remain release gates.
- Dependency/license and routing constraints remain unchanged: MapLibre GL JS pinned version 6.3.0 loaded by the sandbox, OSM/OpenFreeMap attribution visible, free tiles without production SLA, no proprietary Google data mixing, and no verified motorcycle-aware navigation/tolls/traffic service. Future native parity requires explicit MapLibre React Native/Expo plugin and native build QA.
- This approach minimizes conflicts with Tolls PR #566 and Security PR #562 by leaving the Settings and API client implementation untouched. Security sign-off remains pending.


## CI keyboard ownership regression (22 November 2026)
- Run `44968954902` on `a2c7963`: 799 visual tests passed, 5 failed, 26 skipped. The five failures were the same Escape regression on phone small/modern, iPhone WebKit, tablet, landscape. Global Settings `keydown` in `docs/app/18-map-init-events.js` prevented Escape's default action and invoked `sheetBack()` while the nested native `<dialog>` remained open.
- Fix: the Settings sheet handler yields **both Escape and Tab** while `#riderMapBetaDialog.open`; the dialog itself handles Escape and native `cancel` through the same `close()` path. `close` removes frame navigation, clears both timers, detaches the opaque message and storage listeners, removes the dialog, and focuses the original beta trigger when still connected.
- Cross-origin frames cannot bubble keydown into the PWA. Escape in the isolated renderer is reduced to a fixed close signal to the first-party standalone launcher; the launcher only accepts messages from its exact nested iframe window with opaque origin `null` and forwards close-only to the PWA parent, which validates its own exact outer iframe window. No new permissions are granted; `allow-same-origin` remains absent.
- Cross-tab `storage` changes for `SESSION_KEY` now force closure in addition to the existing 1s in-memory session check and 30s admin-role recheck. Movement lock continues to force closure; role recheck fails closed.
- Regression coverage: original failing test **retained**, plus repeated explicit close, keyboard focus containment, Escape in outer and nested frames, Ride Safe forced close, cross-tab session change, and periodic role revocation. The existing embedded return link and non-admin/permission-revocation tests remain intact. All tests are required to pass on the proposed exact head before merge.
- No changes to `mobile/src/api/client.ts`, Tolls feature structure or legacy Google/Apple navigation. Shared `docs/app.js` must be rebuilt from its source modules; Security #562 and Tolls #566 remain cross-PR integration gates.


## Research-only Valhalla motorcycle request boundary (22 November 2026)
- New pure `map-lab/valhalla-request.mjs` constructs a bounded JSON **draft** for a future independently hosted Valhalla router. It contains no fetch, endpoint, rider-session, live GPS or API key code; `VALHALLA_MOTORCYCLE_ROUTING_ENABLED=false`. The preview and released PWA/native apps **do not import it**.
- Rider Comms vehicle categories `motorcycle_large` and `motorcycle_small` select Valhalla `motorcycle` costing. The ambiguous `scooter` category selects `motor_scooter` only after an explicit 20–120 km/h top-speed confirmation; silently accepting its 45 km/h default would give inappropriate results for many larger scooters. Cars and unspecified vehicles fail closed.
- A maximum of eight validated, cloned WGS84 coordinates uses Rider Comms [longitude, latitude] input and Valhalla {lat, lon} output; unknown fields, malformed inputs and Google/toll-exemption metadata are rejected. `avoidHighways`, `avoidTolls`, and `avoidFerries` map only to Valhalla soft cost preferences (`use_highways`, `use_tolls`, `use_ferry` 0); **they cannot guarantee avoidance** and are not legal driving guidance.
- Every draft explicitly has `legalRoadAccessVerified=false`, `tollExemptionVerified=false`, `trafficAvailable=false`, `navigationReady=false` and `networkRequestMade=false`. A provisional UK licence, motorcycle size, speed and legally permitted road access must be verified through independent data before route navigation. Do not silently equate scooter styling with motorway eligibility.
- Guarded with offline Node assertions in `scripts/check-rider-maps.mjs` (including invalid vehicle/coordinates/flags and no Google or paid service mixing). Official API field documentation: https://valhalla.github.io/valhalla/api/route/api-reference/
- **Remaining gates:** source/versioned regional OSM graph; verify UK motorcycle access and driving licences; independent routing endpoint with user privacy and cost controls; directions/ETA/reroute validation; real-device 1:1 PWA/native QA; explicit product and legal approval before any network calls.
