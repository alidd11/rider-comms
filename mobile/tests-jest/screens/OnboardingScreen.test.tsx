import * as React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { OnboardingScreen, ONBOARDING_COMPLETED_KEY } from '../../src/screens/OnboardingScreen';
import { ONBOARDING_LOCATION_PERMISSION_WAIT_MS } from '../../src/screens/onboardingLocationPermission';

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(),
}));

const SAFE_AREA_METRICS = {
  insets: { top: 0, left: 0, right: 0, bottom: 34 },
  frame: { x: 0, y: 0, width: 390, height: 844 },
};
const askPermission = Location.requestForegroundPermissionsAsync as jest.Mock;

async function openLocationStep(onDone: jest.Mock) {
  await render(
    <SafeAreaProvider initialMetrics={SAFE_AREA_METRICS}>
      <OnboardingScreen onDone={onDone} />
    </SafeAreaProvider>,
  );
  await fireEvent.press(screen.getByTestId('onboarding-get-started'));
  expect(screen.getByTestId('onboarding-continue')).toBeTruthy();
}

beforeEach(async () => {
  askPermission.mockReset();
  await AsyncStorage.clear();
});

it('requests location on explicit Continue and opens the app when permission resolves', async () => {
  askPermission.mockResolvedValue({ status: 'granted' });
  const onDone = jest.fn();
  await openLocationStep(onDone);
  expect(askPermission).not.toHaveBeenCalled();
  await act(async () => {
    fireEvent.press(screen.getByTestId('onboarding-continue'));
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(askPermission).toHaveBeenCalledTimes(1);
  expect(onDone).toHaveBeenCalledTimes(1);
  expect(await AsyncStorage.getItem(ONBOARDING_COMPLETED_KEY)).toBe('true');
});

it('ignores duplicate taps and eventually opens the app if the iOS request hangs', async () => {
  const onDone = jest.fn();
  askPermission.mockImplementation(() => new Promise(() => undefined));
  await openLocationStep(onDone);
  jest.useFakeTimers();
  try {
    await act(async () => {
      fireEvent.press(screen.getByTestId('onboarding-continue'));
      fireEvent.press(screen.getByTestId('onboarding-continue'));
      await Promise.resolve();
    });
    expect(askPermission).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
    await act(async () => { await jest.advanceTimersByTimeAsync(ONBOARDING_LOCATION_PERMISSION_WAIT_MS); });
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(await AsyncStorage.getItem(ONBOARDING_COMPLETED_KEY)).toBe('true');
  } finally {
    jest.useRealTimers();
  }
});
