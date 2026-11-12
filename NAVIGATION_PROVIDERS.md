# Navigation providers: what we use, what exists, what we recommend

Researched November 2026 from providers' own documentation (sources at the
end). Prices and terms change; check the linked pages before committing.

## What Rider Comms does today

| Part | Native app | Web app |
| --- | --- | --- |
| Base map | `react-native-maps`, default provider: Apple Maps on iOS, Google Maps on Android | Google Maps JavaScript API |
| Place search | Backend proxy to Google Places (New) (`backend/src/placesProvider.ts`): Autocomplete while typing, in a session that ends with one Place Details call for the pick; Nearby Search for category chips | Google Places (legacy `AutocompleteService`, `PlacesService`) |
| Routes | Backend proxy to the Google Directions API (`backend/src/directionsProvider.ts`) | The same backend proxy |
| Guidance | Our own: route progress, snapping, rerouting, spoken prompts, camera, puck (`mobile/src/screens/useInAppNavigation.ts`, `shared/src/navigationGuidance.ts`, `shared/src/navigationCamera.ts`, `navigationRoadEvents`, `positionInterpolation`) | The same shared logic (`docs/navigation-*.js`) |
| Hand-off | Google Maps, Waze, Apple Maps links (`mobile/src/navigationLinks.ts`) | The same links (`docs/app/15-destination.js`) |

Google computes the route: its geometry, steps, maneuvers, distance and
traffic-aware duration. Our own code covers what happens on the road:
- following progress along the route
- deciding when to speak
- moving the camera
- drawing the puck
- asking for a new route when the rider leaves it

None of it invents lane guidance, speed limits or traffic.

## What the providers actually offer

| Provider | Embeddable guidance engine? | React Native | Custom puck and overlays | Cost | Notes |
| --- | --- | --- | --- | --- | --- |
| **Google Navigation SDK** (Android, iOS) | Yes: routing, map matching, rerouting, voice, ETA, arrival | Official `@googlemaps/react-native-navigation-sdk`, **beta** (pre-1.0). Tested on RN 0.87 with the new architecture; needs iOS 17+ and an Expo config plugin with prebuild | Header, footer, buttons, map style and night mode are configurable. Markers, polylines and overlays can be added. **The README does not document a custom location puck or vehicle icon** | Per destination: first 1,000 a month free, then $25 down to $2 per 1,000 by volume. Rerouting and traffic updates are not charged extra | **Terms:** commercial use only, and the rider must accept Google's navigation terms in-app before first use. **Map use:** the content must not be shown on a non-Google map, so guidance would run in Google's own navigation view, not our Apple Maps base on iOS. **Support:** GitHub issues, with no SLA |
| **Apple MapKit** | **No.** `MKDirections` returns routes, but there is no guidance engine. Turn-by-turn means handing off to Apple Maps | — | — | Free | We already hand off to Apple Maps |
| **Waze** | **No.** Deep links open the Waze app. The Transport SDK is for professional-driver partners and does not embed Waze's map or navigation | — | — | Deep links are free; the SDK is partner-only | We already hand off to Waze |
| **Mapbox Navigation SDK v3** | Yes, native Android and iOS | No official React Native SDK; only community wrappers | Custom location puck documented | Metered: $0.30 per monthly user plus about $0.08 per trip, after a free tier. Free-drive trips are billed separately | Would also mean moving the base map and search to Mapbox |

## Recommendation

**Keep the current engine for the beta, and don't migrate now.** The reasons:

1. **The only embeddable option that fits our stack, Google's, isn't ready
   for us.**
   - Its React Native wrapper is beta and pinned ahead of our React Native
     version.
   - It would replace our map during guidance, and its documentation doesn't
     offer our motorcycle puck.
   - It adds an in-app terms prompt and per-destination billing.
   - Our rider overlays (group riders, hazards, Nearby, Ride Safe HUD) would
     have to be rebuilt on its map controller.
2. **Apple and Waze can't be embedded.** Handing off to them, as we do
   already, is the supported route.
3. **The hard part is already a provider's job.** Google computes the route
   itself, including traffic-aware duration. Our code is the on-road layer,
   which is covered by shared tests and parity checks in both apps.

**Do next (P1, owner sign-off on billing):** move route requests from the
Directions API, which Google moved to Legacy on 1 March 2025 (existing
projects keep working, with no shutdown date announced), to the **Routes
API** (`computeRoutes`). It is Google's
supported successor, can return traffic-aware routes and route tokens, and is
a backend-only change behind `directionsProvider.ts`. It needs the Routes API
enabled on the project's key, which is an owner action.

**Revisit (P3):** pilot the Google Navigation SDK on one platform once its
React Native wrapper reaches 1.0, supports our React Native version, and lets
us keep a custom puck. Measure it against today's guidance on real rides
before deciding.

## What would change if we migrated to the Google Navigation SDK

- **Gained:** Google's own map matching, rerouting, voice timing, lane
  guidance where Google has it, speed limits where Google has them,
  traffic-aware ETA and arrival detection, and CarPlay and Android Auto
  support.
- **Lost or to rebuild:**
  - our custom puck and camera behaviour
  - the Ride Safe HUD layout over guidance
  - group-ride and Nearby overlays during navigation
  - the Apple Maps base map on iOS during guidance
  - one shared engine between native and web (the web app has no Navigation
    SDK, so it would keep our engine either way)
- **New dependencies:**
  - billing per destination
  - an in-app terms prompt
  - iOS 17 as the minimum
  - React Native new-architecture requirements
  - Kotlin Gradle Plugin overrides

## Sources

- [Google Navigation SDK, React Native (GitHub)](https://github.com/googlemaps/react-native-navigation-sdk)
- [Navigation SDK usage and billing](https://developers.google.com/maps/documentation/navigation/android-sdk/pricing), [core pricing list](https://developers.google.com/maps/billing-and-pricing/pricing)
- [Navigation SDK policies (Android)](https://developers.google.com/maps/documentation/navigation/android-sdk/policies), [(iOS)](https://developers.google.com/maps/documentation/navigation/ios-sdk/policies), [Service Specific Terms](https://cloud.google.com/maps-platform/terms/maps-service-terms)
- [Apple developer forums: turn-by-turn through Maps](https://developer.apple.com/forums/thread/729053), [Providing Directions](https://developer.apple.com/library/ios/documentation/UserExperience/Conceptual/LocationAwarenessPG/ProvidingDirections/ProvidingDirections.html)
- [Waze Deep Links](https://developers.google.com/waze/api), [Waze Transport SDK](https://developers.google.com/waze/intro-transport)
- [Google Maps legacy products](https://developers.google.com/maps/legacy), [Migrate from Directions API to Routes API](https://developers.google.com/maps/documentation/routes/migrate-routes), [Places JavaScript migration](https://developers.google.com/maps/documentation/javascript/places-migration-overview)
- [Mapbox Navigation SDK pricing](https://docs.mapbox.com/ios/navigation/guides/pricing), [custom location indicator](https://docs.mapbox.com/ios/navigation/v2/examples/custom-location-indicator.md)
