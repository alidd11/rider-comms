import { createLocalAudioTrack } from 'livekit-client';

/**
 * Requests microphone access from a deliberate foreground rider action and
 * immediately releases the temporary capture track. Real voice rooms create
 * their own track later, muted before publication; this helper only makes the
 * permission/readiness decision happen while the rider is still stationary
 * and interacting with the Join/Go Live control.
 */
export async function preflightVoiceMicrophone(): Promise<void> {
  const track = await createLocalAudioTrack();
  track.stop();
}

export function microphoneErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (message.includes('permission') || message.includes('denied') || message.includes('notallowed')) {
    return 'Microphone access is blocked. Allow Rider Comms to use the microphone, then try again.';
  }
  if (message.includes('device') || message.includes('notfound')) {
    return 'No microphone is available. Check your helmet/headset connection and try again.';
  }
  return 'Rider Comms could not open the microphone. Check your microphone or Bluetooth connection and try again.';
}
