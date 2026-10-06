/**
 * Turn-by-turn on the iPhone lock screen and Dynamic Island, through an iOS
 * Live Activity (the expo-live-activity module's widget). The next turn's
 * arrow, distance and instruction, the arrival time, and route progress.
 *
 * Pure logic plus a small controller, so it runs under node:test; the hook
 * in useNavigationLiveActivity.ts supplies the native module.
 */

export interface NavigationLiveActivityInput {
  maneuver: string;
  instruction: string;
  /** "420 ft", already in the rider's units. */
  distanceLabel: string;
  /** "21:27" */
  arrivalLabel: string;
  /** 0 to 1 of the route done. */
  progress: number;
}

export interface NavigationLiveActivityContent {
  title: string;
  subtitle: string;
  progressBar: { progress: number };
  imageName: string;
  dynamicIslandImageName: string;
}

export interface LiveActivityApi {
  startActivity(state: NavigationLiveActivityContent, config?: Record<string, unknown>): string | void;
  updateActivity(id: string, state: NavigationLiveActivityContent): void;
  stopActivity(id: string, state: NavigationLiveActivityContent): void;
}

/** The arrow image (mobile/assets/liveActivity) for a Google maneuver. */
export function liveActivityImageForManeuver(maneuver: string): string {
  if (maneuver === 'arrive') return 'nav_arrive';
  if (maneuver.includes('roundabout')) return 'nav_roundabout';
  if (maneuver.includes('uturn')) return 'nav_uturn';
  const left = maneuver.endsWith('left');
  const right = maneuver.endsWith('right');
  if (maneuver === 'turn-left' || maneuver === 'turn-sharp-left') return 'nav_left';
  if (maneuver === 'turn-right' || maneuver === 'turn-sharp-right') return 'nav_right';
  // Slight turns, forks, ramps and merges all read as "bear".
  if (left) return 'nav_slight_left';
  if (right) return 'nav_slight_right';
  return 'nav_straight';
}

export function navigationLiveActivityContent(input: NavigationLiveActivityInput): NavigationLiveActivityContent {
  const image = liveActivityImageForManeuver(input.maneuver || 'straight');
  const progress = Number.isFinite(input.progress) ? Math.max(0, Math.min(1, input.progress)) : 0;
  return {
    title: `${input.distanceLabel} · ${input.instruction}`.trim(),
    subtitle: input.arrivalLabel ? `Arrive ${input.arrivalLabel}` : '',
    // Whole percent steps, so riding along doesn't push an update every fix.
    progressBar: { progress: Math.round(progress * 100) / 100 },
    imageName: image,
    dynamicIslandImageName: image,
  };
}

export const NAVIGATION_LIVE_ACTIVITY_CONFIG = {
  backgroundColor: '#0E1418',
  titleColor: '#FFFFFF',
  subtitleColor: '#B5C2C9',
  progressViewTint: '#2FA8D3',
  progressViewLabelColor: '#FFFFFF',
  deepLinkUrl: '/map',
  imagePosition: 'left',
  imageAlign: 'center',
  imageSize: { width: 44, height: 44 },
  contentFit: 'contain',
} as const;

/**
 * Starts the activity on the first update, skips identical updates, and ends
 * it when navigation stops. Every native call is guarded: a Live Activity is
 * a nice-to-have and must never break navigation.
 */
export class NavigationLiveActivity {
  private readonly api: LiveActivityApi | null;
  private id: string | null = null;
  private last: string | null = null;
  private lastContent: NavigationLiveActivityContent | null = null;

  constructor(api: LiveActivityApi | null) {
    this.api = api;
  }

  get active(): boolean {
    return this.id !== null;
  }

  update(content: NavigationLiveActivityContent): void {
    if (!this.api) return;
    const key = JSON.stringify(content);
    if (key === this.last) return;
    try {
      if (this.id) {
        this.api.updateActivity(this.id, content);
      } else {
        const id = this.api.startActivity(content, NAVIGATION_LIVE_ACTIVITY_CONFIG);
        if (typeof id !== 'string' || !id) return;
        this.id = id;
      }
      this.last = key;
      this.lastContent = content;
    } catch {
      // Live Activities turned off in Settings, Expo Go, or an older iOS.
    }
  }

  stop(finalTitle?: string): void {
    if (!this.api || !this.id) return;
    const id = this.id;
    this.id = null;
    this.last = null;
    const final = this.lastContent
      ? { ...this.lastContent, ...(finalTitle ? { title: finalTitle, subtitle: '' } : {}) }
      : { title: finalTitle ?? 'Navigation ended', subtitle: '', progressBar: { progress: 1 }, imageName: 'nav_arrive', dynamicIslandImageName: 'nav_arrive' };
    this.lastContent = null;
    try {
      this.api.stopActivity(id, final);
    } catch {
      // Already dismissed by the rider.
    }
  }
}
