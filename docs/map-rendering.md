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

The current rider's persisted avatar remains their self marker during navigation. Do not replace it with a generic navigation chevron. In dedicated navigation the self marker becomes a larger, centred, tail-free avatar so it reads more like a vehicle/avatar on the road than a generic map pin. The provider map rotates underneath the screen-upright avatar in follow mode, while authorised private-ride member avatars continue to render from their own persisted `avatarId` values.

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

On phone layouts, map controls use one compact right-side cluster rather than scattering actions across the viewport. Report, Re-centre and Go live share the same 48 × 48 rounded-square geometry and spacing; individual controls must not be shifted with viewport-relative transforms or enlarged into a separate visual hierarchy. When a destination is selected, that general map-control cluster is hidden so the destination card and Start route action become the single task focus. During dedicated navigation the redundant standalone Re-centre control is hidden/omitted: the route overview control becomes the single follow-mode return action after a pan, alongside Report and Mute. PWA and native should preserve this same control hierarchy and geometry.

## Glanceable turn guidance

Turn-by-turn guidance must communicate the road decision visually before requiring the rider to read the instruction. PWA and native therefore preserve distinct maneuver geometry for slight turns, ordinary turns, sharp turns, U-turns, forks, ramps, merges, roundabouts and arrival instead of rotating or reusing one generic arrow for several different decisions. The upcoming maneuver is the dominant visual in the top card; it is integrated directly into the dark guidance surface rather than placed inside a second nested tile, while the maneuver after it uses the same icon language at a smaller scale in the **Then** row. The visual copy is deliberately compressed into a short action ("Turn left", "Bear right", "Go straight"), an optional route-number badge and a single road-name line. Full provider wording is retained for spoken/accessibility guidance but is not rendered as a paragraph that a moving rider has to read. This keeps the visual hierarchy closer to mature navigation apps without copying provider branding.

The bottom navigation summary also shows the rider's **current GPS-derived speed** while a route is active. This is a live movement reading only. It is not a posted speed limit and must never be styled or labelled in a way that implies legal road-speed data when Rider Comms does not have an authoritative speed-limit feed.

Lane guidance has a stricter data requirement. Rider Comms must only display recommended lanes when the active route provider supplies authoritative lane-level guidance for that step. The current parsed route-step contract contains instruction, maneuver, distance, duration and geometry but no lane array, so the clients must not infer a required lane from instruction text or road geometry. If a lane-capable provider is added later, the lane model and UI must land on PWA and native together under the same parity contract.

A routed destination must remain visually identifiable on the map for the full navigation session, including route-overview mode. PWA and native use a dedicated finish/checkered-flag marker at the active route destination and remove it when navigation ends. This is separate from the temporary destination-selection pin used before a route starts.
