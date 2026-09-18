// Unverified scaffold — see src/navigation/index.tsx header note.
import * as React from 'react';
import { Platform, StatusBar, useColorScheme } from 'react-native';
import * as NavigationBar from 'expo-navigation-bar';
import { AppNavigator } from './src/navigation';

export default function App(): React.JSX.Element {
  const scheme = useColorScheme();

  React.useEffect(() => {
    if (Platform.OS === 'android') void NavigationBar.setStyle(scheme === 'light' ? 'dark' : 'light');
  }, [scheme]);

  return (
    <>
      <StatusBar style={scheme === 'light' ? 'dark' : 'light'} />
      <AppNavigator />
    </>
  );
}
