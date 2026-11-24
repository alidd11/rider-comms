import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const native = readFileSync(new URL('../src/screens/MenuScreen.tsx', import.meta.url), 'utf8');
const web = readFileSync(new URL('../../docs/index.html', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../../docs/app.css', import.meta.url), 'utf8');
const events = readFileSync(new URL('../../docs/app/18-map-init-events.js', import.meta.url), 'utf8');

test('Menu stays fixed when content fits but never traps short-screen accessibility users', () => {
  assert.match(native, /scrollEnabled=\{menuNeedsScroll\}/);
  assert.match(native, /menuContentHeight > menuHeight \+ 2/);
  assert.match(native, /onContentSizeChange=/);
  assert.match(native, /minHeight: 50/);
  assert.match(styles, /\.app-menu\.app-menu-needs-scroll\{overflow-y:auto/);
  assert.match(events, /menu\.scrollHeight > menu\.clientHeight \+ 2/);
  assert.match(events, /ResizeObserver/);
});

test('Ride stats report the truthful local recent-ride scope in both clients', () => {
  for (const content of [native, web]) {
    assert.match(content, /Recent rides/);
    assert.match(content, /Last 10 · this device/);
    assert.match(content, /Recent ride totals on this device/);
  }
});
