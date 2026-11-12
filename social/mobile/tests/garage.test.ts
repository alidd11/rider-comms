import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PROFILE, EMPTY_GARAGE_DRAFT, validateProfile, createGarageEntry,
  addGarageEntry, removeGarageEntry, updateGarageVisibility, parsePreviewState
} from '../src/garage.ts';

test('social profile validation honours separate public/private settings', () => {
  const profile = validateProfile({ displayName: '  Demo Rider  ', bio: '  Weekend routes  ', visibility: 'private' });
  assert.deepEqual(profile, { ok: true, value: { displayName: 'Demo Rider', bio: 'Weekend routes', visibility: 'private' } });
  assert.equal(validateProfile({ displayName: ' ', bio: '', visibility: 'private' }).ok, false);
  assert.equal(validateProfile({ displayName: 'OK', bio: 'x'.repeat(161), visibility: 'public' }).ok, false);
  assert.equal(validateProfile({ displayName: 'OK', bio: '', visibility: 'anyone' as 'public' }).ok, false);
});

test('garage starts private and requires a valid make, model, optional year and note', () => {
  assert.equal(EMPTY_GARAGE_DRAFT.visibility, 'private');
  assert.equal(createGarageEntry(EMPTY_GARAGE_DRAFT, 'one', 2026).ok, false);
  const draft = { ...EMPTY_GARAGE_DRAFT, kind: 'Bicycle' as const, make: '  Trek  ', model: '  Domane ', year: '2025', notes: ' Road build ' };
  const parsed = createGarageEntry(draft, 'one', 2026);
  assert.deepEqual(parsed, { ok: true, value: {
    id: 'one', kind: 'Bicycle', make: 'Trek', model: 'Domane', year: 2025, notes: 'Road build', visibility: 'private'
  } });
  assert.equal(createGarageEntry({ ...draft, year: '2040' }, 'one', 2026).ok, false);
  assert.equal(createGarageEntry({ ...draft, year: 'junk' }, 'one', 2026).ok, false);
  assert.equal(createGarageEntry({ ...draft, notes: 'x'.repeat(241) }, 'one', 2026).ok, false);
  assert.equal(createGarageEntry({ ...draft, kind: 'boat' as 'Car' }, 'one', 2026).ok, false);
});

test('garage refuses duplicates, limits size, allows privacy changes and deletion', () => {
  const sample = createGarageEntry({ ...EMPTY_GARAGE_DRAFT, make: 'Honda', model: 'PCX' }, 'vehicle', 2026);
  assert.equal(sample.ok, true);
  if (!sample.ok) return;
  assert.deepEqual(addGarageEntry([], sample.value), { ok: true, value: [sample.value] });
  assert.equal(addGarageEntry([sample.value], sample.value).ok, false);
  assert.equal(addGarageEntry(Array.from({ length: 12 }, (_, i) => ({ ...sample.value, id: String(i) })), sample.value).ok, false);
  assert.equal(updateGarageVisibility([sample.value], 'vehicle', 'public')[0].visibility, 'public');
  assert.deepEqual(removeGarageEntry([sample.value], 'vehicle'), []);
});

test('malformed device storage is safely reset or filtered without identity crossover', () => {
  assert.deepEqual(parsePreviewState(null, 2026), { profile: DEFAULT_PROFILE, garage: [] });
  const parsed = parsePreviewState({
    profile: { displayName: ' Demo ', bio: ' Garage ', visibility: 'private' },
    garage: [
      { id: 'a', kind: 'Car', make: 'Ford', model: 'Fiesta', notes: '', visibility: 'private', year: 2019 },
      { id: 'a', kind: 'Car', make: 'BMW', model: '320', notes: '', visibility: 'public', year: 2021 },
      { id: 'b', kind: 'Car', make: '', model: 'Unknown', notes: '', visibility: 'public' },
      { id: 'c', kind: 'Motorcycle', make: 'Honda', model: 'PCX', notes: '', visibility: 'public', year: 'bad' }
    ]
  }, 2026);
  assert.equal(parsed.garage.length, 1);
  assert.equal(parsed.garage[0].visibility, 'private');
  assert.equal(parsed.profile.displayName, 'Demo');
});
