import * as React from 'react';
import { Animated, PanResponder, View } from 'react-native';
import { render, act } from '@testing-library/react-native';
import { shouldDismissSheet, useDragToDismiss } from '../../src/components/useDragToDismiss';

test('a long pull or a quick flick closes the sheet; a nudge does not', () => {
  expect(shouldDismissSheet({ dy: 120, vy: 0.1 })).toBe(true);
  expect(shouldDismissSheet({ dy: 40, vy: 1.8 })).toBe(true);
  expect(shouldDismissSheet({ dy: 40, vy: 0.4 })).toBe(false);
  expect(shouldDismissSheet({ dy: 10, vy: 3 })).toBe(false);
  expect(shouldDismissSheet({ dy: -200, vy: -3 })).toBe(false);
});

function Sheet({ onDismiss, grab }: { onDismiss: () => void; grab: (handlers: ReturnType<typeof useDragToDismiss>) => void }) {
  const drag = useDragToDismiss(onDismiss);
  grab(drag);
  return <View {...drag.panHandlers} testID="grab" />;
}

const gesture = (dy: number, vy = 0, dx = 0) => ({ dx, dy, vx: 0, vy, moveX: 0, moveY: 0, x0: 0, y0: 0, numberActiveTouches: 1, stateID: 1 });
const event = { nativeEvent: { touches: [], changedTouches: [], identifier: 1, locationX: 0, locationY: 0, pageX: 0, pageY: 0, target: 1, timestamp: 0 } } as never;

test('dragging follows the finger, closes past the threshold and springs back otherwise', async () => {
  const onDismiss = jest.fn();
  const timing = jest.spyOn(Animated, 'timing').mockReturnValue({ start: (done?: (r: { finished: boolean }) => void) => done?.({ finished: true }), stop: jest.fn(), reset: jest.fn() } as never);
  const spring = jest.spyOn(Animated, 'spring').mockReturnValue({ start: jest.fn(), stop: jest.fn(), reset: jest.fn() } as never);
  // Reach the callbacks the hook gives PanResponder.create.
  type Callback = (e: unknown, g: ReturnType<typeof gesture>) => unknown;
  let callbacks: Record<string, Callback> = {};
  jest.spyOn(PanResponder, 'create').mockImplementation(((config: Record<string, Callback>) => {
    callbacks = config;
    return { panHandlers: {} };
  }) as never);
  let drag: ReturnType<typeof useDragToDismiss> | null = null;
  await render(<Sheet onDismiss={onDismiss} grab={(value) => { drag = value; }} />);
  expect(drag!.translateY).toBeInstanceOf(Animated.Value);

  expect(callbacks.onMoveShouldSetPanResponder!(event, gesture(12))).toBe(true);
  expect(callbacks.onMoveShouldSetPanResponder!(event, gesture(12, 0, 40))).toBe(false);
  callbacks.onPanResponderMove!(event, gesture(-30));
  callbacks.onPanResponderMove!(event, gesture(50));
  callbacks.onPanResponderRelease!(event, gesture(40));
  expect(spring).toHaveBeenCalledTimes(1);
  expect(onDismiss).not.toHaveBeenCalled();
  await act(async () => { callbacks.onPanResponderRelease!(event, gesture(140)); });
  expect(timing).toHaveBeenCalled();
  expect(onDismiss).toHaveBeenCalledTimes(1);
  callbacks.onPanResponderTerminate!(event, gesture(0));
  expect(spring).toHaveBeenCalledTimes(2);
  jest.restoreAllMocks();
});
