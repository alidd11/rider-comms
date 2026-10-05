import * as React from 'react';
import { Platform, StatusBar, useColorScheme } from 'react-native';
import * as NavigationBar from 'expo-navigation-bar';
import { registerGlobals } from '@livekit/react-native';
import { AppNavigator } from './src/navigation';
import { AppErrorBoundary } from './src/errors/AppErrorBoundary';
import { installGlobalErrorHandler, installUnhandledRejectionReporter } from './src/errors/errorReporting';
// Importing it also defines the background navigation location task, which
// has to happen as the bundle loads.
import { stopStaleNavigationLocationUpdates } from './src/navigationLocationStream';

// LiveKit React Native requires the WebRTC globals before any room/client is created.
// Keep this at module bootstrap, outside React lifecycle, so every voice surface shares
// the same correctly-initialised runtime. Rider Comms owns AudioSession itself,
// so LiveKit's automatic iOS audio-session management must stay disabled.
registerGlobals({ autoConfigureAudioSession: false });
installGlobalErrorHandler();
installUnhandledRejectionReporter();
void stopStaleNavigationLocationUpdates().catch(() => {});

export default function App(): React.JSX.Element {
  const scheme = useColorScheme();

  React.useEffect(() => {
    if (Platform.OS === 'android') void NavigationBar.setStyle(scheme === 'light' ? 'dark' : 'light');
  }, [scheme]);


  return (
    <>
      <StatusBar barStyle={scheme === 'light' ? 'dark-content' : 'light-content'} translucent backgroundColor="transparent" />
      <AppErrorBoundary>
        <AppNavigator />
      </AppErrorBoundary>
    </>
  );
}
