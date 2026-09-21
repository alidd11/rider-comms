import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const CARD_WIDTH = 640;
const JPEG_QUALITY = 78;
const execFileAsync = promisify(execFile);
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

function wikimediaFileName(uri) {
  const clean = uri.split(/[?#]/, 1)[0];
  const thumb = clean.match(/\/wikipedia\/commons\/thumb\/[0-9a-f]\/[^/]+\/([^/]+)\/[^/?#]+$/i);
  if (thumb) return thumb[1];
  const original = clean.match(/\/wikipedia\/commons\/[0-9a-f]\/[^/]+\/([^/?#]+)$/i);
  return original?.[1] ?? null;
}

function preferredWikimediaUrl(uri) {
  const fileName = wikimediaFileName(uri);
  if (!fileName) return uri;
  return `https://commons.wikimedia.org/wiki/Special:Redirect/file/${fileName}?width=${CARD_WIDTH}`;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let lastRequestAt = 0;

async function pacedFetch(url, headers) {
  const elapsed = Date.now() - lastRequestAt;
  if (elapsed < 1250) await sleep(1250 - elapsed);

  for (let attempt = 0; attempt < 4; attempt += 1) {
    lastRequestAt = Date.now();
    const response = await fetch(url, { headers, redirect: 'follow' });
    if (response.status !== 429 && response.status < 500) return response;

    const retryAfter = Number(response.headers.get('retry-after'));
    const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : 4000 * (attempt + 1);
    console.log(`Rate limited fetching ${url}; retrying in ${Math.round(delayMs / 1000)}s`);
    await sleep(delayMs);
  }

  return fetch(url, { headers, redirect: 'follow' });
}

async function fetchImage(uri) {
  const headers = {
    'User-Agent': 'RiderCommsRouteAssetBot/1.0 (https://github.com/alidd11/rider-comms)',
    Accept: 'image/avif,image/webp,image/jpeg,image/*,*/*;q=0.8',
  };

  const candidates = [preferredWikimediaUrl(uri), uri];
  let lastError = null;
  for (const candidate of [...new Set(candidates)]) {
    try {
      const response = await pacedFetch(candidate, headers);
      if (!response.ok) {
        lastError = new Error(`${response.status} ${response.statusText} for ${candidate}`);
        continue;
      }
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.startsWith('image/')) {
        lastError = new Error(`Unexpected content type ${contentType || '(missing)'} for ${candidate}`);
        continue;
      }
      return {
        candidate: response.url || candidate,
        bytes: Buffer.from(await response.arrayBuffer()),
        contentType,
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error(`Unable to fetch ${uri}`);
}

async function optimizeCardImage(bytes) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'rider-comms-route-card-'));
  const inputPath = path.join(tempDir, 'source-image');
  const outputPath = path.join(tempDir, 'card.jpg');
  try {
    await writeFile(inputPath, bytes);
    await execFileAsync('convert', [
      inputPath,
      '-auto-orient',
      '-resize', `${CARD_WIDTH}x>`,
      '-strip',
      '-sampling-factor', '4:2:0',
      '-interlace', 'Plane',
      '-quality', String(JPEG_QUALITY),
      outputPath,
    ]);
    return await readFile(outputPath);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

const manifest = {
  generatedAt: new Date().toISOString(),
  width: CARD_WIDTH,
  jpegQuality: JPEG_QUALITY,
  note: 'Local runtime card copies derived from the authoritative image URI in mobile/src/routes/curatedRoutes.ts. Files are resized/recompressed for card display; attribution, source and licence metadata remain in the curated route catalogue and ROUTE_IMAGE_LICENSES.md.',
  routes: {},
};

let totalBytes = 0;
for (const [, id, sourceUri] of routeMatches) {
  const { candidate, bytes: fetchedBytes } = await fetchImage(sourceUri);
  const bytes = await optimizeCardImage(fetchedBytes);
  const filename = `${id}.jpg`;

  for (const root of outputRoots) {
    await writeFile(new URL(filename, root), bytes);
  }

  const sha256 = createHash('sha256').update(bytes).digest('hex');
  totalBytes += bytes.length;
  manifest.routes[id] = {
    file: filename,
    sourceUri,
    fetchedUri: candidate,
    fetchedBytes: fetchedBytes.length,
    bytes: bytes.length,
    sha256,
    modification: `Resized to a maximum of ${CARD_WIDTH}px wide and JPEG recompressed at quality ${JPEG_QUALITY} for Rider Comms route-card display.`,
  };
  console.log(`${id}: ${(fetchedBytes.length / 1024).toFixed(1)} KiB -> ${(bytes.length / 1024).toFixed(1)} KiB`);
}

await writeFile(
  new URL('../ROUTE_CARD_ASSETS.json', import.meta.url),
  `${JSON.stringify(manifest, null, 2)}\n`,
);

console.log(`Generated ${routeMatches.length} route card images; one client copy totals ${(totalBytes / (1024 * 1024)).toFixed(2)} MiB`);
