// Unverified scaffold — see src/navigation/index.tsx header note.
import * as React from 'react';
import { Platform } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as NavigationBar from 'expo-navigation-bar';
import { AppNavigator } from './src/navigation';

// Every screen paints its own full-bleed dark background and pads for
// react-native-safe-area-context's insets itself (see navigation/index.tsx's
// header note). Edge-to-edge is mandatory on this Expo SDK (there is no
// opt-out — the app always draws behind the status bar and Android nav
// bar), so the only thing left to configure is icon/text contrast against
// that dark background, via `style="light"` on both bars.
if (Platform.OS === 'android') {
  NavigationBar.setStyle('light');
}

export default function App(): React.JSX.Element {
  return (
    <>
      <StatusBar style="light" />
      <AppNavigator />
    </>
  );
}
