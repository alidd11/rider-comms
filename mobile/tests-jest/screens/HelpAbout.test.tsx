import * as React from 'react';
import { Alert, Platform } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as Clipboard from 'expo-clipboard';
import { AboutPage } from '../../src/screens/AboutPage';

jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { version: '1.0.0' } } }));
jest.mock('../../src/settings/SettingsContext', () => ({ useSettings: () => ({ displayName: 'Alex Rider', handle: '@alex_rides' }) }));

const setString = Clipboard.setStringAsync as jest.Mock;
afterEach(() => { setString.mockReset(); jest.restoreAllMocks(); });

test('About shows the real version and copies the details support needs', async () => {
  setString.mockResolvedValue(true);
  await render(<AboutPage title="About" />);
  const platform = Platform.OS === 'ios' ? 'iOS' : 'Android';
  expect(screen.getByText(`Version 1.0.0 · ${platform}`)).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByRole('button', { name: 'Copy app details' })); });
  expect(setString).toHaveBeenCalledWith(`Rider Comms 1.0.0 · ${platform} ${String(Platform.Version)}\nRider: @alex_rides`);
  expect(screen.getByText('Copied')).toBeTruthy();
});

test('says so when the details cannot be copied', async () => {
  setString.mockRejectedValue(new Error('no clipboard'));
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  await render(<AboutPage />);
  await act(async () => { fireEvent.press(screen.getByTestId('copy-app-details')); });
  expect(alert).toHaveBeenCalledWith('Couldn’t copy the app details');
  expect(screen.queryByText('Copied')).toBeNull();
});
