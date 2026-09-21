import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const settingsSource = await readFile(new URL('../src/screens/SettingsScreen.tsx', import.meta.url), 'utf8');

describe('Settings mockup contract', () => {
  it('keeps the approved shallow root hierarchy in order', () => {
    const labels = [
      'Account',
      'Communication',
      'Map & Navigation',
      'Offline Maps',
      'Units & Preferences',
      'Help & Support',
      'About',
      'Sign Out',
    ];

    let cursor = -1;
    for (const label of labels) {
      const next = settingsSource.indexOf(`title="${label}"`, cursor + 1);
      assert.ok(next > cursor, `Expected Settings root label ${label} after the previous category`);
      cursor = next;
    }

    assert.match(settingsSource, /icon="apps-outline" title="Units & Preferences" last/);
    assert.match(settingsSource, /title="Sign Out" danger showChevron=\{false\} last/);
  });

  it('keeps mockup card and row geometry compact', () => {
    assert.match(settingsSource, /profileCard:\s*\{[\s\S]*?minHeight:\s*92[\s\S]*?marginBottom:\s*8[\s\S]*?borderRadius:\s*8/);
    assert.match(settingsSource, /paddingBottom: insets\.bottom \+ spacing\.md/);
    assert.match(settingsSource, /scroll: \{[^\n]*paddingHorizontal: spacing\.md/);
    assert.match(settingsSource, /settingsGroup: \{[^\n]*backgroundColor: colors\.surfaceRaised/);
    assert.match(settingsSource, /backgroundColor: colors\.surfaceRaised,[\s\S]*?profileSaveStatus:/);
    assert.match(settingsSource, /<RiderAvatar avatarId=\{avatarId\} size=\{64\} \/>/);
    assert.match(settingsSource, /<Ionicons name="chevron-forward" size=\{16\} color=\{colors\.textMuted\} \/>/);
    assert.match(settingsSource, /settingsGroup:\s*\{[^\n]*borderRadius:\s*8/);
    assert.match(settingsSource, /settingRow:\s*\{[^\n]*minHeight:\s*48/);
    assert.match(settingsSource, /secondarySettingsGroup:\s*\{\s*marginTop:\s*12\s*\}/);
    assert.match(settingsSource, /signOutGroup:\s*\{\s*marginTop:\s*12\s*\}/);
  });

  it('preserves real controls behind the new category hierarchy', () => {
    for (const key of ['accountHub', 'communication', 'mapNavigation', 'offlineMaps', 'unitsPreferences', 'help', 'about']) {
      assert.ok(settingsSource.includes(`activeSheet === '${key}'`), `Missing Settings category sheet: ${key}`);
    }

    assert.ok(settingsSource.includes("setActiveSheet('navigation')"));
    assert.ok(settingsSource.includes("setActiveSheet('notifications')"));
    assert.ok(settingsSource.includes("setActiveSheet('privacy')"));
    assert.ok(settingsSource.includes("setActiveSheet('sessions')"));
    assert.ok(settingsSource.includes("navigation.navigate('Billing')"));
    assert.ok(settingsSource.includes("navigation.navigate('Legal')"));
  });

  it('matches backend and PWA profile field limits', () => {
    assert.match(settingsSource, /value=\{nameDraft\}[\s\S]*?maxLength=\{50\}/);
    assert.match(settingsSource, /value=\{handleDraft\}[\s\S]*?maxLength=\{25\}/);
  });

  it('validates and normalizes profile fields before syncing', () => {
    assert.ok(settingsSource.includes("raw.startsWith('@') ? raw : `@${raw}`"));
    assert.match(settingsSource, /Use 3–24 letters, numbers or underscores for your handle\./);
    assert.ok(settingsSource.includes("draft.trim().replace(/^@/, '')"));
    assert.match(settingsSource, /Use up to 30 letters, numbers, dots or underscores\./);
    assert.match(settingsSource, /accessibilityRole="alert"/);
  });

  it('keeps the root visually quiet like the approved mockup', () => {
    assert.match(settingsSource, /<Ionicons name=\{icon\} size=\{19\} color=\{danger \? colors\.danger : colors\.textPrimary\}/);
    assert.match(settingsSource, /<Ionicons name="chevron-forward" size=\{16\} color=\{colors\.textMuted\}/);
    assert.doesNotMatch(settingsSource, /\{\(saving \|\| profileError\) \? \(/);
    assert.match(settingsSource, /accessibilityLabel="Dismiss settings error"/);
  });

  it('keeps Settings controls accessible', () => {
    assert.match(settingsSource, /accessibilityRole="radio"/);
    assert.match(settingsSource, /accessibilityState=\{\{ selected \}\}/);
    assert.match(settingsSource, /accessibilityLabel=\{label\}/);
    assert.match(settingsSource, /accessibilityRole="radiogroup"/);
  });

  it('keeps distance-unit wording aligned with the PWA', () => {
    assert.ok(settingsSource.includes("name: 'Kilometres'"));
    assert.ok(settingsSource.includes("blurb: 'Use miles and mph.'"));
    assert.ok(settingsSource.includes("blurb: 'Use kilometres and km/h.'"));
  });

  it('does not advertise offline map downloads that do not exist', () => {
    assert.ok(settingsSource.includes('Offline map downloads are not available in this build yet.'));
  });
});
