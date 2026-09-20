# Map/Home photographic rendering

The live Map uses Google's `satellite` type in the PWA and native clients. The
previous `hybrid` type painted a dense Google label and road overlay that did
not respond to the embedded JSON style rules. Google's Android Maps SDK only
supports embedded styling on the `normal` map type; keeping `hybrid` while
adjusting styles could not reliably remove the clutter on a real device.

Satellite keeps real, interactive Google imagery, live location, hazards,
places, rider markers, route overlays, recentering and navigation intact. The
PWA tones the map with a CSS filter; native applies a non-interactive tint.
The current search and control chrome remains above the map on both clients.

**Visual limit:** Satellite does not supply the selective lake/town and major
road labels shown in the mockup. Hybrid supplies those labels together with
unwanted local road and business labels. The map also depicts the rider's real
location, so its terrain cannot reproduce the mockup's Queenstown geography
while the rider is in London. Google imagery, attribution and map tiles can
change independently of Rider Comms.

Google reference: https://developers.google.com/maps/documentation/android-sdk/styling
