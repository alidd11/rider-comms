// Unverified scaffold — see src/navigation/index.tsx header note.
import * as React from 'react';
import { Image, InteractionManager, Platform, StatusBar, useColorScheme } from 'react-native';
import * as NavigationBar from 'expo-navigation-bar';
import { registerGlobals } from '@livekit/react-native';
import { AppNavigator } from './src/navigation';
import { CURATED_ROUTES } from './src/routes/curatedRoutes';
import { ROUTE_IMAGE_PREFETCH_COUNT, routeCardImageUri } from './src/routes/routeImages';

// LiveKit React Native requires the WebRTC globals before any room/client is created.
// Keep this at module bootstrap, outside React lifecycle, so every voice surface shares
// the same correctly-initialised runtime. Rider Comms owns AudioSession itself,
// so LiveKit's automatic iOS audio-session management must stay disabled.
registerGlobals({ autoConfigureAudioSession: false });

export default function App(): React.JSX.Element {
  const scheme = useColorScheme();

  React.useEffect(() => {
    if (Platform.OS === 'android') void NavigationBar.setStyle(scheme === 'light' ? 'dark' : 'light');
  }, [scheme]);

  React.useEffect(() => {
    let cancelled = false;
    const task = InteractionManager.runAfterInteractions(() => {
      if (cancelled) return;
      const routeCardUris = CURATED_ROUTES
        .slice(0, ROUTE_IMAGE_PREFETCH_COUNT)
        .map((route) => routeCardImageUri(route.image.uri));
      void Promise.allSettled(routeCardUris.map((uri) => Image.prefetch(uri)));
    });
    return () => {
      cancelled = true;
      task.cancel();
    };
  }, []);

  return (
    <>
      <StatusBar barStyle={scheme === 'light' ? 'dark-content' : 'light-content'} translucent backgroundColor="transparent" />
      <AppNavigator />
    </>
  );
}
