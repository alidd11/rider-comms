// Unverified scaffold — see src/navigation/index.tsx header note.
import * as React from 'react';
import { Platform, StatusBar } from 'react-native';
import * as NavigationBar from 'expo-navigation-bar';
import { registerGlobals } from '@livekit/react-native';
import { AppNavigator } from './src/navigation';

// LiveKit React Native requires the WebRTC globals before any room/client is created.
// Keep this at module bootstrap, outside React lifecycle, so every voice surface shares
// the same correctly-initialised runtime. Rider Comms owns AudioSession itself,
// so LiveKit's automatic iOS audio-session management must stay disabled.
registerGlobals({ autoConfigureAudioSession: false });

export default function App(): React.JSX.Element {
  React.useEffect(() => {
    if (Platform.OS === 'android') void NavigationBar.setStyle('light');
  }, []);

  return (
    <>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
      <AppNavigator />
    </>
  );
}
