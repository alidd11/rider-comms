# Rider Comms Maps — offline route acceptance

**Research-only, draft PR #572. No public server, live navigation, rider GPS,
Google route data, charging or legal-access claims.** This checks a local
Valhalla graph against car, motorcycle, moped and scooter route responses
without exposing any HTTP endpoint.

## Prepare a real graph

Follow [LOCAL_GRAPH_BUILD.md](./LOCAL_GRAPH_BUILD.md) first, using a real
dated [Geofabrik Greater London OSM extract](https://download.geofabrik.de/europe/united-kingdom/england/greater-london/index.html),
SHA-256 computed from the local PBF bytes, and independently vetted
Valhalla build binaries. Keep the PBF and graph outside Git.

The generated graph directory needs:
- `graph-manifest.json` with exact source PBF, Valhalla version, tooling,
  config and graph-tile fingerprint identities;
- `valhalla.json` with the isolated `mjolnir.tile_dir`;
- `valhalla_tiles/**/*.gph`, whose bytes this runner re-hashes;
- a locally installed and checksum-pinned `valhalla_service` executable.

Valhalla's [documented one-shot mode](https://github.com/valhalla/valhalla#valhalla_service-aka-one-shot-mode)
runs `valhalla_service valhalla.json route '{...}'` locally: logs go to stderr,
the route JSON to stdout. The runner does not download maps, start HTTP
servers, call public demo routing APIs, or handle live rider locations.
The graph configuration must use only the hashed directory: alternate tile archives, remote tile/elevation URLs, incident or traffic sources and untracked compressed graph tiles are rejected. This is not an OS network sandbox.

Binary checksum pinning does not authenticate the vendor or dynamic
libraries, and this second-stage runner does not reopen the original PBF.
The operator must verify those separately.

## Vehicle acceptance suite

Save a JSON file `/absolute/path/to/local-routes.json` **outside the repo**.
Replace all absolute paths and SHA placeholders with actual measured values.
Example coordinates are publicly known London waypoints, **not pre-validated
routing directions**. Choose genuine road test points inside the graph polygon
before interpreting a real route run.

```json
{
  "schemaVersion": 1,
  "graphDir": "/absolute/path/to/generated-graph",
  "service": {
    "path": "/absolute/path/to/valhalla_service",
    "sha256": "REPLACE_WITH_REAL_64_CHARACTER_SHA256"
  },
  "cases": [
    {"id":"car-central","vehicleCategory":"car","coordinates":[[-0.1276,51.5072],[-0.12,51.51]]},
    {"id":"motorcycle-central","vehicleCategory":"motorcycle_large","coordinates":[[-0.13,51.51],[-0.118,51.515]]},
    {"id":"moped-central","vehicleCategory":"moped","scooterTopSpeedKph":45,"avoidHighways":true,"coordinates":[[-0.12,51.52],[-0.11,51.525]]},
    {"id":"scooter-central","vehicleCategory":"scooter","scooterTopSpeedKph":65,"coordinates":[[-0.11,51.525],[-0.10,51.53]]}
  ]
}
```

First perform the safe, read-only graph/binary/checksum validation:

```bash
node scripts/verify-local-valhalla-routes.mjs --validate /absolute/path/to/local-routes.json
```

Then explicitly compute local routes via the one-shot executable:

```bash
node scripts/verify-local-valhalla-routes.mjs --run /absolute/path/to/local-routes.json
```

The input contract requires all four vehicle families, a declared top speed
for mopeds/scooters, only bounded WGS84 route points within the declared
region, and rejects unexpected traffic, Google Places or toll-exemption data.
The code rechecks tile/config/service hashes before each run, verifies route
shape with the existing polyline6 Valhalla adapter, checks distance/duration
and that start/end are within 1.5 km of their requested test points.

Results intentionally omit journey coordinates and **always** include
`navigationReady: false`, `roadRestrictionComplianceVerified: false`,
`motorwayEligibilityVerified: false`, `laneAccessVerified: false`,
`tollExemptionVerified: false` and `trafficAvailable: false`.
Valhalla's highway/toll/ferry avoidance flags are **soft preferences**,
not proof of safe or charge-free travel. A plausible response does not
prove a physical vehicle may legally use every directed road edge.

## Deterministic regression and remaining proof

`node scripts/check-local-valhalla-routes.mjs` runs automatically under
`npm run lint` via the Maps checker. Its tools and graph are **synthetic
stand-ins, not real roads or authentic Valhalla binaries**. The tests check
cars/motorcycles/mopeds/scooters, wrong graph identities, corrupted tiles,
mismatched config/executable hashes, symlinks, route tampering, bad metrics
and implausible endpoints.

A production routing release still requires a genuine pinned PBF, independently
verified Valhalla build and routable test responses, region-edge buffer checks,
official UK vehicle and motorway restrictions, directed one-way/turn rules,
permitted bus-lane signage/TRO evidence, rerouting, alternatives, physical
device tests, accessibility, licence review and PWA/native parity. The
separate Tolls #566 workstream owns charging exemptions; do not infer them
here. Keep `RIDER_MAPS_RELEASED` and `RIDER_LANE_GUIDANCE_RELEASED` false.
