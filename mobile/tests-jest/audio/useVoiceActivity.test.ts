import { act, renderHook } from '@testing-library/react-native';
import { useVoiceActivity } from '../../src/audio/useVoiceActivity';

const mockUseConnectionState = jest.fn();
const mockUseLocalParticipant = jest.fn();
const mockUseTrackVolume = jest.fn();

jest.mock('@livekit/react-native', () => ({
  useConnectionState: () => mockUseConnectionState(),
  useLocalParticipant: () => mockUseLocalParticipant(),
  useTrackVolume: (...args: unknown[]) => mockUseTrackVolume(...args),
}));

const mockCreateLocalAudioTrack = jest.fn();

jest.mock('livekit-client', () => ({
  ConnectionState: { Connected: 'connected', Disconnected: 'disconnected' },
  createLocalAudioTrack: (...args: unknown[]) => mockCreateLocalAudioTrack(...args),
}));

const CONNECTED = 'connected';
const DISCONNECTED = 'disconnected';

function fakeTrack(overrides: Partial<{ mute: jest.Mock; unmute: jest.Mock; stop: jest.Mock }> = {}) {
  return {
    mute: jest.fn(async () => undefined),
    unmute: jest.fn(async () => undefined),
    stop: jest.fn(),
    ...overrides,
  };
}

function setParticipant(microphoneTrack: { track: ReturnType<typeof fakeTrack> } | undefined, publishTrack = jest.fn(async () => undefined)) {
  mockUseLocalParticipant.mockReturnValue({
    localParticipant: { publishTrack },
    microphoneTrack,
  });
  return publishTrack;
}

interface Props {
  enabled: boolean;
  onError?: (message: string) => void;
}

async function renderVoiceActivity(initialProps: Props) {
  return renderHook((props: Props) => useVoiceActivity(props.enabled, props.onError), { initialProps });
}

beforeEach(() => {
  jest.useFakeTimers();
  mockUseConnectionState.mockReturnValue(CONNECTED);
  mockUseTrackVolume.mockReturnValue(0);
  mockCreateLocalAudioTrack.mockReset();
  setParticipant(undefined);
});

afterEach(() => {
  jest.useRealTimers();
});

test('creates, mutes, and publishes a fresh microphone track when connected with none published yet', async () => {
  const track = fakeTrack();
  mockCreateLocalAudioTrack.mockResolvedValue(track);
  const publishTrack = setParticipant(undefined);

  await renderVoiceActivity({ enabled: true });
  await act(async () => {});

  expect(mockCreateLocalAudioTrack).toHaveBeenCalled();
  expect(track.mute).toHaveBeenCalled();
  expect(publishTrack).toHaveBeenCalledWith(track);
});

test('does not create a track when one is already published', async () => {
  setParticipant({ track: fakeTrack() });

  await renderVoiceActivity({ enabled: true });
  await act(async () => {});

  expect(mockCreateLocalAudioTrack).not.toHaveBeenCalled();
});

test('does not create a track while disconnected', async () => {
  mockUseConnectionState.mockReturnValue(DISCONNECTED);

  await renderVoiceActivity({ enabled: true });
  await act(async () => {});

  expect(mockCreateLocalAudioTrack).not.toHaveBeenCalled();
});

test('surfaces a specific error and stops the track when publishing setup fails', async () => {
  const track = fakeTrack({ mute: jest.fn(async () => { throw new Error('mute failed'); }) });
  mockCreateLocalAudioTrack.mockResolvedValue(track);
  const onError = jest.fn();

  await renderVoiceActivity({ enabled: true, onError });
  await act(async () => {});

  expect(onError).toHaveBeenCalledWith('mute failed');
  expect(track.stop).toHaveBeenCalled();
});

test('opens the mic after volume holds above the attack threshold for the hold window', async () => {
  const track = fakeTrack();
  setParticipant({ track });
  const { result, rerender } = await renderVoiceActivity({ enabled: true });
  expect(result.current).toBe(false);

  mockUseTrackVolume.mockReturnValue(0.05);
  await rerender({ enabled: true });
  expect(result.current).toBe(false);

  await act(async () => {
    jest.advanceTimersByTime(70);
  });

  expect(result.current).toBe(true);
  expect(track.unmute).toHaveBeenCalled();
});

test('does not open the mic if volume drops before the attack hold window elapses', async () => {
  const track = fakeTrack();
  setParticipant({ track });
  const { result, rerender } = await renderVoiceActivity({ enabled: true });

  mockUseTrackVolume.mockReturnValue(0.05);
  await rerender({ enabled: true });

  mockUseTrackVolume.mockReturnValue(0);
  await rerender({ enabled: true });

  await act(async () => {
    jest.advanceTimersByTime(70);
  });

  expect(result.current).toBe(false);
  expect(track.unmute).not.toHaveBeenCalled();
});

test('keeps the mic open through the release hangtime, then closes it once volume stays low', async () => {
  const track = fakeTrack();
  setParticipant({ track });
  const { result, rerender } = await renderVoiceActivity({ enabled: true });

  mockUseTrackVolume.mockReturnValue(0.05);
  await rerender({ enabled: true });
  await act(async () => {
    jest.advanceTimersByTime(70);
  });
  expect(result.current).toBe(true);

  mockUseTrackVolume.mockReturnValue(0);
  await rerender({ enabled: true });
  expect(result.current).toBe(true);

  await act(async () => {
    jest.advanceTimersByTime(649);
  });
  expect(result.current).toBe(true);

  await act(async () => {
    jest.advanceTimersByTime(1);
  });
  expect(result.current).toBe(false);
  expect(track.mute).toHaveBeenCalledTimes(2); // once before publish, once on release
});

test('cancels the release hangtime and stays open if volume rises again in time', async () => {
  const track = fakeTrack();
  setParticipant({ track });
  const { result, rerender } = await renderVoiceActivity({ enabled: true });

  mockUseTrackVolume.mockReturnValue(0.05);
  await rerender({ enabled: true });
  await act(async () => {
    jest.advanceTimersByTime(70);
  });
  expect(result.current).toBe(true);

  mockUseTrackVolume.mockReturnValue(0);
  await rerender({ enabled: true });
  await act(async () => {
    jest.advanceTimersByTime(400);
  });

  mockUseTrackVolume.mockReturnValue(0.05);
  await rerender({ enabled: true });
  await act(async () => {
    jest.advanceTimersByTime(650);
  });

  expect(result.current).toBe(true);
});

test('disabling immediately silences and clears pending timers regardless of volume', async () => {
  const track = fakeTrack();
  setParticipant({ track });
  const { result, rerender } = await renderVoiceActivity({ enabled: true });

  mockUseTrackVolume.mockReturnValue(0.05);
  await rerender({ enabled: true });
  await act(async () => {
    jest.advanceTimersByTime(70);
  });
  expect(result.current).toBe(true);

  await rerender({ enabled: false });

  expect(result.current).toBe(false);
  await act(async () => {
    jest.advanceTimersByTime(10_000);
  });
  expect(result.current).toBe(false);
});

test('surfaces a specific error when unmuting the track fails', async () => {
  const track = fakeTrack({ unmute: jest.fn(async () => { throw new Error('unmute failed'); }) });
  setParticipant({ track });
  const onError = jest.fn();
  const { rerender } = await renderVoiceActivity({ enabled: true, onError });

  mockUseTrackVolume.mockReturnValue(0.05);
  await rerender({ enabled: true, onError });
  await act(async () => {
    jest.advanceTimersByTime(70);
  });

  expect(onError).toHaveBeenCalledWith('unmute failed');
});
