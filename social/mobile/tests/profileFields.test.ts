import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_DISPLAY_NAME_LENGTH, profileChanges } from '../src/profileFields.ts';

const initial = { displayName: 'Sam', bio: 'Sunday rides.', avatarId: 'ember' };

test('only the fields that changed are sent, trimmed', () => {
  assert.deepEqual(profileChanges(initial, { ...initial }), { ok: true, changes: {} });
  assert.deepEqual(profileChanges(initial, { displayName: '  Sam  ', bio: ' Sunday rides. ', avatarId: 'ember' }),
    { ok: true, changes: {} });
  assert.deepEqual(profileChanges(initial, { displayName: ' Sam Rider ', bio: '', avatarId: 'ridge' }),
    { ok: true, changes: { displayName: 'Sam Rider', bio: '', avatarId: 'ridge' } });
});

test('a profile needs a name and stays within the Rider Comms limits', () => {
  assert.deepEqual(profileChanges(initial, { ...initial, displayName: '   ' }), { ok: false, error: 'Enter a name.' });
  assert.equal(profileChanges(initial, { ...initial, displayName: 'x'.repeat(MAX_DISPLAY_NAME_LENGTH) }).ok, true);
  assert.deepEqual(profileChanges(initial, { ...initial, displayName: 'x'.repeat(MAX_DISPLAY_NAME_LENGTH + 1) }),
    { ok: false, error: 'Names can be up to 50 characters.' });
  assert.equal(profileChanges(initial, { ...initial, bio: 'b'.repeat(160) }).ok, true);
  assert.deepEqual(profileChanges(initial, { ...initial, bio: 'b'.repeat(161) }),
    { ok: false, error: 'Bios can be up to 160 characters.' });
});
