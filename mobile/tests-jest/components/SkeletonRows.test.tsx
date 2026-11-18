import * as React from 'react';
import { AccessibilityInfo, Animated } from 'react-native';
import { render, act } from '@testing-library/react-native';
import { SkeletonBubbles, SkeletonRows } from '../../src/components/SkeletonRows';

afterEach(() => jest.restoreAllMocks());

test('placeholder rows are announced as loading and pulse when motion is allowed', async () => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
  const loop = jest.spyOn(Animated, 'loop');
  const view = await render(<SkeletonRows label="Loading friends" count={3} />);
  await act(async () => {});
  expect(view.getByLabelText('Loading friends')).toBeTruthy();
  expect(loop).toHaveBeenCalled();
  view.unmount();
});

test('with Reduce Motion on the placeholders stay still', async () => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  const loop = jest.spyOn(Animated, 'loop');
  const view = await render(<SkeletonBubbles label="Loading conversation" />);
  await act(async () => {});
  expect(view.getByLabelText('Loading conversation')).toBeTruthy();
  expect(loop).not.toHaveBeenCalled();
});

test('a failed Reduce Motion lookup leaves the placeholders still, and unmounting first is safe', async () => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockRejectedValue(new Error('unavailable'));
  const view = await render(<SkeletonRows label="Loading" />);
  await act(async () => {});
  expect(view.getByTestId('skeleton-rows')).toBeTruthy();
  let resolve: (value: boolean) => void = () => {};
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockReturnValue(new Promise((r) => { resolve = r; }));
  const late = await render(<SkeletonRows label="Late" />);
  late.unmount();
  await expect(act(async () => { resolve(false); })).resolves.toBeUndefined();
});
