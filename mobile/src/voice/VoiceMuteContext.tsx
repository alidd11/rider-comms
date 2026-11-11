import * as React from 'react';

// One microphone mute for every voice surface (ride room and nearby pair
// rooms), so the riding HUD's Mute button and each voice bar agree. The PWA
// keeps the same single flag (voiceManuallyMuted).
type VoiceSource = 'ride' | 'proximity';

type VoiceMuteValue = {
  muted: boolean;
  setMuted: (next: boolean | ((current: boolean) => boolean)) => void;
  toggleMuted: () => void;
  /** True while any voice room is connected, which is when Mute is shown. */
  voiceConnected: boolean;
  reportConnected: (source: VoiceSource, connected: boolean) => void;
};

const VoiceMuteContext = React.createContext<VoiceMuteValue | null>(null);

export function VoiceMuteProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [muted, setMuted] = React.useState(false);
  const [sources, setSources] = React.useState<ReadonlySet<VoiceSource>>(new Set());
  const reportConnected = React.useCallback((source: VoiceSource, connected: boolean) => {
    setSources((current) => {
      if (current.has(source) === connected) return current;
      const next = new Set(current);
      if (connected) next.add(source);
      else next.delete(source);
      return next;
    });
  }, []);
  const toggleMuted = React.useCallback(() => setMuted((current) => !current), []);
  const value = React.useMemo(() => ({
    muted,
    setMuted,
    toggleMuted,
    voiceConnected: sources.size > 0,
    reportConnected,
  }), [muted, reportConnected, sources, toggleMuted]);
  return <VoiceMuteContext.Provider value={value}>{children}</VoiceMuteContext.Provider>;
}

const FALLBACK: VoiceMuteValue = {
  muted: false,
  setMuted: () => {},
  toggleMuted: () => {},
  voiceConnected: false,
  reportConnected: () => {},
};

export function useVoiceMute(): VoiceMuteValue {
  return React.useContext(VoiceMuteContext) ?? FALLBACK;
}
