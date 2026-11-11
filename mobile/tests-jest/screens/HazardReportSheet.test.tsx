import * as React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { HAZARD_AUTO_CLOSE_SECONDS, HazardReportSheet } from '../../src/screens/HazardReportSheet';
import { VoiceMuteProvider, useVoiceMute } from '../../src/voice/VoiceMuteContext';

const SAFE_AREA_METRICS = {
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
  frame: { x: 0, y: 0, width: 320, height: 640 },
};

describe('HazardReportSheet', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('closes itself when no hazard is picked, matching the PWA', () => {
    const onClose = jest.fn();
    render(
      <SafeAreaProvider initialMetrics={SAFE_AREA_METRICS}>
        <HazardReportSheet visible onClose={onClose} onReport={jest.fn()} />
      </SafeAreaProvider>,
    );
    expect(screen.getByText(`Closes in ${HAZARD_AUTO_CLOSE_SECONDS} seconds if you don’t pick one.`)).toBeTruthy();
    act(() => { jest.advanceTimersByTime(3_000); });
    expect(screen.getByText(`Closes in ${HAZARD_AUTO_CLOSE_SECONDS - 3} seconds if you don’t pick one.`)).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    act(() => { jest.advanceTimersByTime((HAZARD_AUTO_CLOSE_SECONDS - 3) * 1_000); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not run the countdown while hidden', () => {
    const onClose = jest.fn();
    render(
      <SafeAreaProvider initialMetrics={SAFE_AREA_METRICS}>
        <HazardReportSheet visible={false} onClose={onClose} onReport={jest.fn()} />
      </SafeAreaProvider>,
    );
    act(() => { jest.advanceTimersByTime(30_000); });
    expect(onClose).not.toHaveBeenCalled();
  });
});

function MuteProbe(): React.JSX.Element {
  const { muted, toggleMuted, voiceConnected, reportConnected } = useVoiceMute();
  return (
    <>
      <Text>{`muted:${muted} connected:${voiceConnected}`}</Text>
      <Pressable accessibilityRole="button" onPress={toggleMuted}><Text>toggle</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={() => reportConnected('ride', true)}><Text>ride-on</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={() => reportConnected('ride', false)}><Text>ride-off</Text></Pressable>
    </>
  );
}

describe('VoiceMuteContext', () => {
  it('shares one mute across voice surfaces and tracks whether any room is connected', () => {
    render(<VoiceMuteProvider><MuteProbe /></VoiceMuteProvider>);
    expect(screen.getByText('muted:false connected:false')).toBeTruthy();
    fireEvent.press(screen.getByText('ride-on'));
    fireEvent.press(screen.getByText('toggle'));
    expect(screen.getByText('muted:true connected:true')).toBeTruthy();
    fireEvent.press(screen.getByText('ride-off'));
    expect(screen.getByText('muted:true connected:false')).toBeTruthy();
  });
});
