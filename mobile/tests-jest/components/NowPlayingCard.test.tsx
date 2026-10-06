import * as React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

const mockControl = jest.fn(async (_key: string) => true);
jest.mock('../../src/audio/mediaControlsNative', () => ({
  mediaControls: { control: (key: string) => mockControl(key) },
}));

import { NowPlayingCard } from '../../src/components/NowPlayingCard';

const track = { title: 'Song', artist: 'Band', playing: true, source: 'com.spotify.music', appName: 'Spotify' };

beforeEach(() => {
  mockControl.mockClear();
  jest.useFakeTimers();
});
afterEach(() => jest.useRealTimers());

test('shows the track and controls it', async () => {
  const onChanged = jest.fn();
  await render(<NowPlayingCard nowPlaying={track} controlsLocked={false} onChanged={onChanged} />);
  expect(screen.getByText('Song')).toBeTruthy();
  expect(screen.getByText('Band · Spotify')).toBeTruthy();
  expect(screen.getByLabelText('Now playing: Song by Band')).toBeTruthy();

  await act(async () => { fireEvent.press(screen.getByLabelText('Pause music')); });
  expect(mockControl).toHaveBeenCalledWith('playPause');
  await act(async () => { jest.advanceTimersByTime(600); });
  expect(onChanged).toHaveBeenCalled();

  await act(async () => { fireEvent.press(screen.getByLabelText('Next track')); });
  expect(mockControl).toHaveBeenLastCalledWith('next');
});

test('shows only the track while Ride Safe has the controls locked', async () => {
  await render(<NowPlayingCard nowPlaying={{ ...track, playing: false }} controlsLocked onChanged={() => {}} />);
  expect(screen.getByText('Song')).toBeTruthy();
  expect(screen.queryByLabelText('Play music')).toBeNull();
  expect(screen.queryByLabelText('Next track')).toBeNull();
});
