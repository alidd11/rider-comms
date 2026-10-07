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

/** The instruction part of a "420 ft · Turn left onto …" title. */
function instructionOf(title: string): string {
  const separator = title.indexOf(' · ');
  return separator >= 0 ? title.slice(separator + 3) : title;
}

export const NAVIGATION_LIVE_ACTIVITY_CONFIG = {
  backgroundColor: '#0E1418',
  titleColor: '#FFFFFF',
  subtitleColor: '#B5C2C9',
  progressViewTint: '#2FA8D3',
  progressViewLabelColor: '#FFFFFF',
  imagePosition: 'left',
  imageAlign: 'center',
  imageSize: { width: 44, height: 44 },
  contentFit: 'contain',
} as const;

/** Distance ticks down on every GPS fix; the lock screen needn't. A new
 * turn (different arrow) still updates immediately. */
export const LIVE_ACTIVITY_MIN_UPDATE_MS = 5000;
/** After iOS refuses to start one, wait this long before trying again. */
export const LIVE_ACTIVITY_START_RETRY_MS = 60_000;

type TimerHandle = ReturnType<typeof setTimeout>;

/**
 * Starts the activity on the first update, skips identical updates, limits
 * how often the distance refreshes, and ends it when navigation stops.
 * Every native call is guarded: a Live Activity is a nice-to-have and must
 * never break navigation.
 */
export class NavigationLiveActivity {
  private readonly api: LiveActivityApi | null;
  private readonly now: () => number;
  private readonly setTimer: (callback: () => void, ms: number) => TimerHandle;
  private readonly clearTimer: (handle: TimerHandle) => void;
  private id: string | null = null;
  private last: string | null = null;
  private lastContent: NavigationLiveActivityContent | null = null;
  private lastSentAt = 0;
  private pending: NavigationLiveActivityContent | null = null;
  private pendingTimer: TimerHandle | null = null;
  private startRefusedAt: number | null = null;

  constructor(
    api: LiveActivityApi | null,
    clock: {
      now?: () => number;
      setTimer?: (callback: () => void, ms: number) => TimerHandle;
      clearTimer?: (handle: TimerHandle) => void;
    } = {},
  ) {
    this.api = api;
    this.now = clock.now ?? Date.now;
    this.setTimer = clock.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
    this.clearTimer = clock.clearTimer ?? ((handle) => clearTimeout(handle));
  }

  get active(): boolean {
    return this.id !== null;
  }

  /**
   * `urgent` (the turn is close) skips the throttle so the distance counts
   * down live when it matters most.
   */
  update(content: NavigationLiveActivityContent, { urgent = false }: { urgent?: boolean } = {}): void {
    if (!this.api) return;
    const key = JSON.stringify(content);
    if (key === this.last) {
      this.cancelPending();
      return;
    }
    // iOS refused to start one (Live Activities off): don't retry every fix.
    if (this.id === null && this.startRefusedAt !== null && this.now() - this.startRefusedAt < LIVE_ACTIVITY_START_RETRY_MS) return;
    // Same maneuver *and* same instruction: two consecutive left turns share
    // an arrow but are different steps, and the new one must show at once.
    const sameTurn = this.id !== null && this.lastContent !== null
      && this.lastContent.imageName === content.imageName
      && instructionOf(this.lastContent.title) === instructionOf(content.title);
    const wait = LIVE_ACTIVITY_MIN_UPDATE_MS - (this.now() - this.lastSentAt);
    if (sameTurn && !urgent && wait > 0) {
      // Keep only the newest content and send it once the interval passes.
      this.pending = content;
      this.pendingTimer ??= this.setTimer(() => {
        this.pendingTimer = null;
        const next = this.pending;
        this.pending = null;
        if (next) this.update(next);
      }, wait);
      return;
    }
    this.cancelPending();
    this.send(content, key);
  }

  private cancelPending(): void {
    if (this.pendingTimer !== null) this.clearTimer(this.pendingTimer);
    this.pendingTimer = null;
    this.pending = null;
  }

  private send(content: NavigationLiveActivityContent, key: string): void {
    if (!this.api) return;
    // Counted as an attempt even if it throws (Live Activities turned off,
    // dismissed), so a failing native call is throttled too.
    this.lastSentAt = this.now();
    try {
      if (this.id) {
        this.api.updateActivity(this.id, content);
      } else {
        const id = this.api.startActivity(content, NAVIGATION_LIVE_ACTIVITY_CONFIG);
        if (typeof id !== 'string' || !id) {
          this.startRefusedAt = this.now();
          return;
        }
        this.id = id;
        this.startRefusedAt = null;
      }
      this.last = key;
      this.lastContent = content;
    } catch {
      // Live Activities turned off in Settings, Expo Go, or an older iOS.
      if (!this.id) this.startRefusedAt = this.now();
    }
  }

  stop(finalTitle?: string): void {
    // The closing card shows the newest state, including one still waiting.
    const latest = this.pending ?? this.lastContent;
    this.cancelPending();
    this.startRefusedAt = null;
    if (!this.api || !this.id) return;
    const id = this.id;
    this.id = null;
    this.last = null;
    const final = latest
      ? { ...latest, ...(finalTitle ? { title: finalTitle, subtitle: '' } : {}) }
      : { title: finalTitle ?? 'Navigation ended', subtitle: '', progressBar: { progress: 1 }, imageName: 'nav_arrive', dynamicIslandImageName: 'nav_arrive' };
    this.lastContent = null;
    try {
      this.api.stopActivity(id, final);
    } catch {
      // Already dismissed by the rider.
    }
  }
}
