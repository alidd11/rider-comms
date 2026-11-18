/**
 * Structured logs: one JSON object per line, so Railway's log search can
 * filter by event, level, request or rider. Every line carries the time, the
 * service and the deployed commit, so a line can be traced to the code that
 * wrote it. Never log email addresses, passwords, tokens or message text.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

const SERVICE = 'rider-comms-backend';

function commit(): string | undefined {
  return process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 12) || undefined;
}

function replica(): string | undefined {
  return process.env.RAILWAY_REPLICA_ID || undefined;
}

/** The line as written, for tests and for the few callers that log elsewhere. */
export function logLine(level: LogLevel, event: string, fields: Record<string, unknown> = {}, now = new Date()): string {
  return JSON.stringify({ ts: now.toISOString(), level, event, service: SERVICE, commit: commit(), replica: replica(), ...fields });
}

export function log(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
  const line = logLine(level, event, fields);
  if (level === 'error' || level === 'fatal') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export function errorFields(error: unknown): { message: string; stack?: string } {
  return error instanceof Error ? { message: error.message, stack: error.stack } : { message: String(error) };
}
