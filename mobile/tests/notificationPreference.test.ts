import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveNotificationPreference } from '../src/notifications/preference.ts';

describe('resolveNotificationPreference', () => {
  it('turns off without requesting permission', async () => {
    let requests = 0;
    const result = await resolveNotificationPreference(false, async () => {
      requests += 1;
      return true;
    });
    assert.equal(result, false);
    assert.equal(requests, 0);
  });

  it('only enables after the OS grants permission', async () => {
    assert.equal(await resolveNotificationPreference(true, async () => true), true);
    assert.equal(await resolveNotificationPreference(true, async () => false), false);
  });

  it('propagates permission request failures so the UI can show an error', async () => {
    await assert.rejects(
      () => resolveNotificationPreference(true, async () => { throw new Error('permission API failed'); }),
      /permission API failed/
    );
  });
});
