import * as React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import type { PlaceSuggestionSummary, PlaceSummary } from '../../src/api/client';
import { PLACE_SUGGEST_DEBOUNCE_MS } from '../../src/api/places';
import { PlaceSearchBar } from '../../src/screens/PlaceSearchBar';

const NEAR = { lat: 51.5, lon: -0.1 };
const SAFE_AREA_METRICS = {
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
  frame: { x: 0, y: 0, width: 320, height: 640 },
};

const mockClient = {
  searchPlaces: jest.fn<Promise<{ places: PlaceSummary[] }>, [string, { lat: number; lon: number }]>(),
  searchNearbyPlaces: jest.fn<Promise<{ places: PlaceSummary[] }>, [readonly string[], { lat: number; lon: number }]>(),
  suggestPlaces: jest.fn<Promise<{ suggestions: PlaceSuggestionSummary[] }>, [string, { lat: number; lon: number }, string]>(),
  placeDetails: jest.fn<Promise<{ place: PlaceSummary }>, [string, string]>(),
};
let mockVoiceConnected = false;

jest.mock('../../src/auth/AuthContext', () => ({
  useAuth: () => ({ riderId: 'rider-1', client: mockClient }),
}));
jest.mock('../../src/settings/SettingsContext', () => ({
  useSettings: () => ({ unitSystem: 'km' }),
}));
jest.mock('../../src/voice/VoiceMuteContext', () => ({
  useVoiceMute: () => ({ voiceConnected: mockVoiceConnected }),
}));

type MockSpeech = typeof ExpoSpeechRecognitionModule & {
  isRecognitionAvailable: jest.Mock;
  requestPermissionsAsync: jest.Mock;
  start: jest.Mock;
  abort: jest.Mock;
  __emit: (name: string, event: unknown) => void;
};
const speech = ExpoSpeechRecognitionModule as MockSpeech;

async function renderOpenSearch(): Promise<void> {
  await render(
    <SafeAreaProvider initialMetrics={SAFE_AREA_METRICS}>
      <PlaceSearchBar near={NEAR} onSelect={jest.fn()} onRequestLocation={jest.fn(async () => undefined)} />
    </SafeAreaProvider>,
  );
  await act(async () => {});
  await fireEvent.press(screen.getByLabelText('Where to?'));
}

async function emit(name: string, event: unknown = {}): Promise<void> {
  await act(async () => { speech.__emit(name, event); });
}

beforeEach(() => {
  jest.useFakeTimers();
  mockVoiceConnected = false;
  speech.isRecognitionAvailable.mockReset().mockReturnValue(true);
  speech.requestPermissionsAsync.mockReset().mockResolvedValue({ granted: true });
  speech.start.mockReset();
  speech.abort.mockReset();
  mockClient.suggestPlaces.mockReset().mockResolvedValue({ suggestions: [{ id: 'ace', name: 'Ace Cafe London', address: 'North Circular Road' }] });
});

test('the mic fills the search box with what the rider says', async () => {
  await renderOpenSearch();
  await fireEvent.press(screen.getByLabelText('Search by voice'));
  await act(async () => {});
  expect(speech.start).toHaveBeenCalledWith(expect.objectContaining({ interimResults: true }));
  expect(screen.getByLabelText('Stop listening')).toBeTruthy();

  await emit('result', { results: [{ transcript: ' ace cafe ' }] });
  await emit('end');
  expect(screen.getByDisplayValue('ace cafe')).toBeTruthy();
  expect(screen.getByLabelText('Search by voice')).toBeTruthy();
  await act(async () => { jest.advanceTimersByTime(PLACE_SUGGEST_DEBOUNCE_MS); });
  expect(mockClient.suggestPlaces).toHaveBeenCalledWith('ace cafe', NEAR, expect.any(String));
  expect(await screen.findByText('Ace Cafe London')).toBeTruthy();
});

test('an empty result changes nothing, and tapping again stops listening', async () => {
  await renderOpenSearch();
  await fireEvent.press(screen.getByLabelText('Search by voice'));
  await act(async () => {});
  await emit('result', { results: [] });
  expect(screen.queryByDisplayValue(/./)).toBeNull();
  await fireEvent.press(screen.getByLabelText('Stop listening'));
  expect(speech.abort).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText('Search by voice')).toBeTruthy();
});

test('a refused microphone says so', async () => {
  speech.requestPermissionsAsync.mockResolvedValue({ granted: false });
  await renderOpenSearch();
  await fireEvent.press(screen.getByLabelText('Search by voice'));
  await act(async () => {});
  expect(speech.start).not.toHaveBeenCalled();
  expect(screen.getByText('Allow the microphone and speech recognition to search by voice')).toBeTruthy();
  expect(screen.getByLabelText('Search by voice')).toBeTruthy();
});

test('a failed permission request asks the rider to try again', async () => {
  speech.requestPermissionsAsync.mockRejectedValue(new Error('boom'));
  await renderOpenSearch();
  await fireEvent.press(screen.getByLabelText('Search by voice'));
  await act(async () => {});
  expect(screen.getByText('Couldn’t hear that. Try again or type instead.')).toBeTruthy();
});

test('stopping before permission comes back never starts listening', async () => {
  let grant: (value: { granted: boolean }) => void = () => {};
  speech.requestPermissionsAsync.mockReturnValue(new Promise((resolve) => { grant = resolve; }));
  await renderOpenSearch();
  await fireEvent.press(screen.getByLabelText('Search by voice'));
  await fireEvent.press(screen.getByLabelText('Stop listening'));
  await act(async () => { grant({ granted: true }); });
  expect(speech.start).not.toHaveBeenCalled();
});

test('recognition errors: permission, quiet and other failures', async () => {
  await renderOpenSearch();
  await fireEvent.press(screen.getByLabelText('Search by voice'));
  await act(async () => {});
  await emit('error', { error: 'not-allowed' });
  expect(screen.getByText('Allow the microphone and speech recognition to search by voice')).toBeTruthy();

  await fireEvent.press(screen.getByLabelText('Search by voice'));
  await act(async () => {});
  expect(screen.queryByText(/Allow the microphone/)).toBeNull();
  await emit('error', { error: 'no-speech' });
  expect(screen.queryByText(/Couldn’t hear that/)).toBeNull();

  await fireEvent.press(screen.getByLabelText('Search by voice'));
  await act(async () => {});
  await emit('error', { error: 'network' });
  expect(screen.getByText('Couldn’t hear that. Try again or type instead.')).toBeTruthy();
  expect(screen.getByLabelText('Search by voice')).toBeTruthy();
});

test('closing search stops listening', async () => {
  await renderOpenSearch();
  await fireEvent.press(screen.getByLabelText('Search by voice'));
  await act(async () => {});
  await fireEvent.press(screen.getByLabelText('Back to map'));
  expect(speech.abort).toHaveBeenCalled();
});

test('leaving the screen while listening stops it', async () => {
  await renderOpenSearch();
  await fireEvent.press(screen.getByLabelText('Search by voice'));
  await act(async () => {});
  await act(async () => { screen.unmount(); });
  expect(speech.abort).toHaveBeenCalled();
});

test('no mic while a voice room is connected', async () => {
  mockVoiceConnected = true;
  await renderOpenSearch();
  expect(screen.queryByLabelText('Search by voice')).toBeNull();
});

test('no mic where the phone has no speech recognition', async () => {
  speech.isRecognitionAvailable.mockImplementation(() => { throw new Error('no module'); });
  await renderOpenSearch();
  expect(screen.queryByLabelText('Search by voice')).toBeNull();
});
