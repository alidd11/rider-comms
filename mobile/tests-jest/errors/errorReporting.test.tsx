import * as React from 'react';
import { Text } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { AppErrorBoundary } from '../../src/errors/AppErrorBoundary';
import { installGlobalErrorHandler, reportClientError, resetErrorReportingForTests } from '../../src/errors/errorReporting';

function okFetch() {
  return jest.fn(async (_url: string, _init: RequestInit) => ({ ok: true, status: 202 }) as Response);
}

function sentBody(fetchMock: jest.Mock, call = 0): Record<string, unknown> {
  return JSON.parse(String((fetchMock.mock.calls[call]![1] as RequestInit).body));
}

beforeEach(() => {
  resetErrorReportingForTests();
});

test('posts a bounded report to the backend crash endpoint', () => {
  const fetchMock = okFetch();
  const sent = reportClientError({ error: new TypeError('x is undefined'), fatal: true, context: 'render' }, fetchMock as unknown as typeof fetch);

  expect(sent).toBe(true);
  expect(String(fetchMock.mock.calls[0]![0])).toMatch(/\/client-errors$/);
  const body = sentBody(fetchMock);
  expect(body).toEqual(expect.objectContaining({ message: 'TypeError: x is undefined', fatal: true, context: 'render' }));
  expect(['ios', 'android', 'web']).toContain(body.platform);
  expect(typeof body.stack).toBe('string');
});

test('drops duplicates within a minute and caps reports per session', () => {
  const fetchMock = okFetch();
  const fetchImpl = fetchMock as unknown as typeof fetch;

  expect(reportClientError({ error: new Error('same') }, fetchImpl, 1_000)).toBe(true);
  expect(reportClientError({ error: new Error('same') }, fetchImpl, 30_000)).toBe(false);
  expect(reportClientError({ error: new Error('same') }, fetchImpl, 62_000)).toBe(true);

  for (let i = 0; i < 30; i += 1) reportClientError({ error: new Error(`distinct ${i}`) }, fetchImpl, 100_000);
  expect(fetchMock).toHaveBeenCalledTimes(20);
});

test('never throws when the network fails', async () => {
  const failing = jest.fn(async () => { throw new TypeError('Network request failed'); });
  expect(() => reportClientError({ error: 'plain string' }, failing as unknown as typeof fetch)).not.toThrow();
  await Promise.resolve();
  expect(failing).toHaveBeenCalledTimes(1);
});

test('the global handler reports and then defers to React Native', () => {
  const previous = jest.fn();
  let installedHandler: ((error: unknown, isFatal?: boolean) => void) | undefined;
  const originalErrorUtils = (globalThis as { ErrorUtils?: unknown }).ErrorUtils;
  const originalFetch = globalThis.fetch;
  const fetchMock = okFetch();
  (globalThis as { ErrorUtils?: unknown }).ErrorUtils = {
    getGlobalHandler: () => previous,
    setGlobalHandler: (handler: (error: unknown, isFatal?: boolean) => void) => { installedHandler = handler; },
  };
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  try {
    installGlobalErrorHandler();
    const error = new Error('uncaught');
    installedHandler!(error, true);
    expect(previous).toHaveBeenCalledWith(error, true);
    expect(sentBody(fetchMock)).toEqual(expect.objectContaining({ message: 'Error: uncaught', fatal: true, context: 'global' }));
  } finally {
    (globalThis as { ErrorUtils?: unknown }).ErrorUtils = originalErrorUtils;
    globalThis.fetch = originalFetch;
  }
});

test('the error boundary shows a recovery screen and can retry', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = okFetch() as unknown as typeof fetch;
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  let shouldThrow = true;
  function Flaky(): React.JSX.Element {
    if (shouldThrow) throw new Error('render failed');
    return <Text>Recovered</Text>;
  }
  try {
    await render(<AppErrorBoundary><Flaky /></AppErrorBoundary>);
    expect(screen.getByText('Something went wrong')).toBeTruthy();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    shouldThrow = false;
    await fireEvent.press(screen.getByText('Try again'));
    expect(screen.getByText('Recovered')).toBeTruthy();
  } finally {
    globalThis.fetch = originalFetch;
    consoleError.mockRestore();
  }
});
