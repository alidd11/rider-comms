import * as React from 'react';
import { Platform } from 'react-native';
import * as LiveActivity from 'expo-live-activity';
import {
  NavigationLiveActivity,
  navigationLiveActivityContent,
  type LiveActivityApi,
  type NavigationLiveActivityInput,
} from '../navigationLiveActivity';

const api: LiveActivityApi | null = Platform.OS === 'ios'
  ? {
    startActivity: (state, config) => LiveActivity.startActivity(state, config as LiveActivity.LiveActivityConfig),
    updateActivity: (id, state) => LiveActivity.updateActivity(id, state),
    stopActivity: (id, state) => LiveActivity.stopActivity(id, state),
  }
  : null;

/**
 * Mirrors turn-by-turn onto the iPhone lock screen and Dynamic Island while
 * navigation runs (it keeps updating with the screen locked, because the
 * navigation location feed keeps JS running). Ends when navigation does.
 */
export function useNavigationLiveActivity(input: NavigationLiveActivityInput | null, arrived: boolean): void {
  const activity = React.useRef<NavigationLiveActivity | null>(null);
  if (!activity.current) activity.current = new NavigationLiveActivity(api);
  const arrivedRef = React.useRef(arrived);
  arrivedRef.current = arrived;

  const key = input ? JSON.stringify(navigationLiveActivityContent(input)) : null;
  React.useEffect(() => {
    if (key && input) activity.current?.update(navigationLiveActivityContent(input));
    else activity.current?.stop(arrivedRef.current ? 'You have arrived' : undefined);
    // `key` captures every field of `input` that reaches the lock screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  React.useEffect(() => () => activity.current?.stop(), []);
}
