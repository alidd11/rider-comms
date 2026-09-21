const WIKIMEDIA_ORIGINAL_RE = /^(https:\/\/(?:upload|thumb)\.wikimedia\.org)(\/wikipedia\/commons\/)([0-9a-f]\/[^/]+\/)([^/?#]+)$/i;
const WIKIMEDIA_THUMB_RE = /^(https:\/\/(?:upload|thumb)\.wikimedia\.org)(\/wikipedia\/commons\/thumb\/)([0-9a-f]\/[^/]+\/)([^/]+)\/[^/?#]+$/i;

export const ROUTE_CARD_IMAGE_WIDTH = 960;
export const ROUTE_HERO_IMAGE_WIDTH = 1600;
export const ROUTE_IMAGE_PREFETCH_COUNT = 4;

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

export function routeCardImageUri(uri: string): string {
  return routeImageUriAtWidth(uri, ROUTE_CARD_IMAGE_WIDTH);
}

export function routeHeroImageUri(uri: string): string {
  return routeImageUriAtWidth(uri, ROUTE_HERO_IMAGE_WIDTH);
}
