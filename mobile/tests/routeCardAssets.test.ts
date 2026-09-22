import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { CURATED_ROUTES } from '../src/routes/curatedRoutes.ts';

interface ManifestRoute {
  file: string;
  bytes: number;
  sha256: string;
  modification: string;
}

interface RouteCardManifest {
  width: number;
  jpegQuality: number;
  routes: Record<string, ManifestRoute>;
}

const repoRoot = new URL('../../', import.meta.url);

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

test('bundles one synchronized local card image for every curated route', async () => {
  const manifest = JSON.parse(
    await readFile(new URL('ROUTE_CARD_ASSETS.json', repoRoot), 'utf8'),
  ) as RouteCardManifest;
  const routeIds = CURATED_ROUTES.map((route) => route.id).sort();
  assert.deepEqual(Object.keys(manifest.routes).sort(), routeIds);
  assert.equal(manifest.width, 640);
  assert.equal(manifest.jpegQuality, 78);

  const mappingSource = await readFile(
    new URL('mobile/src/routes/routeCardAssets.ts', repoRoot),
    'utf8',
  );

  for (const route of CURATED_ROUTES) {
    const entry = manifest.routes[route.id];
    assert.ok(entry, `Missing manifest entry for ${route.id}`);
    assert.match(entry.modification, /Resized to a maximum of 640px wide/);
    assert.ok(mappingSource.includes(`"${route.id}": require('../../assets/routes/cards/${entry.file}')`));

    const nativeBytes = await readFile(
      new URL(`mobile/assets/routes/cards/${entry.file}`, repoRoot),
    );
    const pwaBytes = await readFile(
      new URL(`docs/assets/routes/cards/${entry.file}`, repoRoot),
    );

    assert.equal(nativeBytes.length, entry.bytes);
    assert.equal(pwaBytes.length, entry.bytes);
    assert.equal(sha256(nativeBytes), entry.sha256);
    assert.equal(sha256(pwaBytes), entry.sha256);
    assert.deepEqual(nativeBytes, pwaBytes);
  }
});
