/**
 * Foreground location is optional, even at first launch. iOS has occasionally
 * left the native permission request unresolved in simulator UI tests; that
 * must not permanently block an authenticated rider from reaching the map.
 * This helper never grants permission and never starts a request by itself.
 */
export const ONBOARDING_LOCATION_PERMISSION_WAIT_MS = 8000;

export async function waitForLocationPermissionOrTimeout(
  requestPermission: () => Promise<unknown>,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ONBOARDING_LOCATION_PERMISSION_WAIT_MS);
  });
  try {
    await Promise.race([
      Promise.resolve().then(requestPermission).then(() => undefined, () => undefined),
      timedOut,
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
