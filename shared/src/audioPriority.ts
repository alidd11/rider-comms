export interface AudioSourceState {
  /** A turn-by-turn navigation prompt is currently playing */
  navPromptActive: boolean;
  /** Someone else in the room is currently speaking (VOX-gated open) */
  chatActive: boolean;
  /** Music (Spotify/Apple Music/etc, via the OS media session) is playing */
  musicPlaying: boolean;
}

export interface AudioGainLevels {
  /** Linear gain 0-1 for each bus */
  nav: number;
  chat: number;
  music: number;
}

const FULL_GAIN = 1.0;
/** Roughly a 15dB perceptual duck, per Section 4/7 of the spec. */
const DUCK_GAIN = 0.3;
const SILENT = 0;

/**
 * The audio mixer's priority decision, as pure/testable logic separate from
 * any native audio code. Priority, highest to lowest: nav prompt > group
 * voice chat > music (Sections 4 and 7 of the spec). A higher-priority
 * active source ducks — never fully mutes — everything below it.
 */
export function computeAudioGains(state: AudioSourceState): AudioGainLevels {
  const { navPromptActive, chatActive, musicPlaying } = state;

  const nav = navPromptActive ? FULL_GAIN : SILENT;

  const chat = chatActive ? (navPromptActive ? DUCK_GAIN : FULL_GAIN) : SILENT;

  const music = musicPlaying
    ? navPromptActive || chatActive
      ? DUCK_GAIN
      : FULL_GAIN
    : SILENT;

  return { nav, chat, music };
}
