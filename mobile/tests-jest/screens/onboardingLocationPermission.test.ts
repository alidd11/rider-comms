import { ONBOARDING_LOCATION_PERMISSION_WAIT_MS, waitForLocationPermissionOrTimeout } from '../../src/screens/onboardingLocationPermission';

describe('first-launch location permission wait', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

  it('requests permission exactly once and proceeds as soon as it resolves', async () => {
    const ask = jest.fn().mockResolvedValue({ status: 'granted' });
    await expect(waitForLocationPermissionOrTimeout(ask)).resolves.toBeUndefined();
    expect(ask).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('does not strand the rider when native permission prompt never resolves', async () => {
    const ask = jest.fn(() => new Promise(() => undefined));
    const finished = jest.fn();
    const pending = waitForLocationPermissionOrTimeout(ask).then(finished);
    await jest.advanceTimersByTimeAsync(ONBOARDING_LOCATION_PERMISSION_WAIT_MS - 1);
    expect(finished).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    await pending;
    expect(finished).toHaveBeenCalledTimes(1);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('treats permission refusal as non-blocking, not as permission granted', async () => {
    const denied = jest.fn().mockResolvedValue({ status: 'denied', granted: false });
    await expect(waitForLocationPermissionOrTimeout(denied)).resolves.toBeUndefined();
    expect(denied).toHaveBeenCalledTimes(1);
  });

  it('also proceeds if the native permission bridge throws or rejects', async () => {
    for (const request of [
      jest.fn().mockRejectedValue(new Error('unavailable')),
      jest.fn(() => { throw new Error('unavailable'); }),
    ]) {
      await expect(waitForLocationPermissionOrTimeout(request)).resolves.toBeUndefined();
      expect(request).toHaveBeenCalledTimes(1);
    }
  });
});
