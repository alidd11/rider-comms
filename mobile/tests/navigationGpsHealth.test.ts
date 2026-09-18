import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  NAV_GPS_PERMISSION_NOTICE,
  NAV_GPS_STALE_AFTER_MS,
  NAV_GPS_STALE_NOTICE,
  NAV_GPS_UNAVAILABLE_NOTICE,
  NavigationGpsTracker,
  isNavigationGpsNotice,
  navigationGpsNotice,
} from '../src/navigationGpsHealth.ts';

describe('navigation GPS health', () => {
  it('stays healthy until the fix becomes stale, then recovers on the next fix', () => {
    const tracker = new NavigationGpsTracker();
    tracker.begin(1_000);

    assert.equal(tracker.stateAt(1_000 + NAV_GPS_STALE_AFTER_MS), 'healthy');
    assert.equal(tracker.stateAt(1_001 + NAV_GPS_STALE_AFTER_MS), 'stale');
    assert.equal(navigationGpsNotice(tracker.stateAt()), NAV_GPS_STALE_NOTICE);

    assert.equal(tracker.recordFix(20_000), true);
    const recoveredHealth = tracker.stateAt(20_001);
    assert.equal(recoveredHealth, 'healthy');
    assert.equal(navigationGpsNotice(recoveredHealth), null);
  });

  it('distinguishes unavailable GPS from revoked location permission', () => {
    const tracker = new NavigationGpsTracker();
    tracker.begin(1_000);

    assert.equal(tracker.markUnavailable(false), 'unavailable');
    assert.equal(navigationGpsNotice(tracker.stateAt()), NAV_GPS_UNAVAILABLE_NOTICE);
    assert.equal(tracker.recordFix(2_000), true);

    assert.equal(tracker.markUnavailable(true), 'permission-denied');
    assert.equal(navigationGpsNotice(tracker.stateAt()), NAV_GPS_PERMISSION_NOTICE);
  });

  it('recognises only GPS notices so unrelated navigation messages are preserved', () => {
    assert.equal(isNavigationGpsNotice(NAV_GPS_STALE_NOTICE), true);
    assert.equal(isNavigationGpsNotice(NAV_GPS_UNAVAILABLE_NOTICE), true);
    assert.equal(isNavigationGpsNotice(NAV_GPS_PERMISSION_NOTICE), true);
    assert.equal(isNavigationGpsNotice('Could not reroute. Continue with caution.'), false);
    assert.equal(isNavigationGpsNotice(null), false);
  });
});
