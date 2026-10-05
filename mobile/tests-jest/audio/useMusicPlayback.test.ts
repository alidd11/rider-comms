import { act, renderHook } from '@testing-library/react-native';
import { audioEngine } from '../../src/audio/audioEngine';
import { useMusicPlayback } from '../../src/audio/useMusicPlayback';

let mockPlaying: boolean | null = true;
let mockPlaybackState = true;

jest.mock('../../src/audio/mediaControlsNative', () => ({
  mediaControls: {
    get capabilities() { return { buttons: false, playbackState: mockPlaybackState }; },
    isMusicPlaying: () => mockPlaying,
  },
}));

beforeEach(() => {
  jest.useFakeTimers();
  mockPlaying = true;
  mockPlaybackState = true;
  audioEngine.setMusicPlaying(false);
});

afterEach(() => {
  jest.useRealTimers();
});

test('reports music playing to the audio engine and follows changes', async () => {
  const { result } = await renderHook(() => useMusicPlayback(true));
  expect(result.current.playing).toBe(true);
  expect(audioEngine.getGains().music).toBeGreaterThan(0);

  mockPlaying = false;
  await act(async () => { jest.advanceTimersByTime(3_000); });
  expect(result.current.playing).toBe(false);
  expect(audioEngine.getGains().music).toBe(0);
});

test('clears music from the audio engine when the ride ends', async () => {
  const { rerender } = await renderHook(({ active }: { active: boolean }) => useMusicPlayback(active), { initialProps: { active: true } });
  expect(audioEngine.getGains().music).toBeGreaterThan(0);
  await rerender({ active: false });
  expect(audioEngine.getGains().music).toBe(0);
});

test('does nothing when the build can\'t read playback state', async () => {
  mockPlaybackState = false;
  const { result } = await renderHook(() => useMusicPlayback(true));
  expect(result.current.playing).toBeNull();
  expect(audioEngine.getGains().music).toBe(0);
});
