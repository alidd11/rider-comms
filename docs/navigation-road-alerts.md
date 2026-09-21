# Navigation road-ahead alerts

Rider Comms navigation may surface approaching road information only when the app has a real source for it. The navigation header must never infer cameras, traffic lights, lane guidance or posted speed limits from road geometry, instruction text or map artwork.

## Available data today

The shared Rider Comms hazard service currently supplies these crowdsourced report types to both PWA and native:

- speed camera
- police
- accident
- road hazard
- road closure

These are rider reports, not authoritative infrastructure records. Navigation copy must preserve that provenance (for example, **Speed camera reported**) rather than presenting a report as a guaranteed fixed camera or police location.

Google traffic rendering may continue to colour the provider map during navigation, but it is a visual basemap layer. Rider Comms does not receive structured traffic incidents from that layer and must not turn map colouring into invented road-ahead events.

## Route matching

A nearby report is eligible for the navigation header only when all of the following are true:

- the rider has a live platform-reported position with accuracy of 75 m or better
- that reliable position is close to the active route
- the report is within 70 m of the active route geometry
- the report is ahead of the rider according to remaining routed distance
- it is no more than 3 km ahead
- it has not been passed by more than the small GPS/projection grace distance
- it has not expired while waiting for the next feed refresh
- it has not reached the shared crowd-hide threshold
- its report type is one Rider Comms explicitly understands
- it is one of the two nearest eligible reports

Distance ahead is computed from progress along the route polyline, not straight-line distance. This prevents a report on a nearby parallel street, a road behind the rider or the far side of a loop from being surfaced merely because it is geographically close.

While the current fix is more than 120 m from the active route, road-ahead reports are suppressed until routing/GPS state is reconciled.

Road-ahead guidance is also hidden whenever the navigation GPS health layer marks the live fix as stale, unavailable or permission-denied. The last cached coordinate may remain on screen for continuity, but Rider Comms does not use that stale fix as authoritative input for approaching-report guidance.

The 75 m accuracy check uses the operating system/browser's reported horizontal accuracy directly. Rider Comms does not sharpen, infer or manufacture a more precise position.

## Presentation contract

The active maneuver remains the first visual priority. The existing **Then** row remains the second maneuver preview. When eligible reports exist, a compact **Reports ahead** strip sits below turn guidance and shows no more than two events.

The nearest eligible report always keeps the first glance slot. If that nearest report is a camera or police report and a road closure, accident or road hazard is also ahead, the second slot is reserved for the nearest safety-impacting report rather than allowing two enforcement reports to hide it.

Each event uses the same hazard icon language as the map, an explicit reported label and routed distance ahead. The corresponding hazard marker remains visible on the route so the header alert has spatial context.

Do not continuously announce changing alert distances through an accessibility live region or voice guidance. A future audio-warning policy can be added separately with de-duplication and user preference controls.

## Data not available in the current parity-safe architecture

Rider Comms currently routes through Google Directions / provider map SDKs rather than a shared Navigation SDK event feed. Therefore the product must not currently display these as structured road-ahead facts:

- traffic-light locations
- stop-sign locations
- authoritative posted speed limits
- Google/Waze camera or police reports
- recommended lanes

If a provider later exposes one of these through a data source usable by both PWA and native, it should enter the same road-event model and ship to both clients together.


## Refresh cadence

The report feed refreshes once per minute on both PWA and native. Navigation position can update much more frequently, but those GPS fixes only recalculate route-relative distance against the already loaded reports; they do not trigger a new hazard API request. This keeps the warning distance responsive without coupling backend traffic to the navigation GPS sampling rate.

The route-ahead selector also re-checks each cached report's expiry and crowd-hide state on every render. A report can therefore disappear from guidance immediately when it becomes invalid, without waiting for the next one-minute network refresh.
