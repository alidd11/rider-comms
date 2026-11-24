import { ONBOARDING_LOCATION_PERMISSION_WAIT_MS,
  ONBOARDING_LOCATION_PERMISSION_POLL_MS, waitForLocationPermissionOrTimeout } from '../../src/screens/onboardingLocationPermission';

describe('first-launch location permission wait', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

  it('requests permission once and continues when it resolves promptly', async () => {
    const request = jest.fn().mockResolvedValue({ status: 'granted' });
    const read = jest.fn();
    await expect(waitForLocationPermissionOrTimeout(request, read)).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledTimes(1);
    expect(read).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('still waits for a rider who answers an iOS prompt after ten seconds', async () => {
    const request = jest.fn(() => new Promise(resolve => {
      setTimeout(() => resolve({ status: 'granted' }), 10_000);
    }));
    const read = jest.fn().mockResolvedValue({ status: 'undetermined' });
    const finished = jest.fn();
    const pending = waitForLocationPermissionOrTimeout(request, read).then(finished);
    await jest.advanceTimersByTimeAsync(ONBOARDING_LOCATION_PERMISSION_WAIT_MS);
    expect(finished).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(2_000);
    await pending;
    expect(finished).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('does not advance while the iOS permission status remains undetermined', async () => {
    const request = jest.fn(() => new Promise(() => undefined));
    const read = jest.fn().mockResolvedValue({ status: 'undetermined' });
    const finished = jest.fn();
    void waitForLocationPermissionOrTimeout(request, read).then(finished);
    await jest.advanceTimersByTimeAsync(ONBOARDING_LOCATION_PERMISSION_WAIT_MS + 2 * ONBOARDING_LOCATION_PERMISSION_POLL_MS);
    expect(finished).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalled();
  });

  it('unblocks a hung Expo bridge when the OS reports a determined status', async () => {
    const request = jest.fn(() => new Promise(() => undefined));
    const read = jest.fn().mockResolvedValue({ status: 'denied' });
    const pending = waitForLocationPermissionOrTimeout(request, read);
    await jest.advanceTimersByTimeAsync(ONBOARDING_LOCATION_PERMISSION_WAIT_MS);
    await expect(pending).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('also treats a rejected permission request as optional', async () => {
    for (const request of [
      jest.fn().mockRejectedValue(new Error('unavailable')),
      jest.fn(() => { throw new Error('unavailable'); }),
    ]) {
      await expect(waitForLocationPermissionOrTimeout(request, jest.fn())).resolves.toBeUndefined();
      expect(request).toHaveBeenCalledTimes(1);
    }
  });
});
