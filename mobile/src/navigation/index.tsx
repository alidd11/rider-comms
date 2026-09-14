// Unverified in this sandbox: React Native/Expo aren't installed here (no
// npm registry access), so this file has never actually been run. Written
// to be correct against @react-navigation's real v7 API — review against
// the installed version once you're on a real dev machine.
import * as React from 'react';
import { DarkTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { MapScreen } from '../screens/MapScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { CreateRideScreen } from '../screens/CreateRideScreen';
import { RideProvider } from '../ride/RideContext';
import { SettingsProvider } from '../settings/SettingsContext';
import { colors } from '../theme';

const navigationTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: colors.accent,
    background: colors.background,
    card: colors.surface,
    text: colors.textPrimary,
    border: colors.border,
  },
};

export type TabParamList = {
  // `at` is a change nonce, not app state — it exists only so tapping
  // "Group Ride" again with the same target segment still re-fires the
  // param-change effect in MapScreen (a repeated identical string value
  // wouldn't, since nothing else about the params changed).
  Map: { segment?: 'public' | 'host'; at?: number } | undefined;
  GroupRide: undefined;
  Settings: undefined;
};

export type RootStackParamList = {
  Tabs: undefined;
  CreateRide: undefined;
};

const Tab = createBottomTabNavigator<TabParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();

const TAB_ICONS: Record<keyof TabParamList, (color: string, size: number) => React.ReactNode> = {
  Map: (color, size) => <MaterialCommunityIcons name="motorbike" size={size} color={color} />,
  GroupRide: (color, size) => <Ionicons name="people" size={size} color={color} />,
  Settings: (color, size) => <Ionicons name="settings" size={size} color={color} />,
};

function Tabs(): React.JSX.Element {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerStyle: { backgroundColor: colors.surface },
        headerTitleStyle: { color: colors.textPrimary },
        headerTintColor: colors.accent,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarIcon: ({ color, size }) => TAB_ICONS[route.name](color, size),
      })}
    >
      <Tab.Screen name="Map" component={MapScreen} options={{ title: 'Map' }} />
      {/* Not a second screen/mount: tapping this tab redirects straight to
          the Map route with segment: 'host' params instead of navigating
          here, so there's still only ever one mounted map instance. */}
      <Tab.Screen
        name="GroupRide"
        component={MapScreen}
        options={{ title: 'Group Ride' }}
        listeners={({ navigation }) => ({
          tabPress: (e) => {
            e.preventDefault();
            navigation.navigate('Map', { segment: 'host', at: Date.now() });
          },
        })}
      />
      <Tab.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />
    </Tab.Navigator>
  );
}

export function AppNavigator(): React.JSX.Element {
  return (
    <SettingsProvider>
      <RideProvider>
        <NavigationContainer theme={navigationTheme}>
          <Stack.Navigator
            screenOptions={{
              headerStyle: { backgroundColor: colors.surface },
              headerTitleStyle: { color: colors.textPrimary },
              headerTintColor: colors.accent,
              contentStyle: { backgroundColor: colors.background },
            }}
          >
            <Stack.Screen name="Tabs" component={Tabs} options={{ headerShown: false }} />
            <Stack.Screen
              name="CreateRide"
              component={CreateRideScreen}
              options={{ title: 'Start a Ride', presentation: 'modal' }}
            />
          </Stack.Navigator>
        </NavigationContainer>
      </RideProvider>
    </SettingsProvider>
  );
}
