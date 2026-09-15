/**
 * Real hands-free voice activation (VOX) for the proximity-chat mic.
 *
 * This was a TODO(native) stub for most of this project's life — the
 * assumption being that hands-free VOX needs a native VAD model (Silero
 * VAD, WebRTC VAD, etc.) that can't be wired up without a real device and
 * native build tooling. That assumption was wrong: `@livekit/react-native`
 * already ships a real native volume analyzer (`useTrackVolume`, backed by
 * `LiveKitModule.createVolumeProcessor` — see node_modules/@livekit/react-native/src/hooks/useTrackVolume.ts)
 * that measures the actual local microphone's `MediaStreamTrack` on-device,
 * in real time, independent of whether the track is currently muted for
 * transmission.
 *
 * The other piece that makes this work: livekit-client's publish default
 * `stopMicTrackOnMute` is `false` (see node_modules/livekit-client, the
 * `publishDefaults` object) — meaning `localParticipant.setMicrophoneEnabled(false)`
 * only mutes the already-published track (stops sending) without stopping
 * the underlying hardware capture. So the volume processor keeps measuring
 * real audio level even while the mic is muted for transmission, which is
 * exactly the loop hands-free VOX needs: stay muted by default, keep
 * listening locally, unmute the instant real speech is detected, re-mute
 * after a short hangtime once it stops.
 *
 * WHAT'S REAL: the volume signal (native, on-device, from the actual mic
 * input) and the mute/unmute calls (real LiveKit API, real track object).
 * WHAT'S UNVERIFIED: the exact threshold/hangtime values below are a
 * reasonable starting point, not tuned against real hardware or a real
 * riding environment (wind noise, helmet acoustics) — this sandbox has no
 * device to tune against. Expect these two constants to need adjustment
 * after a real on-bike test; nothing else in this file should need to
 * change to retune it.
 */
import { useEffect, useRef, useState } from 'react';
import { useLocalParticipant, useTrackVolume } from '@livekit/react-native';
import type { LocalAudioTrack } from 'livekit-client';

/** Normalized volume (0-1) above which the rider is considered speaking. */
const SPEAKING_VOLUME_THRESHOLD = 0.06;

/** How long to keep transmitting after volume drops below the threshold,
 * so a brief pause mid-sentence doesn't clip the next word. */
const RELEASE_HANGTIME_MS = 500;

/**
 * Must be called from within a `<LiveKitRoom>` tree (it uses LiveKit's
 * room context via `useLocalParticipant`). Returns whether the rider is
 * currently detected as speaking, and — as a side effect — mutes/unmutes
 * the real published microphone track to match, so other participants
 * only actually hear audio while this is true.
 */
export function useVoiceActivity(enabled: boolean): boolean {
  const { localParticipant, microphoneTrack } = useLocalParticipant();
  // useLocalParticipant() returns a TrackPublication; useTrackVolume needs
  // the actual LocalAudioTrack the publication wraps.
  const volume = useTrackVolume(microphoneTrack?.track as LocalAudioTrack | undefined);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const releaseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!enabled) {
      if (releaseTimer.current) {
        clearTimeout(releaseTimer.current);
        releaseTimer.current = undefined;
      }
      setIsSpeaking(false);
      return;
    }
    if (volume > SPEAKING_VOLUME_THRESHOLD) {
      if (releaseTimer.current) {
        clearTimeout(releaseTimer.current);
        releaseTimer.current = undefined;
      }
      setIsSpeaking(true);
    } else if (!releaseTimer.current) {
      releaseTimer.current = setTimeout(() => {
        releaseTimer.current = undefined;
        setIsSpeaking(false);
      }, RELEASE_HANGTIME_MS);
    }
  }, [volume, enabled]);

  useEffect(() => {
    return () => {
      if (releaseTimer.current) clearTimeout(releaseTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!localParticipant) return;
    // Real LiveKit call: mutes/unmutes the already-published track (per
    // stopMicTrackOnMute:false above, this never stops mic hardware
    // capture, so the volume processor driving this same hook keeps
    // working across mute/unmute cycles). When `enabled` is false (VOX
    // off, or a manual mute override), `isSpeaking` is already forced
    // false by the effect above, so this correctly mutes rather than
    // just skipping the call and leaving a stale mic state behind.
    void localParticipant.setMicrophoneEnabled(isSpeaking).catch(() => {});
  }, [isSpeaking, localParticipant]);

  return enabled ? isSpeaking : false;
}
