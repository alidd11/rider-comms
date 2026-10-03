// Sends uncaught errors to the backend's POST /client-errors, which writes
// them to the structured server log (see backend/src/clientErrors.ts). No
// crash-reporting vendor is involved. Reporting is best-effort: it never
// throws, never blocks the UI, and is rate-limited on both ends.
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { API_BASE_URL } from '../config';

const MAX_REPORTS_PER_SESSION = 20;
const DUPLICATE_WINDOW_MS = 60_000;
const REPORT_TIMEOUT_MS = 5_000;

export interface ClientErrorInput {
  error: unknown;
  fatal?: boolean;
  /** Where it happened, e.g. 'render' or 'global'. Never user content. */
  context?: string;
}

interface ReporterState {
  sent: number;
  lastSentAt: Map<string, number>;
}

let state: ReporterState = { sent: 0, lastSentAt: new Map() };

/** Test hook: forget reports sent so far. */
export function resetErrorReportingForTests(): void {
  state = { sent: 0, lastSentAt: new Map() };
}

function describeError(error: unknown): { message: string; stack: string } {
  if (error instanceof Error) return { message: `${error.name}: ${error.message}`, stack: error.stack ?? '' };
  return { message: typeof error === 'string' ? error : 'Non-error value thrown', stack: '' };
}

export function reportClientError(
  { error, fatal = false, context = '' }: ClientErrorInput,
  fetchImpl: typeof fetch = fetch,
  now = Date.now(),
): boolean {
  const { message, stack } = describeError(error);
  const key = `${context}|${message}`;
  const last = state.lastSentAt.get(key);
  if (state.sent >= MAX_REPORTS_PER_SESSION || (last !== undefined && now - last < DUPLICATE_WINDOW_MS)) return false;
  state.sent += 1;
  state.lastSentAt.set(key, now);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REPORT_TIMEOUT_MS);
  void fetchImpl(`${API_BASE_URL.replace(/\/$/, '')}/client-errors`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      platform: Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web',
      message,
      stack,
      fatal,
      appVersion: Constants.expoConfig?.version ?? '',
      context,
    }),
    signal: controller.signal,
  })
    .catch(() => undefined)
    .finally(() => clearTimeout(timeout));
  return true;
}

interface ReactNativeErrorUtils {
  getGlobalHandler(): (error: unknown, isFatal?: boolean) => void;
  setGlobalHandler(handler: (error: unknown, isFatal?: boolean) => void): void;
}

let installed = false;

/** Reports uncaught JS errors, then hands them to React Native's own handler
 * (the red box in development, the native crash path in release). */
export function installGlobalErrorHandler(): void {
  const errorUtils = (globalThis as { ErrorUtils?: ReactNativeErrorUtils }).ErrorUtils;
  if (installed || !errorUtils) return;
  installed = true;
  const previous = errorUtils.getGlobalHandler();
  errorUtils.setGlobalHandler((error, isFatal) => {
    reportClientError({ error, fatal: isFatal === true, context: 'global' });
    previous(error, isFatal);
  });
}

interface HermesPromiseTracker {
  enablePromiseRejectionTracker?(options: {
    allRejections: boolean;
    onUnhandled: (id: number, error: unknown) => void;
  }): void;
}

let rejectionReporterInstalled = false;

/** Reports promise rejections nothing handled (a failed request nobody
 * awaited, for example), which the global handler never sees. Release builds
 * only: in development React Native already uses Hermes' tracker to show
 * them as warnings, and replacing it would hide those. */
export function installUnhandledRejectionReporter(isDev: boolean = typeof __DEV__ !== 'undefined' && __DEV__): void {
  const hermes = (globalThis as { HermesInternal?: HermesPromiseTracker }).HermesInternal;
  if (isDev || rejectionReporterInstalled || !hermes?.enablePromiseRejectionTracker) return;
  rejectionReporterInstalled = true;
  hermes.enablePromiseRejectionTracker({
    allRejections: true,
    onUnhandled: (_id, error) => {
      reportClientError({ error, fatal: false, context: 'unhandledrejection' });
    },
  });
}
