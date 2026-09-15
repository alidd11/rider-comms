// Unverified in this sandbox: React Native/Expo aren't installed here (no
// npm registry access), so this file has never actually been run. Written
// to be correct against @react-navigation's real v7 API — review against
// the installed version once you're on a real dev machine.
import * as React from 'react';
import { DarkTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { MapScreen } from '../screens/MapScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { CreateRideScreen } from '../screens/CreateRideScreen';
import { FriendsScreen } from '../screens/FriendsScreen';
import { FriendChatScreen } from '../screens/FriendChatScreen';
import { RideProvider } from '../ride/RideContext';
import { SettingsProvider } from '../settings/SettingsContext';
import { FriendsProvider } from '../friends/FriendsContext';
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
  Friends: undefined;
  Settings: undefined;
};

export type RootStackParamList = {
  Tabs: undefined;
  CreateRide: undefined;
  FriendChat: { riderId: string; displayName: string; avatarId: string };
};

const Tab = createBottomTabNavigator<TabParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();

const TAB_ICONS: Record<keyof TabParamList, (color: string, size: number) => React.ReactNode> = {
  Map: (color, size) => <MaterialCommunityIcons name="motorbike" size={size} color={color} />,
  GroupRide: (color, size) => <Ionicons name="people" size={size} color={color} />,
  // Distinct from GroupRide's plain "people" glyph — this one reads as
  // "add a person" so the two tabs aren't visually interchangeable.
  Friends: (color, size) => <Ionicons name="person-add" size={size} color={color} />,
  Settings: (color, size) => <Ionicons name="settings" size={size} color={color} />,
};

function Tabs(): React.JSX.Element {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        // The Stack screen wrapping this tab navigator already has its own
        // header hidden (see `Tabs` below) — but bottom-tabs renders its
        // OWN independent header unless told not to, so leaving this unset
        // was still showing a plain title bar above every tab's content.
        // Every tab screen here builds its own top chrome, so none of them
        // need it.
        headerShown: false,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarIcon: ({ color, size }) => TAB_ICONS[route.name](color, size),
      })}
    >
      {/* Tapping "Map" always forces the segment back to 'public', not just
          "focus whatever the Map route was last showing" — otherwise
          leaving it on Host (via the Group Ride tab, or the in-screen
          toggle) makes the Map tab look permanently stuck on the host
          form with no obvious way back. */}
      <Tab.Screen
        name="Map"
        component={MapScreen}
        options={{ title: 'Map' }}
        listeners={({ navigation }) => ({
          tabPress: (e) => {
            e.preventDefault();
            navigation.navigate('Map', { segment: 'public', at: Date.now() });
          },
        })}
      />
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
      <Tab.Screen name="Friends" component={FriendsScreen} options={{ title: 'Friends' }} />
      <Tab.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />
    </Tab.Navigator>
  );
}

export function AppNavigator(): React.JSX.Element {
  return (
    // Every screen in this app hides the native nav header and builds its
    // own top chrome instead — which means every one of them is otherwise
    // on the hook for not rendering under the status bar/notch itself.
    // SafeAreaProvider is what makes useSafeAreaInsets() (used by
    // MapScreen's floating toggle/error banner, and every screen's top
    // padding) return real numbers instead of all zeros.
    <SafeAreaProvider>
      <SettingsProvider>
        <RideProvider>
          <FriendsProvider>
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
                {/* A normal push, not a modal — this is primary navigation from
                    the Friends list, not a transient action sheet. This app
                    hides nav headers everywhere, so the screen builds its own
                    in-content back chevron instead of relying on one here. */}
                <Stack.Screen
                  name="FriendChat"
                  component={FriendChatScreen}
                  options={{ presentation: 'card', headerShown: false }}
                />
              </Stack.Navigator>
            </NavigationContainer>
          </FriendsProvider>
        </RideProvider>
      </SettingsProvider>
    </SafeAreaProvider>
  );
}
