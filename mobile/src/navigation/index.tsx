import * as React from 'react';
import { Linking, View, StyleSheet, useColorScheme } from 'react-native';
import { DarkTheme, DefaultTheme, NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import type { LinkingOptions, NavigatorScreenParams } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ConnectionBanner } from '../components/ConnectionBanner';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MapScreen } from '../screens/MapScreen';
import { SettingsPageScreen, SettingsScreen, type SettingsPageKey } from '../screens/SettingsScreen';
import { MenuScreen } from '../screens/MenuScreen';
import { CreateRideScreen } from '../screens/CreateRideScreen';
import { FriendsScreen } from '../screens/FriendsScreen';
import { FriendChatScreen } from '../screens/FriendChatScreen';
import { ScenicRoutesScreen } from '../screens/ScenicRoutesScreen';
import { BillingScreen } from '../screens/BillingScreen';
import { LegalScreen } from '../screens/LegalScreen';
import { OnboardingScreen, ONBOARDING_COMPLETED_KEY } from '../screens/OnboardingScreen';
import { RideProvider } from '../ride/RideContext';
import { SettingsProvider } from '../settings/SettingsContext';
import { BillingProvider } from '../billing/BillingContext';
import { FriendsProvider } from '../friends/FriendsContext';
import { AuthProvider } from '../auth/AuthContext';
import { parseNavigationLink } from '../navigationLinks';
import { colors, useConcreteThemeColors } from '../theme';
import { MovementSafetyProvider, useMovementSafety } from '../safety/MovementSafetyContext';
import { VoiceMuteProvider } from '../voice/VoiceMuteContext';
import { PushNotificationRouter } from '../notifications/PushNotificationRouter';
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
  Friends: undefined;
};

export type RootStackParamList = {
  Tabs: NavigatorScreenParams<TabParamList> | undefined;
  CreateRide: undefined;
  FriendChat: { riderId: string; displayName: string; avatarId: string };
  Billing: undefined;
  Legal: undefined;
  // Opened from the rider's avatar on the map, not tabs.
  Menu: undefined;
  Routes: undefined;
  Settings: undefined;
  SettingsPage: { page: SettingsPageKey };
};

const Tab = createBottomTabNavigator<TabParamList>();
// Lets a tapped notification open the right screen (PushNotificationRouter).
const navigationRef = createNavigationContainerRef<RootStackParamList>();
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

function LockedTabScreen(): React.JSX.Element {
  return <RideSafeSurface />;
}

/** Stack screens with distracting controls show the Ride Safe surface while
 * the rider is moving, as their tabs used to. */
function rideSafe<P extends object>(Screen: React.ComponentType<P>): React.ComponentType<P> {
  function RideSafeScreen(props: P): React.JSX.Element {
    const { lockedForSafety } = useMovementSafety();
    return lockedForSafety ? <RideSafeSurface /> : <Screen {...props} />;
  }
  return RideSafeScreen;
}
/** Each menu page measures its own insets. When the menu was a full-screen
 * modal its pages showed as iOS sheets, which start below the status bar,
 * and the app-wide insets added the status bar's height again (an empty
 * band above the header). A provider of their own keeps that from coming
 * back however a page is presented. */
function ownSafeArea<P extends object>(Screen: React.ComponentType<P>): (props: P) => React.JSX.Element {
  function OwnSafeAreaScreen(props: P): React.JSX.Element {
    return <SafeAreaProvider><Screen {...props} /></SafeAreaProvider>;
  }
  return OwnSafeAreaScreen;
}
const RoutesStackScreen = ownSafeArea(rideSafe(ScenicRoutesScreen));
const SettingsStackScreen = ownSafeArea(rideSafe(SettingsScreen));
const SettingsPageStackScreen = ownSafeArea(rideSafe(SettingsPageScreen));
const MenuStackScreen = ownSafeArea(rideSafe(MenuScreen));
const BillingStackScreen = ownSafeArea(BillingScreen);
const LegalStackScreen = ownSafeArea(LegalScreen);

/**
 * Map, Ride (the map's host segment) and Friends stay routes of their own,
 * so links and notifications keep opening them, but there is no tab bar:
 * the map's Where to drawer and the menu move between them, as in the PWA.
 */
function Tabs(): React.JSX.Element {
  const { lockedForSafety } = useMovementSafety();
  return (
    <Tab.Navigator tabBar={() => null} screenOptions={{ headerShown: false }}>
      <Tab.Screen name="Map" component={MapScreen} options={{ title: 'Map' }} />
      {/* The Ride page is the map's host segment, one mounted map either
          way; anything that opens this route lands there instead. */}
      <Tab.Screen
        name="GroupRide"
        component={MapScreen}
        options={{ title: 'Ride' }}
        listeners={({ navigation }) => ({
          focus: () => navigation.navigate('Map', { segment: 'host', at: Date.now() }),
        })}
      />
      <Tab.Screen name="Friends" component={lockedForSafety ? LockedTabScreen : FriendsScreen} options={{ title: 'Friends' }} />
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
        <BillingProvider>
        <RideProvider>
          <FriendsProvider>
            <OnboardingGate>
              <MovementSafetyProvider>
              <VoiceMuteProvider>
              <NavigationContainer ref={navigationRef} theme={navigationTheme} linking={linking}>
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
                    component={BillingStackScreen}
                    options={{ presentation: 'card', headerShown: false }}
                  />
                  <Stack.Screen name="Legal" component={LegalStackScreen} options={{ headerShown: false }} />
                  {/* A page, not a full-screen modal: each menu row replaces
                      the menu with its page, and on iOS replacing a modal
                      with a page could leave the map showing (Your plan
                      never opened). The X closes it. */}
                  <Stack.Screen
                    name="Menu"
                    component={MenuStackScreen}
                    options={{ headerShown: false, animation: 'slide_from_left', gestureEnabled: false }}
                  />
                  <Stack.Screen name="Routes" component={RoutesStackScreen} options={{ headerShown: false }} />
                  <Stack.Screen name="Settings" component={SettingsStackScreen} options={{ headerShown: false }} />
                  <Stack.Screen name="SettingsPage" component={SettingsPageStackScreen} options={{ headerShown: false }} />
                </Stack.Navigator>
              </NavigationContainer>
              <ConnectionBanner />
              <PushNotificationRouter navigationRef={navigationRef} />
              </VoiceMuteProvider>
              </MovementSafetyProvider>
            </OnboardingGate>
          </FriendsProvider>
        </RideProvider>
        </BillingProvider>
       </SettingsProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  blank: { flex: 1, backgroundColor: colors.background },
});
