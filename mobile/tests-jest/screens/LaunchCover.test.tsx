import * as React from 'react';
import { AccessibilityInfo, Text } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';
import { LAUNCH_COVER_MAX_MS, LAUNCH_COVER_NO_FIX_MS, LaunchCover, resetLaunchCoverForTests } from '../../src/screens/LaunchCover';

jest.mock('../../src/auth/AuthContext', () => {
  const { Text: MockText } = jest.requireActual('react-native');
  return { AuthSplash: () => <MockText>RIDER COMMS</MockText> };
});

beforeEach(() => {
  jest.useFakeTimers();
  resetLaunchCoverForTests();
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const settle = async (ms: number) => { await act(async () => { jest.advanceTimersByTime(ms); await Promise.resolve(); await Promise.resolve(); }); };

test('covers the map until it has drawn at the rider’s position', async () => {
  const view = await render(<LaunchCover mapReady={false} hasFix={false} />);
  expect(screen.getByTestId('launch-cover', { includeHiddenElements: true })).toBeTruthy();
  await settle(1000);
  expect(screen.getByTestId('launch-cover', { includeHiddenElements: true })).toBeTruthy();
  await view.rerender(<LaunchCover mapReady hasFix />);
  await settle(299);
  expect(screen.getByTestId('launch-cover', { includeHiddenElements: true })).toBeTruthy();
  await settle(1);
  expect(screen.queryByTestId('launch-cover', { includeHiddenElements: true })).toBeNull();
});

test('shows the map without a fix shortly after it draws', async () => {
  await render(<LaunchCover mapReady hasFix={false} />);
  await settle(LAUNCH_COVER_NO_FIX_MS - 1);
  expect(screen.getByTestId('launch-cover', { includeHiddenElements: true })).toBeTruthy();
  await settle(1);
  expect(screen.queryByTestId('launch-cover', { includeHiddenElements: true })).toBeNull();
});

test('never holds the rider longer than the limit, and only once per launch', async () => {
  const first = await render(<LaunchCover mapReady={false} hasFix={false} />);
  await settle(LAUNCH_COVER_MAX_MS);
  expect(screen.queryByTestId('launch-cover', { includeHiddenElements: true })).toBeNull();
  await first.unmount();
  await render(<><LaunchCover mapReady={false} hasFix={false} /><Text>map</Text></>);
  expect(screen.queryByTestId('launch-cover', { includeHiddenElements: true })).toBeNull();
});

test('fades out when motion is allowed', async () => {
  (AccessibilityInfo.isReduceMotionEnabled as jest.Mock).mockResolvedValue(false);
  await render(<LaunchCover mapReady hasFix />);
  await settle(300);
  await settle(500);
  expect(screen.queryByTestId('launch-cover', { includeHiddenElements: true })).toBeNull();
});
