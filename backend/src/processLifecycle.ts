// Process plumbing for the production entry point: recurring maintenance
// jobs, graceful shutdown and last-resort crash handling. Kept apart from
// server.ts so each piece can be exercised without real timers or signals.

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function logError(event: string, error: unknown): void {
  console.error(JSON.stringify({ level: 'error', event, message: errorMessage(error) }));
}

/** Runs one maintenance pass, logging (never throwing) a failure. */
export async function runMaintenance(failureEvent: string, task: () => Promise<unknown>): Promise<void> {
  await task().catch((error) => logError(failureEvent, error));
}

/** Repeats a maintenance task without keeping the process alive. */
export function scheduleMaintenance(intervalMs: number, failureEvent: string, task: () => Promise<unknown>): NodeJS.Timeout {
  const timer = setInterval(() => void runMaintenance(failureEvent, task), intervalMs);
  timer.unref();
  return timer;
}

export interface ShutdownOptions {
  server: { close: (callback: (error?: Error) => void) => unknown };
  timers: readonly NodeJS.Timeout[];
  /** Fire-and-forget work at the start of shutdown (flush alerts, stop listeners). */
  beforeClose: () => void;
  /** Releases resources once the server has stopped accepting requests. */
  closeResources: () => Promise<void>;
  exit: (code: number) => void;
  setExitCode: (code: number) => void;
  forceExitAfterMs?: number;
}

/** A signal handler that drains the server, then closes resources, at most once. */
export function createShutdown(options: ShutdownOptions): (signal: NodeJS.Signals) => void {
  let stopping = false;
  return (signal) => {
    if (stopping) return;
    stopping = true;
    for (const timer of options.timers) clearInterval(timer);
    options.beforeClose();
    console.log(JSON.stringify({ level: 'info', event: 'shutdown_started', signal }));
    const forceExit = setTimeout(() => {
      console.error(JSON.stringify({ level: 'error', event: 'shutdown_timeout', signal }));
      options.exit(1);
    }, options.forceExitAfterMs ?? 10_000);
    forceExit.unref();
    options.server.close(async (error) => {
      if (error) {
        logError('shutdown_failed', error);
        options.setExitCode(1);
      }
      try {
        await options.closeResources();
        console.log(JSON.stringify({ level: 'info', event: 'shutdown_complete', signal }));
      } catch (resourceError) {
        logError('database_shutdown_failed', resourceError);
        options.setExitCode(1);
      } finally {
        clearTimeout(forceExit);
      }
    });
  };
}

export interface CrashHandlerOptions {
  report: (event: 'unhandled_rejection' | 'uncaught_exception', message: string) => void;
  flush: () => Promise<unknown>;
  exit: (code: number) => void;
}

/**
 * Last-resort crash logging. An unhandled rejection is logged and the
 * process keeps serving; an uncaught exception leaves the process in an
 * unknown state, so it is logged and the process exits for the host to
 * restart it.
 */
export function installCrashHandlers(target: Pick<NodeJS.EventEmitter, 'on'>, options: CrashHandlerOptions): void {
  target.on('unhandledRejection', (reason: unknown) => {
    const message = errorMessage(reason);
    console.error(JSON.stringify({ level: 'error', event: 'unhandled_rejection', message, stack: reason instanceof Error ? reason.stack : undefined }));
    options.report('unhandled_rejection', message);
  });
  target.on('uncaughtException', (error: Error) => {
    console.error(JSON.stringify({ level: 'fatal', event: 'uncaught_exception', message: error.message, stack: error.stack }));
    options.report('uncaught_exception', error.message);
    // Give the alert email a few seconds, then exit whatever happens.
    void options.flush().finally(() => options.exit(1));
  });
}
