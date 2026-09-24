const WIKIMEDIA_ORIGINAL_RE = /^(https:\/\/(?:upload|thumb)\.wikimedia\.org)(\/wikipedia\/commons\/)([0-9a-f]\/[^/]+\/)([^/?#]+)$/i;
const WIKIMEDIA_THUMB_RE = /^(https:\/\/(?:upload|thumb)\.wikimedia\.org)(\/wikipedia\/commons\/thumb\/)([0-9a-f]\/[^/]+\/)([^/]+)\/[^/?#]+$/i;

export const ROUTE_HERO_IMAGE_WIDTH = 1600;
export const ROUTE_CARD_IMAGE_FALLBACK_WIDTH = 640;
export const ROUTE_CARD_IMAGE_MAX_WIDTH = 1280;

function thumbnailFileName(fileName: string, width: number): string {
  return fileName.toLowerCase().endsWith('.svg')
    ? `${width}px-${fileName}.png`
    : `${width}px-${fileName}`;
}

/**
 * Returns a Wikimedia thumbnail URL sized for the surface that will render it.
 * Non-Wikimedia URLs are left untouched so this helper never fabricates a
 * provider-specific resize URL for an unsupported host.
 */
export function routeImageUriAtWidth(uri: string, width: number): string {
  const normalizedWidth = Math.min(2000, Math.max(320, Math.round(width)));
  const cleanUri = uri.split(/[?#]/, 1)[0];

  const thumbMatch = cleanUri.match(WIKIMEDIA_THUMB_RE);
  if (thumbMatch) {
    const [, origin, prefix, shard, fileName] = thumbMatch;
    return `${origin}${prefix}${shard}${fileName}/${thumbnailFileName(fileName, normalizedWidth)}`;
  }

  const originalMatch = cleanUri.match(WIKIMEDIA_ORIGINAL_RE);
  if (originalMatch) {
    const [, origin, prefix, shard, fileName] = originalMatch;
    return `${origin}${prefix}thumb/${shard}${fileName}/${thumbnailFileName(fileName, normalizedWidth)}`;
  }

  return uri;
}


/**
 * Picks a route-card source that is dense enough for the physical display
 * without requesting an unbounded image. Bundled 640px cards remain the
 * immediate/offline fallback; supported Wikimedia sources can progressively
 * upgrade to the DPR-aware URL returned here.
 */
export function routeCardImageUri(uri: string, logicalWidth: number, pixelRatio = 1): string {
  const safeLogicalWidth = Number.isFinite(logicalWidth)
    ? Math.max(1, logicalWidth)
    : ROUTE_CARD_IMAGE_FALLBACK_WIDTH;
  const safePixelRatio = Number.isFinite(pixelRatio) ? Math.max(1, pixelRatio) : 1;
  const targetWidth = Math.min(
    ROUTE_CARD_IMAGE_MAX_WIDTH,
    Math.max(ROUTE_CARD_IMAGE_FALLBACK_WIDTH, Math.ceil(safeLogicalWidth * safePixelRatio)),
  );
  return routeImageUriAtWidth(uri, targetWidth);
}

export function routeHeroImageUri(uri: string): string {
  return routeImageUriAtWidth(uri, ROUTE_HERO_IMAGE_WIDTH);
}
