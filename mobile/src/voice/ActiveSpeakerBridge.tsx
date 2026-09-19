import * as React from 'react';
import { useRoomContext } from '@livekit/react-native';
import { RoomEvent } from 'livekit-client';

/**
 * Bridges LiveKit's authoritative active-speaker list out of room context.
 * This reports participant identities for both local and remote speakers;
 * callers decide which identities are useful for their UI.
 */
export function ActiveSpeakerBridge({
  onSpeakerIdsChange,
}: {
  onSpeakerIdsChange: (speakerIds: string[]) => void;
}): null {
  const room = useRoomContext();
  const callbackRef = React.useRef(onSpeakerIdsChange);
  callbackRef.current = onSpeakerIdsChange;

  React.useEffect(() => {
    const publish = (speakers = room.activeSpeakers) => {
      callbackRef.current(
        speakers
          .map((participant) => participant.identity)
          .filter((identity): identity is string => Boolean(identity)),
      );
    };

    const onActiveSpeakersChanged = (speakers: typeof room.activeSpeakers) => publish(speakers);
    publish();
    room.on(RoomEvent.ActiveSpeakersChanged, onActiveSpeakersChanged);

    return () => {
      room.off(RoomEvent.ActiveSpeakersChanged, onActiveSpeakersChanged);
      callbackRef.current([]);
    };
  }, [room]);

  return null;
}
