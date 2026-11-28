# Tolls ↔ Maps integration gate — proposed v1, not approved

**Status:** Draft research and test checklist only. Staged in the independent Tolls
development branch; **not** a signed-off shared interface, deployed adapter,
production routing service, legal charge feed, or permission to merge PR #566
with Maps PR #572. Both release flags remain off.

## Ownership and invariants

- **Maps #572 owns** the pinned OSM source, Valhalla build and graph identity;
  vehicle-specific path legality, directed-edge traversal, timing/alternatives,
  GPS matching, bus-lane legality and navigation UI. It may not infer legal
  charging permissions or bus-lane exemptions from ordinary OSM road tags.
- **Tolls #566 owns** charging authorities, scheme scope, source/transform
  provenance, zone-level charge road correspondence, calendar exceptions,
  entitlement verification and conservative exposure assessment.
- **Both** keep any incomplete, stale, conflicting or missing evidence as
  **unknown**. A user-declared exemption never becomes operator-verified. A
  charging waiver is never a bus-lane permission. No polygon contact, OSM
  `toll=yes` flag, generic motorway direction or a visual map tile provides
  an authoritative charging-rule or zero-fee conclusion.
- **No route-wide no-charge verdict** from the current Tolls engine. Its
  single-event `consistent` result means only that one supplied synthetic
  observation remained unchanged over a bounded ETA interval. Every aggregate
  forces `routeCoverageComplete:false`, `needsVerification:true` and
  `productionApproved:false`.

## Fields to agree before coding an adapter

These are **requirements to review**, not implemented or approved TypeScript
structures. Record explicit schema version, issuer/source, effective interval
and stable meaning for every field.

| Layer | Required evidence or identity | Must be rejected when |
| --- | --- | --- |
| Source | SHA-256 of the exact OSM regional PBF, download time, licence/attribution, region/extent | hash, rights or geographic extent missing |
| Graph | **Distinct** Valhalla build/content checksum, costing profile version, graph build settings, edge-ID namespace | edge IDs from a different build are reused |
| Route snapshot | route ID, monotonic revision, alternative/leg IDs, vehicle class, generation time | graph/vehicle/route revision changes without reassessment |
| Road observation | unique event/occurrence ID, directed edge ID and direction, layer/bridge/tunnel, operator-road match version and confidence | approximate coordinate/polygon overlap substituted for graph correspondence |
| Time | offset-bearing earliest, predicted, latest UTC instants for this **occurrence**, not journey departure; observations ordered by nondecreasing **actual UTC predicted instants** | wrong ordering (including textually misleading offsets), missing offset, bound exceeds 120 min, DST/charge-window conflict |
| Charge evidence | authority and scheme/zone ID, exact charging unit, current regulation, exceptions reviewed-through, official rule source and rights | conflicting zone/operator, missing licence/review or stale evidence |
| Entitlement | verified issuing operator, exact vehicle/registration identity where applicable, scheme/zone, validity and review time | solely user-declared, expired, wrong vehicle or wrong CAZ |
| Coverage | defined set of legally reviewed charge mechanisms and all traversed road occurrences, including unobserved sections | claimed whole-route or charge-free result from partial source coverage |

**Vehicle mapping:** Maps may distinguish `motorcycle`, `motor_scooter`, moped
and other UK classes; the current Tolls engine models only `motorcycle`,
`car`, `van`, `heavy` and `other`. Do **not** silently treat a moped,
e-scooter or provisional vehicle classification as the same legal charge class.
Agree jurisdiction-specific mapping with versioned tests first. This issue is
separate from any bus-lane legal access determination.

## Required invalidation and routing behaviour

1. A new route or reroute creates a new plan revision. Cached charging results
   from the old route are discarded, not spliced or averaged.
2. A graph rebuild invalidates all previously reviewed directed-edge/charging
   correspondences unless they are independently revalidated against the new
   graph digest, vehicle profile and direction.
3. Changing vehicle classification, route alternative, crossing occurrence,
   regulation version, entitlement or a source-review snapshot forces a new
   assessment. Do not store a mutable cached `verified_exempt` flag.
4. Exact predicted passage time is insufficient when uncertainty can span an
   operating window, UK midnight or daylight-saving change. The staged
   `assessChargePassageWindow` treats differing outcomes as unknown and never
   claims whole-route coverage.
5. A crossing with reliable operator evidence may indicate possible exposure,
   not a price quote or automatic payment. Unknown event count must remain
   visible to any future comparison UI and prevent a “free route” recommendation.
6. Lane access and charge exposure are **two independent outputs**. An
   exemption can never change road traversal permissions, and lane arrows
   cannot independently validate charge calculations.

## Verification milestones, in order

- **Offline unit layer:** real `chargingRules.ts` and freshness policies,
  bounded ETA uncertainty, both UK clock changes, charging exceptions, CAZ
  identity, out-of-scope vehicle, declaration vs verified entitlement, and
  independent crossing/day deduplication. All examples must be synthetic.
- **Offline graph fixture layer:** one immutable small graph + pinned snapshot,
  directions, bridges/tunnels, repeated edges, distinct alternatives, partial
  graph coverage, graph rebuild and mismatched schema/vehicle. No live GPS.
- **Data-rights layer:** official charging operator review and licence checks,
  reproducible source and output hashes, effective dates, graph-road match
  audit, publisher authenticity and credible freshness/monitoring process.
  A valid SHA-256 alone proves bytes match a manifest, not publisher or law.
- **Product isolation layer:** PWA and native same unknown/not-on-route/possible
  labels; no invented fee, false green “no charge”, paid endpoint or automatic
  personal-data lookup. Existing Rider Comms/Google/Waze/Apple provider choices,
  Ride Safe and classic navigation remain unchanged.
- **Release verification:** full exact-head CI, isolated security, iOS/Android,
  accessible PWA visual audit, installed iPhone and Android physical testing,
  partner team review and explicit owner authorisation. A bot-generated
  `action_required` zero-job run is not an executed test; check actual same-SHA
  `workflow_dispatch` result and treat deferred native as **not verified**.

## Development controls

During parallel main/Maps work, PR #566 stays draft, the PWA/native charging
release toggles stay false and the staged unit code can advance separately.
Do not purchase, provision or assume a production service is £0. Final native
verification should occur on the **exact integration head**, after other
shared-source changes stabilise; never report a previous head's green checks
as proof of a newer head.

## Continuous driving within daily zones

A zone entry is not enough: a vehicle driven inside a daily zone across London midnight or into operating hours may incur additional exposure without crossing the boundary. See TfL https://tfl.gov.uk/modes/driving/ultra-low-emission-zone/cars . The new disconnected research helper `dailyDrivingInterval.ts` samples an exact half-open continuous-driving interval (maximum two hours); no parking inference, ETA uncertainty claim, or verified entitlement. It is not wired to the existing crossing summary. Future route coverage must deduplicate by scheme/zone/date across interval observations and crossing events. Scooters and mopeds are withheld from the coarse charge preview until scheme-specific class evidence is available, matching the Maps identity handoff. 
