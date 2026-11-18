// Bottom sheets follow the finger down and close past a threshold or on a
// quick flick, springing back otherwise, as system sheets do. Attach the
// handlers to the sheet's grab area (handle and header), not to scrolling
// content, so lists inside still scroll.
import * as React from 'react';
import { Animated, PanResponder, type GestureResponderHandlers, type PanResponderGestureState } from 'react-native';

export const DISMISS_DISTANCE = 90;
export const DISMISS_VELOCITY = 1.2;

/** Whether a drag should close the sheet. */
export function shouldDismissSheet(gesture: Pick<PanResponderGestureState, 'dy' | 'vy'>): boolean {
  return gesture.dy > DISMISS_DISTANCE || (gesture.dy > 20 && gesture.vy > DISMISS_VELOCITY);
}

export function useDragToDismiss(onDismiss: () => void): {
  translateY: Animated.Value;
  panHandlers: GestureResponderHandlers;
} {
  const translateY = React.useRef(new Animated.Value(0)).current;
  const onDismissRef = React.useRef(onDismiss);
  onDismissRef.current = onDismiss;
  const responder = React.useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => gesture.dy > 6 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
    onPanResponderMove: (_event, gesture) => translateY.setValue(Math.max(0, gesture.dy)),
    onPanResponderRelease: (_event, gesture) => {
      if (shouldDismissSheet(gesture)) {
        Animated.timing(translateY, { toValue: 800, duration: 160, useNativeDriver: true }).start(() => {
          translateY.setValue(0);
          onDismissRef.current();
        });
      } else {
        Animated.spring(translateY, { toValue: 0, useNativeDriver: true, bounciness: 6 }).start();
      }
    },
    onPanResponderTerminate: () => {
      Animated.spring(translateY, { toValue: 0, useNativeDriver: true, bounciness: 6 }).start();
    },
  })).current;
  return { translateY, panHandlers: responder.panHandlers };
}

/** The grab area: a sheet's handle bar with a finger-sized zone around it. */
export const SHEET_GRAB_ZONE = { alignSelf: 'stretch', alignItems: 'center', paddingVertical: 10, marginTop: -10, marginBottom: -4 } as const;
