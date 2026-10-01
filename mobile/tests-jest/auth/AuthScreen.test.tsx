import * as React from 'react';
import { Alert, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AuthProvider } from '../../src/auth/AuthContext';

// The sign-in screen AuthProvider shows when there is no saved session:
// validation, login, signup, password recovery and server error messages.

const SAFE_AREA_METRICS = {
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
  frame: { x: 0, y: 0, width: 320, height: 640 },
};
const KEY = '@rider-comms/auth-v2';

const mockGetItemAsync = jest.fn();
const mockSetItemAsync = jest.fn();
const mockDeleteItemAsync = jest.fn();

jest.mock('expo-secure-store', () => ({
  getItemAsync: (...args: unknown[]) => mockGetItemAsync(...args),
  setItemAsync: (...args: unknown[]) => mockSetItemAsync(...args),
  deleteItemAsync: (...args: unknown[]) => mockDeleteItemAsync(...args),
}));

interface MockClient {
  getMe: jest.Mock;
  logIn: jest.Mock;
  signUp: jest.Mock;
  updateProfile: jest.Mock;
  requestPasswordReset: jest.Mock;
  resetPassword: jest.Mock;
}

let mockClientImpl: MockClient;

jest.mock('../../src/api/client', () => {
  const actual = jest.requireActual('../../src/api/client');
  return {
    ...actual,
    RiderCommsClient: jest.fn().mockImplementation(() => mockClientImpl),
  };
});

// Imported after jest.mock so tests build the real error class.
const { ApiError } = jest.requireActual('../../src/api/client') as typeof import('../../src/api/client');

async function renderSignedOut() {
  await render(
    <SafeAreaProvider initialMetrics={SAFE_AREA_METRICS}>
      <AuthProvider><Text>Signed in content</Text></AuthProvider>
    </SafeAreaProvider>,
  );
  await act(async () => {
    jest.advanceTimersByTime(1_000);
  });
  await screen.findByLabelText('Username');
}

async function fillLogin(username: string, password: string): Promise<void> {
  await fireEvent.changeText(screen.getByLabelText('Username'), username);
  await fireEvent.changeText(screen.getByLabelText('Password'), password);
}

async function press(label: string): Promise<void> {
  await act(async () => {
    await fireEvent.press(screen.getByText(label));
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  mockGetItemAsync.mockReset().mockResolvedValue(null);
  mockSetItemAsync.mockReset().mockResolvedValue(undefined);
  mockDeleteItemAsync.mockReset().mockResolvedValue(undefined);
  mockClientImpl = {
    getMe: jest.fn(),
    logIn: jest.fn(async () => ({ riderId: 'rider_me', token: 'tok', emailVerified: true })),
    signUp: jest.fn(async () => ({ riderId: 'rider_new', token: 'new-tok', emailVerified: false, emailVerificationSent: true })),
    updateProfile: jest.fn(async () => ({})),
    requestPasswordReset: jest.fn(async () => ({ accepted: true })),
    resetPassword: jest.fn(async () => ({ reset: true })),
  };
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test('validates the username and password before calling the server', async () => {
  await renderSignedOut();

  await fillLogin('a', 'correct-horse');
  await press('Log in');
  expect(screen.getByRole('alert')).toHaveTextContent('Use 3–20 letters, numbers, or underscores for your username.');

  await fillLogin('rider_one', 'short');
  await press('Log in');
  expect(screen.getByRole('alert')).toHaveTextContent('Use a password between 8 and 128 characters.');
  expect(mockClientImpl.logIn).not.toHaveBeenCalled();
});

test('logs in, remembers the session by default and shows the app', async () => {
  await renderSignedOut();
  await fillLogin('  rider_one  ', 'correct-horse');
  await press('Log in');

  expect(mockClientImpl.logIn).toHaveBeenCalledWith('rider_one', 'correct-horse');
  await screen.findByText('Signed in content');
  expect(mockSetItemAsync).toHaveBeenCalledWith(KEY, JSON.stringify({ riderId: 'rider_me', token: 'tok', emailVerified: true }));
});

test('does not store the session when Remember me is turned off', async () => {
  await renderSignedOut();
  await fireEvent.press(screen.getByText('Remember me'));
  await fillLogin('rider_one', 'correct-horse');
  await press('Log in');

  await screen.findByText('Signed in content');
  expect(mockSetItemAsync).not.toHaveBeenCalledWith(KEY, expect.anything());
  expect(mockDeleteItemAsync).toHaveBeenCalledWith(KEY);
});

test.each([
  [new ApiError(401, { error: 'invalid_credentials' }), 'The username or password is incorrect.'],
  [new ApiError(403, { error: 'account_suspended' }), 'This account has been suspended for breaking the community rules. Contact support if you think this is a mistake.'],
  [new ApiError(429, { error: 'rate_limited' }), 'Too many attempts. Wait a moment and try again.'],
  [new ApiError(500, { error: 'something_new' }), 'The account request could not be completed.'],
  [Object.assign(new Error('aborted'), { name: 'AbortError' }), 'The request timed out. Check your connection and try again.'],
  [new TypeError('Network request failed'), 'Rider Comms could not reach the account service. Check your connection and try again.'],
])('explains a failed login (%s)', async (error, message) => {
  mockClientImpl.logIn.mockRejectedValueOnce(error);
  await renderSignedOut();
  await fillLogin('rider_one', 'correct-horse');
  await press('Log in');

  expect(await screen.findByRole('alert')).toHaveTextContent(message);
  expect(screen.queryByText('Signed in content')).toBeNull();
});

test('creates an account, seeds the profile name and asks the rider to verify their email', async () => {
  await renderSignedOut();
  await fireEvent.press(screen.getByText('Create account'));
  await fireEvent.changeText(screen.getByLabelText('Username'), 'new_rider');
  await fireEvent.changeText(screen.getByLabelText('Email address'), 'bad-email');
  await fireEvent.changeText(screen.getByLabelText('Password'), 'correct-horse');
  await press('Create account');
  expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid email address.');
  expect(mockClientImpl.signUp).not.toHaveBeenCalled();

  await fireEvent.changeText(screen.getByLabelText('Email address'), 'new@example.com');
  await press('Create account');
  expect(screen.getByRole('alert')).toHaveTextContent('Agree to the Terms of Service and Community Guidelines to create an account.');
  expect(mockClientImpl.signUp).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByLabelText('I agree to the Terms of Service and Community Guidelines'));
  await press('Create account');

  expect(mockClientImpl.signUp).toHaveBeenCalledWith('new_rider', 'new@example.com', 'correct-horse');
  expect(mockClientImpl.updateProfile).toHaveBeenCalledWith('rider_new', { displayName: 'new_rider', handle: '@new_rider' });
  await screen.findByText('Signed in content');
  expect(Alert.alert).toHaveBeenCalledWith('Account created', expect.stringContaining('Open the verification link'));
});

test('still signs the rider in when the optional first profile write fails', async () => {
  mockClientImpl.updateProfile.mockRejectedValueOnce(new Error('offline'));
  mockClientImpl.signUp.mockResolvedValueOnce({ riderId: 'rider_new', token: 'new-tok', emailVerified: false, emailVerificationSent: false });
  await renderSignedOut();
  await fireEvent.press(screen.getByText('Create account'));
  await fireEvent.changeText(screen.getByLabelText('Username'), 'new_rider');
  await fireEvent.changeText(screen.getByLabelText('Email address'), 'new@example.com');
  await fireEvent.changeText(screen.getByLabelText('Password'), 'correct-horse');
  await fireEvent.press(screen.getByLabelText('I agree to the Terms of Service and Community Guidelines'));
  await press('Create account');

  await screen.findByText('Signed in content');
  expect(Alert.alert).toHaveBeenCalledWith('Account created', expect.stringContaining('verification email could not be sent'));
});

test('explains a signup conflict', async () => {
  mockClientImpl.signUp.mockRejectedValueOnce(new ApiError(409, { error: 'username_taken' }));
  await renderSignedOut();
  await fireEvent.press(screen.getByText('Create account'));
  await fireEvent.changeText(screen.getByLabelText('Username'), 'taken_name');
  await fireEvent.changeText(screen.getByLabelText('Email address'), 'new@example.com');
  await fireEvent.changeText(screen.getByLabelText('Password'), 'correct-horse');
  await fireEvent.press(screen.getByLabelText('I agree to the Terms of Service and Community Guidelines'));
  await press('Create account');

  expect(await screen.findByRole('alert')).toHaveTextContent('That username is already taken.');
});

test('recovers a password: request a code, then reset and return to login', async () => {
  await renderSignedOut();
  await fireEvent.press(screen.getByText('Forgot password?'));

  await fireEvent.changeText(screen.getByLabelText('Email address'), 'me@example.com');
  await press('Send reset link');
  expect(mockClientImpl.requestPasswordReset).toHaveBeenCalledWith('me@example.com');
  expect(await screen.findByText('If that address belongs to an account, a one-hour reset link and code has been sent.')).toBeTruthy();

  await fireEvent.changeText(screen.getByLabelText('New password'), 'new-password-1');
  await press('Reset password');
  expect(screen.getByRole('alert')).toHaveTextContent('Enter the reset code from your email.');
  expect(mockClientImpl.resetPassword).not.toHaveBeenCalled();

  await fireEvent.changeText(screen.getByLabelText('Password reset code'), '  code-123  ');
  await press('Reset password');
  expect(mockClientImpl.resetPassword).toHaveBeenCalledWith('code-123', 'new-password-1');
  expect(await screen.findByText('Password updated. Sign in again on each device.')).toBeTruthy();
  expect(screen.getByText('Log in')).toBeTruthy();
});

test('explains an expired reset code', async () => {
  mockClientImpl.resetPassword.mockRejectedValueOnce(new ApiError(410, { error: 'expired_token' }));
  await renderSignedOut();
  await fireEvent.press(screen.getByText('Forgot password?'));
  await fireEvent.changeText(screen.getByLabelText('Email address'), 'me@example.com');
  await press('Send reset link');
  await fireEvent.changeText(screen.getByLabelText('Password reset code'), 'old-code');
  await fireEvent.changeText(screen.getByLabelText('New password'), 'new-password-1');
  await press('Reset password');

  expect(await screen.findByRole('alert')).toHaveTextContent('That reset code has expired. Request a new one.');
});

test('offers a retry when a saved session could not be restored', async () => {
  mockGetItemAsync.mockResolvedValue(JSON.stringify({ riderId: 'rider_me', token: 'tok', emailVerified: true }));
  mockClientImpl.getMe
    .mockRejectedValueOnce(new ApiError(503, { error: 'unavailable' }))
    .mockResolvedValueOnce({ riderId: 'rider_me', username: 'me', emailVerified: true });
  await render(
    <SafeAreaProvider initialMetrics={SAFE_AREA_METRICS}>
      <AuthProvider><Text>Signed in content</Text></AuthProvider>
    </SafeAreaProvider>,
  );
  await act(async () => {
    jest.advanceTimersByTime(1_000);
  });
  expect(await screen.findByText('We could not restore your saved session. You can retry or sign in again.')).toBeTruthy();

  await press('Retry');
  await act(async () => {
    jest.advanceTimersByTime(1_000);
  });
  await screen.findByText('Signed in content');
});
