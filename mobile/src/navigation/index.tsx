// Unverified in this sandbox: React Native/Expo aren't installed here (no
// npm registry access), so this file has never actually been run. Written
// to be correct against @react-navigation/native-stack's real API as of
// v6 — review against the installed version once you're on a real
// dev machine.
import * as React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { HomeScreen } from '../screens/HomeScreen';
import { CreateRideScreen } from '../screens/CreateRideScreen';
import { JoinRideScreen } from '../screens/JoinRideScreen';
import { PublicZoneScreen } from '../screens/PublicZoneScreen';
import { RideScreen } from '../screens/RideScreen';

export type RootStackParamList = {
  Home: undefined;
  CreateRide: undefined;
  JoinRide: undefined;
  PublicZone: undefined;
  Ride: { rideId: string; code?: string };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export function AppNavigator(): React.JSX.Element {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Home">
        <Stack.Screen name="Home" component={HomeScreen} options={{ title: 'Rider Comms' }} />
        <Stack.Screen name="CreateRide" component={CreateRideScreen} options={{ title: 'Start a Ride' }} />
        <Stack.Screen name="JoinRide" component={JoinRideScreen} options={{ title: 'Join a Ride' }} />
        <Stack.Screen name="PublicZone" component={PublicZoneScreen} options={{ title: 'Nearby Riders' }} />
        <Stack.Screen name="Ride" component={RideScreen} options={{ title: 'In Ride' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
