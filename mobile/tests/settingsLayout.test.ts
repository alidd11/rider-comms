import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const settingsSource = await readFile(new URL('../src/screens/SettingsScreen.tsx', import.meta.url), 'utf8')
  + await readFile(new URL('../src/screens/SettingsScreen.styles.ts', import.meta.url), 'utf8');

describe('Settings mockup contract', () => {
  it('keeps the approved shallow root hierarchy in order', () => {
    const labels = [
      'Account',
      'Communication',
      'Map & Navigation',
      'Units & Preferences',
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
    // The profile lives behind View profile in the menu, not on the root.
    assert.ok(!settingsSource.includes('profileCard'));
    assert.ok(!settingsSource.includes("openPage('help')"));
    assert.match(settingsSource, /paddingBottom: insets\.bottom \+ spacing\.md/);
    assert.match(settingsSource, /scroll: \{[^\n]*paddingHorizontal: spacing\.md/);
    assert.match(settingsSource, /settingsGroup: \{[^\n]*backgroundColor: colors\.surfaceRaised/);
    assert.match(settingsSource, /<RiderAvatar avatarId=\{avatarId\} size=\{112\} \/>/);
    assert.match(settingsSource, /<Ionicons name="chevron-forward" size=\{14\} color=\{colors\.textMuted\} \/>/);
    assert.match(settingsSource, /settingsGroup:\s*\{[^\n]*borderRadius:\s*8/);
    assert.match(settingsSource, /settingRow:\s*\{[^\n]*minHeight:\s*48/);
    assert.match(settingsSource, /secondarySettingsGroup:\s*\{\s*marginTop:\s*12\s*\}/);
    assert.match(settingsSource, /signOutGroup:\s*\{\s*marginTop:\s*12\s*\}/);
  });

  it('opens every category as its own full page with all of its controls', () => {
    for (const key of ['accountHub', 'communication', 'mapNavigation', 'unitsPreferences', 'about']) {
      assert.ok(settingsSource.includes(`page === '${key}'`), `Missing Settings page: ${key}`);
      assert.ok(settingsSource.includes(`openPage('${key}')`), `Settings root does not open page: ${key}`);
    }
    // Every page is the same SettingsPage route, so opening one must push a
    // new screen (navigate() would replace the current page and break Back).
    assert.ok(settingsSource.includes("navigation.push('SettingsPage', { page: 'editProfile' })"));
    assert.ok(!settingsSource.includes("navigation.navigate('SettingsPage'"));
    // Opened from the avatar menu instead: View profile, Edit profile, Help.
    for (const key of ['myProfile', 'editProfile', 'help']) {
      assert.ok(settingsSource.includes(`page === '${key}'`), `Missing menu page: ${key}`);
    }
    // No nested sheets: a category's controls are on its page.
    assert.ok(!settingsSource.includes('<SettingsSheet'));
    assert.ok(!settingsSource.includes('setActiveSheet('));
    // Every control in one place: the profile is viewed and edited on its
    // own pages, the plan only on Billing, and Account is sign-in, devices
    // and data.
    assert.match(settingsSource, /function MyProfilePage\(\)[\s\S]*Edit profile[\s\S]*title="Connected profiles"/);
    assert.match(settingsSource, /function EditProfilePage\(\)[\s\S]*title="Avatar"[\s\S]*title="Name"[\s\S]*title="Connected profiles"/);
    assert.match(settingsSource, /function AccountPage\(\)[\s\S]*title="Email"[\s\S]*title="Signed-in devices"[\s\S]*title="Account and data"/);
    const accountPage = settingsSource.slice(settingsSource.indexOf('function AccountPage()'), settingsSource.indexOf('function CommunicationPage()'));
    assert.ok(!accountPage.includes('title="Plan"') && !accountPage.includes('Display name'));
    // No settings for features that don't work yet (App Review 2.1): push
    // delivery and offline map downloads.
    assert.ok(!settingsSource.includes("'notifications'"));
    assert.ok(!settingsSource.includes('offlineMaps'));
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
    assert.match(settingsSource, /<Ionicons name=\{icon\} size=\{20\} color=\{danger \? colors\.danger : colors\.textPrimary\}/);
    assert.match(settingsSource, /<Ionicons name="chevron-forward" size=\{14\} color=\{colors\.textMuted\}/);
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
    assert.ok(!settingsSource.includes('Offline Maps'));
  });
});
