import * as React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { OnboardingScreen, ONBOARDING_COMPLETED_KEY } from '../../src/screens/OnboardingScreen';

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(),
  getForegroundPermissionsAsync: jest.fn(),
}));

const SAFE_AREA_METRICS = {
  insets: { top: 0, left: 0, right: 0, bottom: 34 },
  frame: { x: 0, y: 0, width: 390, height: 844 },
};
const askPermission = Location.requestForegroundPermissionsAsync as jest.Mock;
const readPermission = Location.getForegroundPermissionsAsync as jest.Mock;

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
  readPermission.mockReset();
  readPermission.mockResolvedValue({ status: 'undetermined', granted: false });
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

it('does not advance during a location prompt that takes over ten seconds', async () => {
  const onDone = jest.fn();
  await openLocationStep(onDone);
  jest.useFakeTimers();
  try {
    askPermission.mockImplementation(() => new Promise(resolve => {
      setTimeout(() => resolve({ status: 'granted' }), 10_500);
    }));
    await act(async () => {
      fireEvent.press(screen.getByTestId('onboarding-continue'));
      fireEvent.press(screen.getByTestId('onboarding-continue'));
      await Promise.resolve();
    });
    expect(askPermission).toHaveBeenCalledTimes(1);
    await act(async () => { await jest.advanceTimersByTimeAsync(10_000); });
    expect(onDone).not.toHaveBeenCalled();
    expect(readPermission).toHaveBeenCalled();
    await act(async () => { await jest.advanceTimersByTimeAsync(500); });
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(await AsyncStorage.getItem(ONBOARDING_COMPLETED_KEY)).toBe('true');
  } finally {
    jest.useRealTimers();
  }
});
