# Map rendering baseline

Rider Comms should feel familiar to someone who already uses a mainstream map app. The map provider owns the basemap; Rider Comms owns the rider-specific information layered above it.

## Basemap

- **PWA:** Google Maps JavaScript API `roadmap` with `FOLLOW_SYSTEM` colour scheme.
- **Native Android:** the standard road map supplied by Google Maps through `react-native-maps`.
- **Native iOS:** the standard MapKit road map until a production Google Maps iOS key/provider is deliberately configured.

The iOS/Android provider difference is an implementation detail allowed by the client-parity contract. Search, destinations, hazards, live ride locations, route overlays, navigation state, permissions and safety behaviour must remain equivalent.

Do not add a global tint, brightness filter, satellite-only presentation or a second hand-authored basemap theme merely to make screenshots resemble a concept image. If a future branded basemap is needed, prefer provider-supported cloud styling and document the platform configuration.

## Rider Comms overlay

Rider Comms may layer only product-specific controls and data above the provider map:

- place search
- current location and recentering
- road-hazard reporting and hazard markers
- Nearby Voice/location visibility
- private-ride member locations
- selected destinations
- route polylines and turn guidance
- Ride Safe status

Map controls should remain large enough for stationary/gloved interaction and visually distinct from map labels, while preserving the provider's map readability and attribution.
