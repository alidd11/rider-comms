// Unverified in this sandbox: React Native/Expo aren't installed here (no
// npm registry access), so this file has never actually been run. Written
// to be correct against @react-navigation's real v7 API — review against
// the installed version once you're on a real dev machine.
import * as React from 'react';
import { Linking, View, Text, StyleSheet, useColorScheme } from 'react-native';
import { DarkTheme, DefaultTheme, NavigationContainer, useNavigationState } from '@react-navigation/native';
import type { LinkingOptions } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { MapScreen } from '../screens/MapScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { CreateRideScreen } from '../screens/CreateRideScreen';
import { FriendsScreen } from '../screens/FriendsScreen';
import { FriendChatScreen } from '../screens/FriendChatScreen';
import { ScenicRoutesScreen } from '../screens/ScenicRoutesScreen';
import { BillingScreen } from '../screens/BillingScreen';
import { LegalScreen } from '../screens/LegalScreen';
import { OnboardingScreen, ONBOARDING_COMPLETED_KEY } from '../screens/OnboardingScreen';
import { RideProvider } from '../ride/RideContext';
import { SettingsProvider } from '../settings/SettingsContext';
import { FriendsProvider } from '../friends/FriendsContext';
import { AuthProvider } from '../auth/AuthContext';
import { parseNavigationLink } from '../navigationLinks';
import { colors, useConcreteThemeColors } from '../theme';
import { MovementSafetyProvider, useMovementSafety } from '../safety/MovementSafetyContext';
import { RideSafeSurface } from '../safety/RideSafeSurface';

export type TabParamList = {
  // `at` is a change nonce, not app state — it exists only so tapping
  // "Group Ride" again with the same target segment still re-fires the
  // param-change effect in MapScreen (a repeated identical string value
  // wouldn't, since nothing else about the params changed).
  Map: {
    segment?: 'public' | 'host';
    at?: number;
    lat?: number;
    lon?: number;
    label?: string;
  } | undefined;
  GroupRide: undefined;
  Routes: undefined;
  Friends: undefined;
  Settings: undefined;
};

export type RootStackParamList = {
  Tabs: undefined;
  CreateRide: undefined;
  FriendChat: { riderId: string; displayName: string; avatarId: string };
  Billing: undefined;
  Legal: undefined;
};

const Tab = createBottomTabNavigator<TabParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();

const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ['ridercomms://', 'https://alidd11.github.io/rider-comms'],
  config: {
    screens: {
      Tabs: {
        screens: {
          Map: {
            path: 'navigate',
            parse: {
              lat: Number,
              lon: Number,
              label: String,
            },
          },
        },
      },
    },
  },
  async getInitialURL() {
    const url = await Linking.getInitialURL();
    return parseNavigationLink(url) ? url : null;
  },
  subscribe(listener) {
    const subscription = Linking.addEventListener('url', ({ url }) => {
      if (parseNavigationLink(url)) listener(url);
    });
    return () => subscription.remove();
  },
};

/**
 * Map and GroupRide share one mounted MapScreen instance (see the tabPress
 * listeners below) instead of being genuinely separate routes — so React
 * Navigation's own notion of which tab is "focused" only ever tracks Map,
 * even while the user is looking at the host view. This reads the Map
 * route's own `segment` param (the real source of truth for what's on
 * screen) out of the tab navigator's state, so both tabs' icon/label colors
 * can be driven by that instead of by the misleading built-in focus state.
 */
function useMapSegment(): 'public' | 'host' {
  return useNavigationState((state) => {
    const mapRoute = state.routes.find((r) => r.name === 'Map');
    return (mapRoute?.params as TabParamList['Map'])?.segment ?? 'public';
  });
}

function segmentTintColor(active: boolean): string {
  return active ? colors.accent : colors.textMuted;
}

function TabIconShell({ active, children }: { active: boolean; children: React.ReactNode }): React.JSX.Element {
  return <View style={[styles.tabIconShell, active && styles.tabIconShellActive]}>{children}</View>;
}

function MapTabIcon({ size }: { size: number }): React.JSX.Element {
  const active = useMapSegment() === 'public';
  return (
    <TabIconShell active={active}>
      <MaterialCommunityIcons name="map-outline" size={size} color={segmentTintColor(active)} />
    </TabIconShell>
  );
}

function GroupRideTabIcon({ size }: { size: number }): React.JSX.Element {
  const active = useMapSegment() === 'host';
  return (
    <TabIconShell active={active}>
      <MaterialCommunityIcons name="account-group-outline" size={size} color={segmentTintColor(active)} />
    </TabIconShell>
  );
}

const TAB_ICONS: Record<keyof TabParamList, (color: string, size: number, focused: boolean) => React.ReactNode> = {
  Map: (_color, size) => <MapTabIcon size={size} />,
  GroupRide: (_color, size) => <GroupRideTabIcon size={size} />,
  Routes: (color, size, focused) => (
    <TabIconShell active={focused}>
      <MaterialCommunityIcons name="routes" size={size} color={color} />
    </TabIconShell>
  ),
  // Keep the entire tab bar in one icon family and distinguish the private
  // friend network from the active group-ride view.
  Friends: (color, size, focused) => (
    <TabIconShell active={focused}>
      <MaterialCommunityIcons name="account-multiple-outline" size={size} color={color} />
    </TabIconShell>
  ),
  Settings: (color, size, focused) => (
    <TabIconShell active={focused}>
      <MaterialCommunityIcons name="cog-outline" size={size} color={color} />
    </TabIconShell>
  ),
};

function MapTabLabel({ children }: { children: string }): React.JSX.Element {
  const color = segmentTintColor(useMapSegment() === 'public');
  return <Text style={[styles.tabLabel, { color }]}>{children}</Text>;
}

function GroupRideTabLabel({ children }: { children: string }): React.JSX.Element {
  const color = segmentTintColor(useMapSegment() === 'host');
  return <Text style={[styles.tabLabel, { color }]}>{children}</Text>;
}

function LockedTabScreen(): React.JSX.Element {
  return <RideSafeSurface />;
}

function Tabs(): React.JSX.Element {
  const { lockedForSafety } = useMovementSafety();
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
        // backgroundColor is the app background, not the surface color: the
        // tab bar's own background fills the bottom safe-area inset (React
        // Navigation + react-native-safe-area-context do this automatically
        // as long as nothing above the navigator already consumes that
        // inset), so it needs to match the screens above it for one
        // continuous edge-to-edge surface instead of reading as a raised
        // panel with a seam under the home indicator.
        tabBarStyle: {
          backgroundColor: colors.background,
        },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: styles.defaultTabLabel,
        tabBarIcon: ({ color, size, focused }) => TAB_ICONS[route.name](color, size, focused),
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
        options={{ title: 'Map', tabBarLabel: ({ children }) => <MapTabLabel>{children}</MapTabLabel> }}
        listeners={({ navigation }) => ({
          tabPress: (e) => {
            e.preventDefault();
            navigation.navigate('Map', {
              segment: 'public',
              at: Date.now(),
              lat: undefined,
              lon: undefined,
              label: undefined,
            });
          },
        })}
      />
      {/* Not a second screen/mount: tapping this tab redirects straight to
          the Map route with segment: 'host' params instead of navigating
          here, so there's still only ever one mounted map instance. Its
          icon/label color is driven by MapScreen's actual `segment` param
          (via useMapSegment above), not by this tab's own (never-focused)
          navigation state, so the tab bar correctly highlights "Group Ride"
          while the user is looking at the host view. */}
      <Tab.Screen
        name="GroupRide"
        component={MapScreen}
        options={{
          title: 'Group Ride',
          tabBarLabel: ({ children }) => <GroupRideTabLabel>{children}</GroupRideTabLabel>,
        }}
        listeners={({ navigation }) => ({
          tabPress: (e) => {
            e.preventDefault();
            navigation.navigate('Map', {
              segment: 'host',
              at: Date.now(),
              lat: undefined,
              lon: undefined,
              label: undefined,
            });
          },
        })}
      />
      <Tab.Screen name="Routes" component={lockedForSafety ? LockedTabScreen : ScenicRoutesScreen} options={{ title: 'Routes' }} />
      <Tab.Screen name="Friends" component={lockedForSafety ? LockedTabScreen : FriendsScreen} options={{ title: 'Friends' }} />
      <Tab.Screen name="Settings" component={lockedForSafety ? LockedTabScreen : SettingsScreen} options={{ title: 'Settings' }} />
    </Tab.Navigator>
  );
}

/**
 * Gates the real app behind the first-launch onboarding flow. Checked once
 * on mount with a single AsyncStorage read (kept deliberately simple: no
 * loading spinner, just a blank themed screen for the instant that read
 * takes) so a first-time user sees onboarding instead of being dropped
 * straight into MapScreen — whose location polling otherwise surfaces an
 * immediate "no location yet" notice before they've done anything at all.
 */
function OnboardingGate({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [completed, setCompleted] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    AsyncStorage.getItem(ONBOARDING_COMPLETED_KEY)
      .then((value) => setCompleted(value === 'true'))
      .catch(() => setCompleted(false));
  }, []);

  if (completed === null) {
    return <View style={styles.blank} />;
  }
  if (!completed) {
    return <OnboardingScreen onDone={() => setCompleted(true)} />;
  }
  return <>{children}</>;
}

export function AppNavigator(): React.JSX.Element {
  const scheme = useColorScheme();
  const concreteColors = useConcreteThemeColors();
  const baseTheme = scheme === 'light' ? DefaultTheme : DarkTheme;
  const navigationTheme = React.useMemo(() => ({
    ...baseTheme,
    colors: {
      ...baseTheme.colors,
      primary: concreteColors.accent,
      background: concreteColors.background,
      card: concreteColors.surface,
      text: concreteColors.textPrimary,
      border: concreteColors.border,
    },
  }), [baseTheme, concreteColors]);

  return (
    // Every screen in this app hides the native nav header and builds its
    // own top chrome instead — which means every one of them is otherwise
    // on the hook for not rendering under the status bar/notch itself.
    // SafeAreaProvider is what makes useSafeAreaInsets() (used by
    // MapScreen's floating toggle/error banner, and every screen's top
    // padding) return real numbers instead of all zeros.
    <SafeAreaProvider>
      <AuthProvider>
       <SettingsProvider>
        <RideProvider>
          <FriendsProvider>
            <OnboardingGate>
              <MovementSafetyProvider>
              <NavigationContainer theme={navigationTheme} linking={linking}>
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
                  {/* Same in-content-back-chevron convention as FriendChat —
                      reached from Settings' "Billing" row. */}
                  <Stack.Screen
                    name="Billing"
                    component={BillingScreen}
                    options={{ presentation: 'card', headerShown: false }}
                  />
                  <Stack.Screen name="Legal" component={LegalScreen} options={{ headerShown: false }} />
                </Stack.Navigator>
              </NavigationContainer>
              </MovementSafetyProvider>
            </OnboardingGate>
          </FriendsProvider>
        </RideProvider>
       </SettingsProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  blank: { flex: 1, backgroundColor: colors.background },
  tabLabel: { fontSize: 12, fontWeight: '600', letterSpacing: 0 },
  defaultTabLabel: { fontSize: 12, fontWeight: '600', letterSpacing: 0 },
  tabIconShell: {
    width: 42,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabIconShellActive: { backgroundColor: 'transparent' },
});
