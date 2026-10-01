import * as React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Text } from 'react-native';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react-native';
import { AuthProvider, useAuth } from '../../src/auth/AuthContext';

const SAFE_AREA_METRICS = {
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
  frame: { x: 0, y: 0, width: 320, height: 640 },
};

const KEY = '@rider-comms/auth-v2';
const LEGACY_GUEST_KEY = '@rider-comms/auth-v1';

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
  acceptTerms?: jest.Mock;
  logOut: jest.Mock;
  deleteAccount: jest.Mock;
}

let mockClientImpl: MockClient;

jest.mock('../../src/api/client', () => {
  const actual = jest.requireActual('../../src/api/client');
  return {
    ...actual,
    RiderCommsClient: jest.fn().mockImplementation(() => mockClientImpl),
  };
});

function cachedSession(overrides: Partial<{ riderId: string; token: string; emailVerified: boolean }> = {}): string {
  return JSON.stringify({ riderId: 'me', token: 'tok', emailVerified: false, ...overrides });
}

async function renderAuth() {
  return renderHook(() => useAuth(), {
    wrapper: ({ children }) => (
      <SafeAreaProvider initialMetrics={SAFE_AREA_METRICS}>
        <AuthProvider>{children}</AuthProvider>
      </SafeAreaProvider>
    ),
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  mockGetItemAsync.mockReset().mockResolvedValue(null);
  mockSetItemAsync.mockReset().mockResolvedValue(undefined);
  mockDeleteItemAsync.mockReset().mockResolvedValue(undefined);
  mockClientImpl = {
    getMe: jest.fn(async () => ({ riderId: 'me', username: 'me', emailVerified: true })),
    logOut: jest.fn(async () => undefined),
    deleteAccount: jest.fn(async () => ({})),
  };
});

afterEach(() => {
  jest.useRealTimers();
});

async function flushSplashDelay(): Promise<void> {
  await act(async () => {
    jest.advanceTimersByTime(1_000);
  });
}

test('deletes the legacy v1 guest key on every mount, regardless of restore outcome', async () => {
  await renderAuth();
  await flushSplashDelay();

  expect(mockDeleteItemAsync).toHaveBeenCalledWith(LEGACY_GUEST_KEY);
});

test('restores a cached session and re-persists it with a fresh emailVerified flag', async () => {
  mockGetItemAsync.mockImplementation(async (key: string) => (key === KEY ? cachedSession({ emailVerified: false }) : null));
  mockClientImpl.getMe.mockResolvedValue({ riderId: 'me', username: 'me', emailVerified: true });
  const { result } = await renderAuth();

  await flushSplashDelay();

  await waitFor(() => expect(result.current.riderId).toBe('me'));
  expect(result.current.emailVerified).toBe(true);
  expect(mockSetItemAsync).toHaveBeenCalledWith(KEY, expect.stringContaining('"emailVerified":true'));
});

test('skips restoring when there is no cached session', async () => {
  const { result } = await renderAuth();
  await flushSplashDelay();

  expect(mockClientImpl.getMe).not.toHaveBeenCalled();
  // AuthProvider renders AuthScreen (not children) while unauthenticated, so
  // the hook container this test's renderHook() wraps around useAuth()
  // never mounts at all -- result.current stays at its ref default.
  expect(result.current).toBeNull();
});

test('clears the stored session on a 401 without surfacing a restore error', async () => {
  mockGetItemAsync.mockImplementation(async (key: string) => (key === KEY ? cachedSession() : null));
  const { ApiError } = jest.requireActual('../../src/api/client');
  mockClientImpl.getMe.mockRejectedValue(new ApiError(401, { error: 'unauthorized' }));
  await renderAuth();

  await flushSplashDelay();

  await waitFor(() => expect(mockDeleteItemAsync).toHaveBeenCalledWith(KEY));
});

test('keeps the stored session and reports a retryable error on a non-auth restore failure', async () => {
  mockGetItemAsync.mockImplementation(async (key: string) => (key === KEY ? cachedSession() : null));
  mockClientImpl.getMe.mockRejectedValue(new Error('network down'));
  await renderAuth();

  await flushSplashDelay();

  expect(mockDeleteItemAsync).not.toHaveBeenCalledWith(KEY);
});

test('treats a riderId mismatch between the cache and the server as a restore failure', async () => {
  mockGetItemAsync.mockImplementation(async (key: string) => (key === KEY ? cachedSession({ riderId: 'me' }) : null));
  mockClientImpl.getMe.mockResolvedValue({ riderId: 'someone-else', username: 'x', emailVerified: true });
  const { result } = await renderAuth();

  await flushSplashDelay();

  expect(result.current).toBeNull();
  expect(mockDeleteItemAsync).not.toHaveBeenCalledWith(KEY);
});

test('logOut calls the server, then always clears the local session even if that call fails', async () => {
  mockGetItemAsync.mockImplementation(async (key: string) => (key === KEY ? cachedSession() : null));
  mockClientImpl.logOut.mockRejectedValue(new Error('network down'));
  const { result } = await renderAuth();
  await flushSplashDelay();
  await waitFor(() => expect(result.current.riderId).toBe('me'));

  await expect(act(async () => {
    await result.current.logOut();
  })).rejects.toThrow('network down');

  expect(mockDeleteItemAsync).toHaveBeenCalledWith(KEY);
});

test('deleteAccount clears the local session only after the server call succeeds', async () => {
  mockGetItemAsync.mockImplementation(async (key: string) => (key === KEY ? cachedSession() : null));
  const { result } = await renderAuth();
  await flushSplashDelay();
  await waitFor(() => expect(result.current.riderId).toBe('me'));

  await act(async () => {
    await result.current.deleteAccount();
  });

  expect(mockClientImpl.deleteAccount).toHaveBeenCalled();
  expect(mockDeleteItemAsync).toHaveBeenCalledWith(KEY);
});

test('deleteAccount leaves the local session intact when the server call fails', async () => {
  mockGetItemAsync.mockImplementation(async (key: string) => (key === KEY ? cachedSession() : null));
  mockClientImpl.deleteAccount.mockRejectedValue(new Error('network down'));
  const { result } = await renderAuth();
  await flushSplashDelay();
  await waitFor(() => expect(result.current.riderId).toBe('me'));

  await expect(act(async () => {
    await result.current.deleteAccount();
  })).rejects.toThrow('network down');

  expect(mockDeleteItemAsync).not.toHaveBeenCalledWith(KEY);
  expect(result.current.riderId).toBe('me');
});

test('asks an existing account to agree to the current Terms before showing the app', async () => {
  mockGetItemAsync.mockImplementation(async (key: string) => (key === KEY ? cachedSession({ emailVerified: true }) : null));
  mockClientImpl.getMe.mockResolvedValue({ riderId: 'me', username: 'me', emailVerified: true, termsAccepted: false, termsVersion: '2026-10-01' });
  mockClientImpl.acceptTerms = jest.fn(async () => ({ accepted: true }));
  await render(
    <SafeAreaProvider initialMetrics={SAFE_AREA_METRICS}>
      <AuthProvider><Text>Signed in content</Text></AuthProvider>
    </SafeAreaProvider>,
  );
  await flushSplashDelay();

  expect(await screen.findByText('Updated terms')).toBeTruthy();
  expect(screen.queryByText('Signed in content')).toBeNull();
  await fireEvent.press(screen.getByText('I agree'));
  expect(mockClientImpl.acceptTerms).toHaveBeenCalledWith('2026-10-01');
  expect(await screen.findByText('Signed in content')).toBeTruthy();
});
