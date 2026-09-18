import * as React from 'react';
import { useRemoteParticipants, useSpeakingParticipants } from '@livekit/react-native';
import { audioEngine } from './audioEngine';

/**
 * Applies Rider Comms' navigation > chat priority to real LiveKit remote
 * audio. LiveKit's React Native RemoteParticipant.setVolume() ultimately
 * changes the native remote MediaStreamTrack volume, so this is real chat
 * playout ducking rather than a visual-only mixer value.
 *
 * The bridge also reports *remote* speaking state to AudioEngine. Local VOX
 * is intentionally separate: the rider speaking should not be mistaken for
 * incoming chat that needs to participate in playback priority.
 */
export function LiveKitAudioPriorityBridge({ sourceId }: { sourceId: string }): null {
  const remoteParticipants = useRemoteParticipants();
  const speakingParticipants = useSpeakingParticipants();
  const [playbackGain, setPlaybackGain] = React.useState(() => audioEngine.getIncomingChatPlaybackGain());

  React.useEffect(() => {
    return audioEngine.onGainsChanged(() => {
      setPlaybackGain(audioEngine.getIncomingChatPlaybackGain());
    });
  }, []);

  React.useEffect(() => {
    for (const participant of remoteParticipants) participant.setVolume(playbackGain);
    return () => {
      // Never leave a surviving remote track ducked after this bridge no
      // longer owns it (room teardown, peer replacement, or unmount).
      for (const participant of remoteParticipants) participant.setVolume(1);
    };
  }, [remoteParticipants, playbackGain]);

  const remoteSpeaking = React.useMemo(() => {
    if (remoteParticipants.length === 0 || speakingParticipants.length === 0) return false;
    const remoteSids = new Set(remoteParticipants.map((participant) => participant.sid));
    return speakingParticipants.some((participant) => remoteSids.has(participant.sid));
  }, [remoteParticipants, speakingParticipants]);

  React.useEffect(() => {
    audioEngine.setChatSourceActive(sourceId, remoteSpeaking);
    return () => audioEngine.clearChatSource(sourceId);
  }, [sourceId, remoteSpeaking]);

  return null;
}
