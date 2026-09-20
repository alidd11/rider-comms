import assert from 'node:assert/strict';
import test from 'node:test';
import { AVATAR_FAMILIES, AVATAR_PRESETS, getAvatarFamily, getAvatarPreset } from '../src/settings/avatars.ts';

test('avatar collection keeps the approved 8/12/12 family split', () => {
  assert.deepEqual(AVATAR_FAMILIES.map((family) => family.id), ['helmet', 'motorbike', 'car']);
  assert.equal(AVATAR_PRESETS.length, 32);
  assert.equal(AVATAR_PRESETS.filter((preset) => preset.family === 'helmet').length, 8);
  assert.equal(AVATAR_PRESETS.filter((preset) => preset.family === 'motorbike').length, 12);
  assert.equal(AVATAR_PRESETS.filter((preset) => preset.family === 'car').length, 12);
});

test('avatar ids remain unique and vehicle families are addressable', () => {
  const ids = AVATAR_PRESETS.map((preset) => preset.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(getAvatarFamily('ember'), 'helmet');
  assert.equal(getAvatarFamily('bike_sport'), 'motorbike');
  assert.equal(getAvatarFamily('car_hatchback'), 'car');
  assert.equal(getAvatarPreset('bike_sport').label, 'Sport');
  assert.equal(getAvatarPreset('car_hatchback').label, 'Hatchback');
});

test('unknown avatar ids still fail safe to Ember', () => {
  assert.equal(getAvatarPreset('not-a-real-avatar').id, 'ember');
});
