import { AppState } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';

const track = { title: 'Song', artist: 'Band', playing: true, source: 'apple-music', appName: 'Music' };
let mockAccess = 'granted';
const mockNowPlaying = jest.fn(async () => ({ ...track }));
jest.mock('../../src/audio/mediaControlsNative', () => ({
  mediaControls: {
    canShowNowPlaying: true,
    nowPlayingAccess: () => mockAccess,
    nowPlaying: () => mockNowPlaying(),
  },
}));

import { useNowPlaying } from '../../src/components/NowPlayingCard';

let appStateListener: ((state: string) => void) | null = null;

beforeEach(() => {
  jest.useFakeTimers();
  mockAccess = 'granted';
  mockNowPlaying.mockClear();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    appStateListener = listener as (state: string) => void;
    return { remove: jest.fn() } as never;
  });
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test('polls while enabled and keeps the same object while nothing changed', async () => {
  const { result } = await renderHook(() => useNowPlaying(true));
  await act(async () => { appStateListener?.('active'); await Promise.resolve(); });
  const first = result.current.nowPlaying;
  expect(first).toMatchObject({ title: 'Song' });
  await act(async () => { jest.advanceTimersByTime(3000); await Promise.resolve(); });
  expect(mockNowPlaying).toHaveBeenCalledTimes(2);
  expect(result.current.nowPlaying).toBe(first);

  mockNowPlaying.mockResolvedValueOnce({ ...track, title: 'Next song' });
  await act(async () => { jest.advanceTimersByTime(3000); await Promise.resolve(); });
  expect(result.current.nowPlaying).toMatchObject({ title: 'Next song' });
});

test('shows nothing without access or while disabled, and re-checks access on return', async () => {
  mockAccess = 'denied';
  const { result, rerender } = await renderHook((props: { enabled: boolean }) => useNowPlaying(props.enabled), { initialProps: { enabled: true } });
  expect(result.current.access).toBe('denied');
  expect(result.current.nowPlaying).toBeNull();
  expect(mockNowPlaying).not.toHaveBeenCalled();

  mockAccess = 'granted';
  await act(async () => { appStateListener?.('active'); await Promise.resolve(); });
  expect(result.current.access).toBe('granted');
  expect(mockNowPlaying).toHaveBeenCalled();

  await rerender({ enabled: false });
  expect(result.current.nowPlaying).toBeNull();
  await act(async () => { result.current.refresh(); });
  expect(result.current.access).toBe('granted');
});
