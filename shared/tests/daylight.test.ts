import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isDarkOutside, solarElevationDegrees } from '../src/daylight.ts';

const LONDON = { lat: 51.5074, lon: -0.1278 };
const SYDNEY = { lat: -33.8688, lon: 151.2093 };

test('London is light at midsummer noon and dark at midnight', () => {
  assert.equal(isDarkOutside(LONDON.lat, LONDON.lon, new Date('2026-06-21T12:00:00Z')), false);
  assert.equal(isDarkOutside(LONDON.lat, LONDON.lon, new Date('2026-06-21T23:30:00Z')), true);
});

test('London goes dark just before 4pm in midwinter', () => {
  // Sunset is about 15:53 GMT on 21 December.
  assert.equal(isDarkOutside(LONDON.lat, LONDON.lon, new Date('2026-12-21T15:40:00Z')), false);
  assert.equal(isDarkOutside(LONDON.lat, LONDON.lon, new Date('2026-12-21T16:05:00Z')), true);
});

test('southern hemisphere and far-east longitudes work', () => {
  // 02:00 UTC is midday in Sydney; 12:00 UTC is 11pm there.
  assert.equal(isDarkOutside(SYDNEY.lat, SYDNEY.lon, new Date('2026-12-21T02:00:00Z')), false);
  assert.equal(isDarkOutside(SYDNEY.lat, SYDNEY.lon, new Date('2026-12-21T12:00:00Z')), true);
});

test('missing coordinates never force the dark map', () => {
  assert.equal(isDarkOutside(Number.NaN, 0), false);
});

test('the PWA copy gives the same answers', () => {
  const source = readFileSync(new URL('../../docs/app/01-bootstrap.js', import.meta.url), 'utf8');
  const start = source.indexOf('  function solarElevationDegrees(');
  const end = source.indexOf('  function isDarkOutside(');
  assert.ok(start > 0 && end > start, 'PWA solarElevationDegrees not found');
  const pwaElevation = new Function(`${source.slice(start, end)}; return solarElevationDegrees;`)() as typeof solarElevationDegrees;
  for (const iso of ['2026-03-20T06:10:00Z', '2026-06-21T20:00:00Z', '2026-11-11T16:20:00Z']) {
    for (const place of [LONDON, SYDNEY, { lat: 40.7128, lon: -74.006 }]) {
      const date = new Date(iso);
      assert.equal(pwaElevation(place.lat, place.lon, date), solarElevationDegrees(place.lat, place.lon, date));
    }
  }
});
