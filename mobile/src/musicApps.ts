/**
 * The music button on the map (both apps): a web or React Native app can't
 * embed another app's player the way Waze embeds Spotify's SDK, so it opens
 * the rider's music app by its URL scheme, last-used first.
 */
export interface MusicApp {
  id: 'spotify' | 'apple-music' | 'youtube-music';
  name: string;
  url: string;
}

export const MUSIC_APP_STORAGE_KEY = 'rider-comms-music-app';

const MUSIC_APPS: Array<MusicApp & { iosOnly?: boolean }> = [
  { id: 'spotify', name: 'Spotify', url: 'spotify:' },
  { id: 'apple-music', name: 'Apple Music', url: 'music://', iosOnly: true },
  { id: 'youtube-music', name: 'YouTube Music', url: 'youtubemusic://' },
];

export function musicAppsFor(platform: string, lastUsedId: string | null): MusicApp[] {
  return MUSIC_APPS
    .filter((app) => !app.iosOnly || platform === 'ios')
    .sort((a, b) => Number(b.id === lastUsedId) - Number(a.id === lastUsedId))
    .map(({ id, name, url }) => ({ id, name, url }));
}
