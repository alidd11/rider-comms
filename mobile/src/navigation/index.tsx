// Unverified in this sandbox: React Native/Expo aren't installed here (no
// npm registry access), so this file has never actually been run. Written
// to be correct against @react-navigation's real v7 API — review against
// the installed version once you're on a real dev machine.
import * as React from 'react';
import { DarkTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { MapScreen } from '../screens/MapScreen';
import { GroupRideScreen } from '../screens/GroupRideScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { CreateRideScreen } from '../screens/CreateRideScreen';
import { RideProvider } from '../ride/RideContext';
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
  Map: undefined;
  GroupRide: undefined;
  Profile: undefined;
};

export type RootStackParamList = {
  Tabs: undefined;
  CreateRide: undefined;
};

const Tab = createBottomTabNavigator<TabParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();

const TAB_ICONS: Record<keyof TabParamList, keyof typeof Ionicons.glyphMap> = {
  Map: 'radio',
  GroupRide: 'people',
  Profile: 'person',
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
        tabBarIcon: ({ color, size }) => <Ionicons name={TAB_ICONS[route.name]} size={size} color={color} />,
      })}
    >
      <Tab.Screen name="Map" component={MapScreen} options={{ title: 'Public' }} />
      <Tab.Screen name="GroupRide" component={GroupRideScreen} options={{ title: 'Group Ride' }} />
      <Tab.Screen name="Profile" component={ProfileScreen} options={{ title: 'Profile' }} />
    </Tab.Navigator>
  );
}

export function AppNavigator(): React.JSX.Element {
  return (
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
  );
}
