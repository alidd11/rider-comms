// Vendor-free crash reporting: the native app and the PWA post uncaught
// errors here and the backend writes them to its structured log, where the
// hosting provider's log search and alerting can pick them up. Nothing is
// stored in the database, and only bounded, non-content fields are accepted.

export const CLIENT_ERROR_PLATFORMS = ['ios', 'android', 'web'] as const;
export type ClientErrorPlatform = (typeof CLIENT_ERROR_PLATFORMS)[number];

const MAX_MESSAGE_LENGTH = 500;
const MAX_STACK_LENGTH = 4000;
const MAX_SHORT_FIELD_LENGTH = 64;

export interface ClientErrorReport {
  platform: ClientErrorPlatform;
  message: string;
  stack: string;
  fatal: boolean;
  appVersion: string;
  context: string;
}

// Reports are logged through JSON.stringify, which already escapes control
// characters; stripping them as well keeps single-line fields single-line.
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;
// eslint-disable-next-line no-control-regex -- as above, but keeps tab and newline for stacks
const CONTROL_CHARACTERS_EXCEPT_LINE_BREAKS = /[\u0000-\u0008\u000b-\u001f\u007f]/g;

function boundedString(value: unknown, max: number, keepLineBreaks = false): string {
  if (typeof value !== 'string') return '';
  return value.replace(keepLineBreaks ? CONTROL_CHARACTERS_EXCEPT_LINE_BREAKS : CONTROL_CHARACTERS, ' ').slice(0, max);
}

/** Returns a sanitised report, or null if the body isn't a valid report. */
export function parseClientErrorReport(body: Record<string, unknown>): ClientErrorReport | null {
  if (typeof body.platform !== 'string' || !CLIENT_ERROR_PLATFORMS.includes(body.platform as ClientErrorPlatform)) return null;
  const message = boundedString(body.message, MAX_MESSAGE_LENGTH).trim();
  if (!message) return null;
  return {
    platform: body.platform as ClientErrorPlatform,
    message,
    stack: boundedString(body.stack, MAX_STACK_LENGTH, true),
    fatal: body.fatal === true,
    appVersion: boundedString(body.appVersion, MAX_SHORT_FIELD_LENGTH).trim(),
    context: boundedString(body.context, MAX_SHORT_FIELD_LENGTH).trim(),
  };
}
