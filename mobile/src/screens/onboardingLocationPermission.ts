/**
 * Foreground location is optional, but a pending native iOS permission prompt
 * must never be dismissed by advancing onboarding after a fixed timeout.
 * The request runs exactly once. After the initial wait, only a confirmed
 * determined permission status may unblock a hung native request bridge.
 */
export const ONBOARDING_LOCATION_PERMISSION_WAIT_MS = 8000;
export const ONBOARDING_LOCATION_PERMISSION_POLL_MS = 1000;

type ForegroundStatus = { status: 'undetermined' | 'granted' | 'denied' };

/** Wait for a request to settle, or for the OS to report a final permission. */
export async function waitForLocationPermissionOrTimeout(
  requestPermission: () => Promise<unknown>,
  readPermission: () => Promise<ForegroundStatus>,
): Promise<void> {
  let settled = false;
  // Rejections are non-fatal: location is optional, but the native dialog
  // should have finished before navigation advances.
  const pending = Promise.resolve().then(requestPermission).then(
    () => { settled = true; },
    () => { settled = true; },
  );
  const waitAtMost = async (delay: number): Promise<void> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        pending,
        new Promise<void>((resolve) => { timer = setTimeout(resolve, delay); }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };
  await waitAtMost(ONBOARDING_LOCATION_PERMISSION_WAIT_MS);
  while (!settled) {
    // The OS can finalise the permission while its Expo request promise is
    // still hung. Never interpret an open (undetermined) prompt as a timeout.
    const status = await Promise.race([
      Promise.resolve().then(readPermission).then(value => value?.status, () => undefined),
      pending.then(() => undefined),
    ]);
    if (settled) break;
    if (status === 'granted' || status === 'denied') return;
    await waitAtMost(ONBOARDING_LOCATION_PERMISSION_POLL_MS);
  }
}
