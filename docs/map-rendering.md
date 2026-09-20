# Map rendering baseline

Rider Comms should feel familiar to someone who already uses a mainstream map app. The map provider owns the basemap; Rider Comms owns the rider-specific information layered above it.

## Basemap

- **PWA:** Google Maps JavaScript API `roadmap` with `FOLLOW_SYSTEM` colour scheme.
- **Native Android:** the standard road map supplied by Google Maps through `react-native-maps`.
- **Native iOS:** the standard MapKit road map until a production Google Maps iOS key/provider is deliberately configured.

The iOS/Android provider difference is an implementation detail allowed by the client-parity contract. Search, destinations, hazards, live ride locations, route overlays, navigation state, permissions and safety behaviour must remain equivalent.

Do not add a global tint, brightness filter, satellite-only presentation or a second hand-authored basemap theme merely to make screenshots resemble a concept image. If a future branded basemap is needed, prefer provider-supported cloud styling and document the platform configuration.

## Navigation camera and rider identity

Dedicated in-app navigation keeps the provider basemap but changes the camera, not the map artwork. The PWA uses Google Maps' vector renderer with heading/tilt enabled; native uses the provider camera exposed through `react-native-maps`. Both clients use the same adaptive navigation-camera model: close urban riding is tighter, faster travel exposes more road ahead, ordinary turns progressively tighten, and roundabouts/U-turns/forks pull back and flatten enough to understand the junction geometry.

The camera target follows the routed step polylines rather than a straight chord to the maneuver endpoint. Current, upcoming and following step geometry can contribute to look-ahead so the view can reveal the road after a turn. Low-speed heading is stabilised to avoid compass-noise rotation, while moving fixes blend toward the device heading. Camera forward bias also accounts for the top maneuver card and bottom ETA sheet so the rider remains low in the usable map viewport rather than mathematically centred behind those overlays.

Camera changes must transition rather than snap between GPS fixes. Native uses `react-native-maps` camera animation; the PWA eases Google Maps vector-camera updates through a short `requestAnimationFrame` transition because Maps JS `moveCamera()` itself is immediate. New GPS fixes cancel and retarget the in-flight transition, while user pan, route overview and navigation exit cancel it entirely. Reduced-motion users receive immediate camera changes. Provider SDKs may clamp pitch/zoom differently, but the requested behavior and decision thresholds remain aligned across PWA/native.

The current rider's persisted avatar remains their self marker during navigation. Do not replace it with a generic navigation chevron. The provider map rotates underneath the screen-upright avatar in follow mode, while authorised private-ride member avatars continue to render from their own persisted `avatarId` values.

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
