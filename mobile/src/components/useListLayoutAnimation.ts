import * as React from 'react';
import { AccessibilityInfo, LayoutAnimation } from 'react-native';

/** What changed in a list that should animate: the ids in order. */
export function listSignature(ids: readonly string[]): string {
  return ids.join('|');
}

/**
 * Rows slide and fade into place when a list gains, loses or reorders rows
 * (a friend request arrives or is accepted, a friend comes online), as in
 * Messages and WhatsApp. Not on first render, and not with Reduce Motion on.
 */
export function useListLayoutAnimation(signature: string): void {
  const previous = React.useRef<string | null>(null);
  const reduceMotion = React.useRef(false);
  React.useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => { reduceMotion.current = enabled; }).catch(() => undefined);
  }, []);
  // Configured during render so it applies to the layout this render commits.
  if (previous.current !== null && previous.current !== signature && !reduceMotion.current) {
    LayoutAnimation.configureNext(LayoutAnimation.create(220, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity));
  }
  previous.current = signature;
}
