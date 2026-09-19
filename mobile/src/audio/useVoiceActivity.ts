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
import { useConnectionState, useLocalParticipant, useTrackVolume } from '@livekit/react-native';
import { ConnectionState, createLocalAudioTrack } from 'livekit-client';
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
export function useVoiceActivity(enabled: boolean, onError?: (message: string) => void): boolean {
  const connectionState = useConnectionState();
  const { localParticipant, microphoneTrack } = useLocalParticipant();
  const publishingRef = useRef(false);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  // useLocalParticipant() returns a TrackPublication; useTrackVolume needs
  // the actual LocalAudioTrack the publication wraps.
  const volume = useTrackVolume(microphoneTrack?.track as LocalAudioTrack | undefined);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const releaseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Never let LiveKit auto-publish an open microphone. Once the room is
  // connected, create the local audio track ourselves, mute it BEFORE
  // publication, then publish that already-muted track. The VOX effect below
  // is the only code allowed to unmute it.
  useEffect(() => {
    if (connectionState !== ConnectionState.Connected || microphoneTrack?.track || publishingRef.current) return;
    let cancelled = false;
    let createdTrack: LocalAudioTrack | undefined;
    publishingRef.current = true;

    void (async () => {
      try {
        createdTrack = await createLocalAudioTrack();
        await createdTrack.mute();
        if (cancelled) {
          createdTrack.stop();
          return;
        }
        await localParticipant.publishTrack(createdTrack);
      } catch (error) {
        createdTrack?.stop();
        if (!cancelled) {
          onErrorRef.current?.(error instanceof Error ? error.message : 'Microphone is unavailable.');
        }
      } finally {
        publishingRef.current = false;
      }
    })();

    return () => { cancelled = true; };
  }, [connectionState, localParticipant, microphoneTrack?.track]);

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
    const track = microphoneTrack?.track as LocalAudioTrack | undefined;
    if (!track) return;
    // The publication is already muted before it reaches the SFU. From that
    // safe baseline VOX only toggles this exact track; it never asks
    // setMicrophoneEnabled(true) to create a new un-gated microphone.
    const operation = isSpeaking ? track.unmute() : track.mute();
    void operation.catch((error) => {
      onErrorRef.current?.(error instanceof Error ? error.message : 'Could not update microphone state.');
    });
  }, [isSpeaking, microphoneTrack?.track]);

  return enabled ? isSpeaking : false;
}
