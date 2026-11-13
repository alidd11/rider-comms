// MapScreen.tsx draws its navigation overlay, riding HUD and place cards
// through components split out beside it; checks that look for behaviour
// "in the map screen" read all of them together.
import { readFile } from 'node:fs/promises';

const PARTS = ['MapScreen.tsx', 'NavigationOverlay.tsx', 'RidingHud.tsx', 'MapPlaceCards.tsx'];

export async function readNativeMapScreenSource() {
  const sources = await Promise.all(PARTS.map((part) =>
    readFile(new URL(`../mobile/src/screens/${part}`, import.meta.url), 'utf8')));
  return sources.join('\n');
}
