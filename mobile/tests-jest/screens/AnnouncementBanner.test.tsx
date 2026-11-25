import * as React from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { Announcement } from '../../src/api/client';
import { ANNOUNCEMENT_CLOSED_KEY, ANNOUNCEMENT_REFRESH_MS, AnnouncementBanner, useAnnouncement } from '../../src/screens/AnnouncementBanner';

const winter: Announcement = { id: 'ann-1', title: 'Winter riding', body: 'Roads are icy this week.', tone: 'warning', endsAt: Date.now() + 3_600_000 };

function Harness({ load }: { load: () => Promise<{ announcement: Announcement | null }> }): React.JSX.Element | null {
  const { announcement, close } = useAnnouncement(load);
  return announcement ? <AnnouncementBanner announcement={announcement} top={0} onClose={close} /> : null;
}

const flush = async () => { await act(async () => { for (let i = 0; i < 5; i += 1) await Promise.resolve(); }); };

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test('shows the announcement and keeps it closed once the rider closes it', async () => {
  const load = jest.fn().mockResolvedValue({ announcement: winter });
  const view = await render(<Harness load={load} />);
  await flush();
  expect(screen.getByText('Winter riding')).toBeTruthy();
  expect(screen.getByText('Roads are icy this week.')).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByRole('button', { name: 'Close announcement' })); });
  await flush();
  expect(screen.queryByTestId('announcement-banner')).toBeNull();
  expect(await AsyncStorage.getItem(ANNOUNCEMENT_CLOSED_KEY)).toBe('ann-1');
  await view.unmount();

  // Closed stays closed after the app starts again; a new one shows.
  await render(<Harness load={load} />);
  await flush();
  expect(screen.queryByTestId('announcement-banner')).toBeNull();
  load.mockResolvedValue({ announcement: { ...winter, id: 'ann-2', tone: 'info', title: 'Meet-up Sunday' } });
  await act(async () => { jest.advanceTimersByTime(ANNOUNCEMENT_REFRESH_MS); });
  await flush();
  expect(screen.getByText('Meet-up Sunday')).toBeTruthy();
});

test('checks again when the app comes back, and keeps showing it if a check fails', async () => {
  let onChange: ((state: string) => void) | undefined;
  const remove = jest.fn();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
    onChange = handler as (state: string) => void;
    return { remove } as unknown as ReturnType<typeof AppState.addEventListener>;
  });
  const load = jest.fn().mockResolvedValueOnce({ announcement: null });
  const view = await render(<Harness load={load} />);
  await flush();
  expect(screen.queryByTestId('announcement-banner')).toBeNull();
  load.mockResolvedValueOnce({ announcement: winter });
  await act(async () => { onChange?.('background'); });
  expect(load).toHaveBeenCalledTimes(1);
  await act(async () => { onChange?.('active'); });
  await flush();
  expect(screen.getByText('Winter riding')).toBeTruthy();
  load.mockRejectedValueOnce(new Error('offline'));
  await act(async () => { jest.advanceTimersByTime(ANNOUNCEMENT_REFRESH_MS); });
  await flush();
  expect(screen.getByText('Winter riding')).toBeTruthy();
  await view.unmount();
  expect(remove).toHaveBeenCalled();
});

test('shows nothing that has already ended, or when storage cannot be read', async () => {
  jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('no storage'));
  const load = jest.fn().mockResolvedValue({ announcement: { ...winter, endsAt: Date.now() - 1 } });
  await render(<Harness load={load} />);
  await flush();
  expect(screen.queryByTestId('announcement-banner')).toBeNull();
});

test('an information notice uses the accent colour, a warning the warning colour', async () => {
  const view = await render(<AnnouncementBanner announcement={{ ...winter, tone: 'info' }} top={10} onClose={() => undefined} />);
  const info = screen.getByTestId('announcement-banner').props.style;
  await view.rerender(<AnnouncementBanner announcement={winter} top={10} onClose={() => undefined} />);
  const warning = screen.getByTestId('announcement-banner').props.style;
  expect(JSON.stringify(info)).not.toEqual(JSON.stringify(warning));
});
