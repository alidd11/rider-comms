import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const native = readFileSync(new URL('../src/ride/HostPanel.tsx', import.meta.url), 'utf8');
const web = readFileSync(new URL('../../docs/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../docs/app.css', import.meta.url), 'utf8');

test('Ride cockpit keeps join and host affordances consistent on PWA and native', () => {
  for (const source of [native, web]) {
    for (const label of ['PRIVATE GROUP RIDES', 'Ride with your crew.', '01 / JOIN', '02 / HOST', 'Join a ride', 'Start a ride']) {
      assert.ok(source.includes(label), `Missing ride cockpit label: ${label}`);
    }
  }
  assert.match(web, /id="joinRideForm"/);
  assert.match(web, /id="createRideBtn"/);
  assert.match(native, /normalizeRideCodeInput/);
  assert.match(css, /ride-hero-content/);
});

test('Active ride shares invite cautiously and never conceals location opt-in state', () => {
  const inviteNote = 'Only share this invite with riders you want in your group.';
  assert.ok(web.includes(inviteNote));
  assert.ok(native.includes(inviteNote));
  assert.match(web, /id="activeRideLocationConsent" type="checkbox" role="switch"/);
  assert.match(web, /ride-location-badge-on/);
  assert.match(native, /shareRideLocation \? 'On' : 'Off'/);
  assert.match(native, /<Switch[\s\S]*?accessibilityLabel="Share my location with this ride"/);
});
