import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  LIVE_ACTIVITY_MIN_UPDATE_MS,
  NavigationLiveActivity,
  liveActivityImageForManeuver,
  navigationLiveActivityContent,
  type LiveActivityApi,
  type NavigationLiveActivityContent,
} from '../src/navigationLiveActivity.ts';

const input = { maneuver: 'turn-left', instruction: 'Turn left onto Salterton Rd', distanceLabel: '420 ft', arrivalLabel: '21:27', progress: 0.4237 };

function fakeApi(startId: string | null = 'activity-1') {
  const calls: Array<[string, NavigationLiveActivityContent]> = [];
  const api: LiveActivityApi = {
    startActivity: (state) => { calls.push(['start', state]); return startId ?? undefined; },
    updateActivity: (_id, state) => { calls.push(['update', state]); },
    stopActivity: (_id, state) => { calls.push(['stop', state]); },
  };
  return { api, calls };
}

describe('navigation Live Activity', () => {
  it('picks an arrow for every Google maneuver', () => {
    assert.equal(liveActivityImageForManeuver('turn-left'), 'nav_left');
    assert.equal(liveActivityImageForManeuver('turn-sharp-right'), 'nav_right');
    assert.equal(liveActivityImageForManeuver('turn-slight-left'), 'nav_slight_left');
    assert.equal(liveActivityImageForManeuver('fork-right'), 'nav_slight_right');
    assert.equal(liveActivityImageForManeuver('ramp-left'), 'nav_slight_left');
    assert.equal(liveActivityImageForManeuver('roundabout-left'), 'nav_roundabout');
    assert.equal(liveActivityImageForManeuver('uturn-right'), 'nav_uturn');
    assert.equal(liveActivityImageForManeuver('straight'), 'nav_straight');
    assert.equal(liveActivityImageForManeuver(''), 'nav_straight');
    assert.equal(liveActivityImageForManeuver('arrive'), 'nav_arrive');
  });

  it('builds the lock-screen content', () => {
    assert.deepEqual(navigationLiveActivityContent(input), {
      title: '420 ft · Turn left onto Salterton Rd',
      subtitle: 'Arrive 21:27',
      progressBar: { progress: 0.42 },
      imageName: 'nav_left',
      dynamicIslandImageName: 'nav_left',
    });
    assert.equal(navigationLiveActivityContent({ ...input, progress: Number.NaN }).progressBar.progress, 0);
    assert.equal(navigationLiveActivityContent({ ...input, progress: 3 }).progressBar.progress, 1);
  });

  it('starts once, skips identical updates and stops with a final state', () => {
    const { api, calls } = fakeApi();
    let now = 0;
    const activity = new NavigationLiveActivity(api, { now: () => now });
    now = 0;
    const first = navigationLiveActivityContent(input);
    activity.update(first);
    activity.update(first);
    now = LIVE_ACTIVITY_MIN_UPDATE_MS;
    activity.update(navigationLiveActivityContent({ ...input, distanceLabel: '300 ft' }));
    assert.equal(activity.active, true);
    activity.stop('You have arrived');
    assert.deepEqual(calls.map(([kind]) => kind), ['start', 'update', 'stop']);
    assert.equal(calls[2]![1].title, 'You have arrived');
    assert.equal(activity.active, false);
    activity.stop();
    assert.equal(calls.length, 3);
  });

  it('does nothing without the module and survives native errors', () => {
    new NavigationLiveActivity(null).update(navigationLiveActivityContent(input));
    const refused = fakeApi(null);
    const activity = new NavigationLiveActivity(refused.api);
    activity.update(navigationLiveActivityContent(input));
    assert.equal(activity.active, false);
    const throwing = new NavigationLiveActivity({
      startActivity: () => { throw new Error('Live Activities are off'); },
      updateActivity: () => {},
      stopActivity: () => {},
    });
    assert.doesNotThrow(() => throwing.update(navigationLiveActivityContent(input)));
    assert.equal(throwing.active, false);
  });

  it('refreshes the distance at most every few seconds but a new turn immediately', () => {
    const { api, calls } = fakeApi();
    let now = 0;
    const timers: Array<{ at: number; run: () => void }> = [];
    const activity = new NavigationLiveActivity(api, {
      now: () => now,
      setTimer: (run, ms) => { timers.push({ at: now + ms, run }); return timers.length as unknown as ReturnType<typeof setTimeout>; },
      clearTimer: () => { timers.length = 0; },
    });
    activity.update(navigationLiveActivityContent(input));
    now = 1000;
    activity.update(navigationLiveActivityContent({ ...input, distanceLabel: '400 ft' }));
    now = 2000;
    activity.update(navigationLiveActivityContent({ ...input, distanceLabel: '380 ft' }));
    assert.equal(calls.length, 1, 'distance-only changes wait');
    assert.equal(timers.length, 1);

    now = timers[0]!.at;
    timers.shift()!.run();
    assert.equal(calls.length, 2);
    assert.equal(calls[1]![1].title, '380 ft · Turn left onto Salterton Rd', 'the newest distance is sent');

    now += 500;
    activity.update(navigationLiveActivityContent({ ...input, maneuver: 'turn-right', instruction: 'Turn right', distanceLabel: '0.5 mi' }));
    assert.equal(calls.length, 3, 'a new turn updates straight away');
    assert.equal(calls[2]![1].imageName, 'nav_right');
  });
});
