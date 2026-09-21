import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const CARD_WIDTH = 768;
const catalogPath = new URL('../mobile/src/routes/curatedRoutes.ts', import.meta.url);
const catalog = await readFile(catalogPath, 'utf8');
const routeMatches = [...catalog.matchAll(/"id":\s*"([^"]+)"[\s\S]*?"image":\s*\{\s*"uri":\s*"([^"]+)"/g)];

if (routeMatches.length === 0) {
  throw new Error('No curated route images found');
}

const outputRoots = [
  new URL('../docs/assets/routes/cards/', import.meta.url),
  new URL('../mobile/assets/routes/cards/', import.meta.url),
];

for (const root of outputRoots) await mkdir(root, { recursive: true });

function wikimediaThumbnailUrl(uri, width) {
  const clean = uri.split(/[?#]/, 1)[0];
  const thumb = clean.match(/^(https:\/\/(?:upload|thumb)\.wikimedia\.org)(\/wikipedia\/commons\/thumb\/)([0-9a-f]\/[^/]+\/)([^/]+)\/[^/?#]+$/i);
  if (thumb) {
    const [, origin, prefix, shard, fileName] = thumb;
    return `${origin}${prefix}${shard}${fileName}/${width}px-${fileName}`;
  }

  const original = clean.match(/^(https:\/\/(?:upload|thumb)\.wikimedia\.org)(\/wikipedia\/commons\/)([0-9a-f]\/[^/]+\/)([^/?#]+)$/i);
  if (original) {
    const [, origin, prefix, shard, fileName] = original;
    return `${origin}${prefix}thumb/${shard}${fileName}/${width}px-${fileName}`;
  }

  return uri;
}

async function fetchImage(uri) {
  const headers = {
    'User-Agent': 'RiderCommsRouteAssetBot/1.0 (https://github.com/alidd11/rider-comms)',
    Accept: 'image/avif,image/webp,image/jpeg,image/*,*/*;q=0.8',
  };

  const candidates = [wikimediaThumbnailUrl(uri, CARD_WIDTH), uri];
  let lastError = null;
  for (const candidate of [...new Set(candidates)]) {
    try {
      const response = await fetch(candidate, { headers, redirect: 'follow' });
      if (!response.ok) {
        lastError = new Error(`${response.status} ${response.statusText} for ${candidate}`);
        continue;
      }
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.startsWith('image/')) {
        lastError = new Error(`Unexpected content type ${contentType || '(missing)'} for ${candidate}`);
        continue;
      }
      return { candidate, bytes: Buffer.from(await response.arrayBuffer()), contentType };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error(`Unable to fetch ${uri}`);
}

const manifest = {
  generatedAt: new Date().toISOString(),
  width: CARD_WIDTH,
  note: 'Local runtime card copies derived from the authoritative image URI in mobile/src/routes/curatedRoutes.ts. Attribution and licence metadata remain in the curated route catalogue and ROUTE_IMAGE_LICENSES.md.',
  routes: {},
};

let totalBytes = 0;
for (const [, id, sourceUri] of routeMatches) {
  const { candidate, bytes, contentType } = await fetchImage(sourceUri);
  const extension = contentType.includes('png') ? 'png' : 'jpg';
  const filename = `${id}.${extension}`;

  for (const root of outputRoots) {
    await writeFile(new URL(filename, root), bytes);
  }

  const sha256 = createHash('sha256').update(bytes).digest('hex');
  totalBytes += bytes.length;
  manifest.routes[id] = {
    file: filename,
    sourceUri,
    fetchedUri: candidate,
    bytes: bytes.length,
    sha256,
  };
  console.log(`${id}: ${(bytes.length / 1024).toFixed(1)} KiB (${candidate})`);
}

await writeFile(
  new URL('../ROUTE_CARD_ASSETS.json', import.meta.url),
  `${JSON.stringify(manifest, null, 2)}\n`,
);

console.log(`Generated ${routeMatches.length} route card images; one client copy totals ${(totalBytes / (1024 * 1024)).toFixed(2)} MiB`);
