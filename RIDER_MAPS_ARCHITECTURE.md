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
