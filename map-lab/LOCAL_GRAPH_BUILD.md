# Offline Rider Comms Maps — local Valhalla graph research

**Research only. No navigation release, live route service, hosted infrastructure, rider GPS, or paid API.**
Build tools operate on local files that an operator has obtained and independently verified. No
PBF or graph assets are stored in this Git repository.

## Prerequisites

- Node 22 or newer.
- A locally installed, known-version Valhalla with the commands valhalla_build_config and
  valhalla_build_tiles, and enough disk space/RAM for a UK regional extract.
- A local dated OSM PBF supplied by Geofabrik under ODbL 1.0.
- A new, unused output-directory name whose parent directory already exists.
- No API keys or public demonstration routing servers.

A dated example London extract available from Geofabrik on 23 November 2026 was
https://download.geofabrik.de/europe/united-kingdom/england/greater-london/greater-london-261122.osm.pbf .
Use the regional listing to select the actual extract you retrieve, record the exact
download UTC time and source URL, and calculate SHA-256 **from the local bytes**.
A moving -latest URL is not an immutable source snapshot; keeping a local copy
and SHA-256 is mandatory. Do not invent the checksum or assume the example is current.

Sources:
- https://download.geofabrik.de/europe/united-kingdom/england/greater-london/index.html
- https://valhalla.github.io/valhalla/mjolnir/getting_started_guide/
- https://valhalla.github.io/valhalla/building/
- https://www.openstreetmap.org/copyright

## Prepare a local build specification

Calculate real SHA-256 hashes for the PBF **and the exact executable files**; e.g.
on macOS use shasum -a 256 and on Linux sha256sum. If tool paths are symlinks,
copy the vetted executable to a regular local file first; this utility deliberately
rejects symlinked inputs. The Valhalla version is additionally an operator-declared
label; the executable checksums, not that label, are the identity evidence.

Create a JSON specification outside this Git repository. Replace every placeholder
with actual absolute local paths and real 64-character SHA-256 values.

    {
      "pbf": {
        "path": "/absolute/path/to/greater-london-261122.osm.pbf",
        "sourceUrl": "https://download.geofabrik.de/europe/united-kingdom/england/greater-london/greater-london-261122.osm.pbf",
        "sha256": "REPLACE_WITH_REAL_64_CHAR_SHA256",
        "downloadedAtUtc": "2026-11-23T12:00:00Z",
        "license": "ODbL-1.0"
      },
      "tools": {
        "version": "REPLACE_WITH_ACTUAL_VALHALLA_VERSION",
        "config": {
          "path": "/absolute/path/to/valhalla_build_config",
          "sha256": "REPLACE_WITH_REAL_64_CHAR_SHA256"
        },
        "buildTiles": {
          "path": "/absolute/path/to/valhalla_build_tiles",
          "sha256": "REPLACE_WITH_REAL_64_CHAR_SHA256"
        }
      },
      "region": { "name": "Greater London", "bounds": [-0.52, 51.26, 0.34, 51.71] },
      "profileRevision": "uk-research-1",
      "outputDir": "/absolute/existing/parent/new-graph-build"
    }

The approximate region bounds in this **example** are metadata placeholders, not
an exact certified polygon or a geographic coverage proof. Replace with validated
region extents before producing any real route assessment.

Run the validation-only step first:

    node scripts/build-local-map-graph.mjs --plan /absolute/path/to/local-graph.json

Then explicitly initiate the local build:

    node scripts/build-local-map-graph.mjs --build /absolute/path/to/local-graph.json

The research builder explicitly disables alternate tile and traffic archives; the verifier rejects remote tile/elevation URLs, incident sources and untracked compressed graph tiles. Existing manifests with a configured tile archive must be rebuilt in a fresh output directory. This is configuration isolation, not an OS network sandbox or a guarantee about the executable's behaviour.

The second command runs the two checksum-pinned binaries directly, without a shell,
uses an isolated output path, and writes valhalla.json, Valhalla .gph tiles and
graph-manifest.json. If tools fail, the partial output directory is deliberately
left for inspection. Use a **new output directory** for any retry. Never mistake
an existing or partial build for a successful one.

## What the manifest proves — and does not prove

The output records the actual PBF/checksum, Valhalla executable hashes, generated
config hash, profile revision, sorted .gph tile content checksum and graph-build
checksum. This helps detect stale graph associations and supports future route
provenance contracts. Neither a hash nor the presence of .gph files proves
road restrictions, valid routable coverage, correct car/motorcycle/scooter costing
or a safe journey.

The builder does not currently generate timezone/admin databases, route maneuvers,
snap-to-road/traversal identity, independent road-sign/TRO evidence, local road-charge
analyses or route-response tests. Those remain separate milestones. It does not
install Valhalla, download PBFs, make an HTTP request or expose a service.

Run the deterministic offline mock/guard suite at any time:

    node scripts/check-local-map-graph.mjs

That suite is part of the existing scripts/check-rider-maps.mjs lint chain.
All its generated tiles are **synthetic test files**, never real roads.

## Next acceptance gates

Use the same pinned regional dataset and build to test distinct car, motorcycle,
moped and scooter journeys, including UK motorways, filtered roads, turn restrictions,
ferries, tolls, one-way edges, routing gaps and alternative routes. Qualify the
motor_scooter top-speed assumptions and do not infer real motorway permission
or bus-lane permission from generic routing tags. Keep PWA/iOS/Android mapping
parity, Ride Safe and Google-data segregation intact. Never integrate Tolls #566,
or merge/enable Maps #572, without explicit owner authorisation.

## Remote real-data experiment (draft #572)

The CI workflow has a separate, draft-only Greater London graph job; it is not part of the general verify aggregate and never runs on main. The repository owner has authorised remote CI as a substitute when full local checks are unavailable. On PR #572 or manual CI dispatch on the Maps branch, it downloads the fixed 1 November 2026 Greater London extract from Geofabrik, checks the publisher MD5 for transport integrity and measures SHA-256, pulls the official Valhalla 3.9.3 amd64 image pinned by digest, and runs the existing graph builder and four-vehicle route suite inside network-disabled containers. No ports, secrets, rider GPS or persistent hosting. Only small JSON evidence is retained for three days; PBF and tiles are discarded. The hashes for local tool wrappers are not native executable hashes; the separate image digest identifies the container bytes. The monthly extract was chosen over the latest daily file for repeatability; it is not current enough to establish legal road restrictions or charges. No admin/timezone DB or legal-access acceptance is implied. Inspect the separate job's actual result before claiming any real routing success.

Sources: https://download.geofabrik.de/europe/united-kingdom/england/greater-london/index.html and https://github.com/valhalla/valhalla/pkgs/container/valhalla/1579648647?tag=3.9.3 .
