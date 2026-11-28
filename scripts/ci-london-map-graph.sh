#!/usr/bin/env bash
# Draft Maps #572 only. Real London data, no rider information or live service.
set -euo pipefail
umask 077
: "$RUNNER_TEMP" "$GITHUB_WORKSPACE"
if [[ "$RUNNER_OS" != Linux || "$GITHUB_ACTIONS" != true ]]; then
  echo 'This research job is intended for an isolated GitHub Linux runner.' >&2
  exit 2
fi
work=$(mktemp -d "$RUNNER_TEMP/rider-london-XXXXXX")
trap 'rm -rf -- "$work"' EXIT
out="$GITHUB_WORKSPACE/test-results/maps-london-graph"
mkdir -p "$out"
image='ghcr.io/valhalla/valhalla:3.9.3@sha256:09474155aa81dbda1b6bfa7bd32917040dcdf5c7a9a9a6322915fe4703ae19c2'
source_url='https://download.geofabrik.de/europe/united-kingdom/england/greater-london/greater-london-261101.osm.pbf'
export work out image source_url
curl --fail --silent --show-error --location --retry 2 --max-time 240 --max-filesize 200000000 \
  --proto '=https' --proto-redir '=https' "$source_url" -o "$work/london.osm.pbf"
curl --fail --silent --show-error --location --retry 2 --max-time 60 --max-filesize 4096 \
  --proto '=https' --proto-redir '=https' "$source_url.md5" -o "$work/publisher.md5"
publisher_md5=$(awk 'NR==1{print $1}' "$work/publisher.md5")
[[ "$publisher_md5" =~ ^[a-fA-F0-9]{32}$ ]]
[[ "$(md5sum "$work/london.osm.pbf" | awk '{print $1}')" == "$(printf '%s' "$publisher_md5" | tr A-F a-f)" ]]
pbf_sha=$(sha256sum "$work/london.osm.pbf" | awk '{print $1}')
downloaded_at=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
export pbf_sha downloaded_at
docker pull --platform linux/amd64 "$image"
image_id=$(docker image inspect --format '{{.Id}}' "$image")
export image_id
# The wrapper paths and hashes bind the fixed image digest and invocation.
# They are not hashes of the native executable inside the image.
# No repository mount, Docker socket, tokens, network or published ports.
for tool in valhalla_build_config valhalla_build_tiles valhalla_service; do
  {
    printf '#!/usr/bin/env bash\nset -euo pipefail\n'
    printf 'exec docker run --rm --pull never --platform linux/amd64 --network none --cap-drop ALL --security-opt no-new-privileges --read-only --tmpfs /tmp:rw,nosuid,nodev --cpus 2 --memory 10g --user %q --env HOME=/tmp --mount %q --workdir "$PWD" --entrypoint %q %q "$@"' \
      "$(id -u):$(id -g)" "type=bind,src=$work,dst=$work" "$tool" "$image"
    if [[ "$tool" == valhalla_build_config ]]; then printf ' --mjolnir-concurrency 2'; fi
    printf '\n'
  } > "$work/$tool"
  chmod 700 "$work/$tool"
done
# The existing graph builder uses the isolated work directory for its subprocesses.
# The route verifier's subprocess cwd must also be inside the mounted directory.
node --input-type=module <<'NODE'
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const { work, out, image, image_id, source_url, pbf_sha, downloaded_at } = process.env;
const pin = name => { const path = join(work, name); return { path, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') }; };
const graphDir = join(work, 'graph');
const spec = {
  pbf: { path: join(work, 'london.osm.pbf'), sourceUrl: source_url, sha256: pbf_sha, downloadedAtUtc: downloaded_at, license: 'ODbL-1.0' },
  tools: { version: '3.9.3', config: pin('valhalla_build_config'), buildTiles: pin('valhalla_build_tiles') },
  region: { name: 'Greater London', bounds: [-0.52, 51.26, 0.34, 51.71] },
  profileRevision: 'uk-research-1', outputDir: graphDir
};
const suite = { schemaVersion: 1, graphDir, service: pin('valhalla_service'), cases: [
  { id: 'car-central', vehicleCategory: 'car', coordinates: [[-0.1276,51.5072],[-0.12,51.51]] },
  { id: 'motorcycle-central', vehicleCategory: 'motorcycle_large', coordinates: [[-0.13,51.51],[-0.118,51.515]] },
  { id: 'moped-central', vehicleCategory: 'moped', scooterTopSpeedKph: 45, avoidHighways: true, coordinates: [[-0.12,51.52],[-0.11,51.525]] },
  { id: 'scooter-central', vehicleCategory: 'scooter', scooterTopSpeedKph: 65, coordinates: [[-0.11,51.525],[-0.10,51.53]] }
] };
writeFileSync(join(work, 'graph-spec.json'), JSON.stringify(spec));
writeFileSync(join(work, 'route-suite.json'), JSON.stringify(suite));
writeFileSync(join(out, 'source-provenance.json'), JSON.stringify({
  sourceUrl: source_url, sha256: pbf_sha, downloadedAtUtc: downloaded_at, publisherMd5Matched: true,
  attribution: '© OpenStreetMap contributors; extract by Geofabrik, ODbL 1.0',
  image, imageId: image_id, wrapperHashes: { ...spec.tools, service: suite.service },
  containerNetworkDisabled: true, legalRoadAccessVerified: false, navigationReady: false
}, null, 2) + '\n');
NODE
cd "$work"
node "$GITHUB_WORKSPACE/scripts/build-local-map-graph.mjs" --plan "$work/graph-spec.json" > "$out/build-plan.json"
node "$GITHUB_WORKSPACE/scripts/build-local-map-graph.mjs" --build "$work/graph-spec.json" > "$out/graph-manifest.json"
node "$GITHUB_WORKSPACE/scripts/verify-local-valhalla-routes.mjs" --validate "$work/route-suite.json" > "$out/route-validation.json"
node "$GITHUB_WORKSPACE/scripts/verify-local-valhalla-routes.mjs" --run "$work/route-suite.json" > "$out/route-results.json"
[[ "$(sha256sum "$work/london.osm.pbf" | awk '{print $1}')" == "$pbf_sha" ]]
# Only the small evidence JSON files are uploaded, never the PBF or graph.
echo 'Real graph experiment completed; road legality and navigation readiness remain unverified.'
