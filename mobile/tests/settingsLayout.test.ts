import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const settingsSource = await readFile(new URL('../src/screens/SettingsScreen.tsx', import.meta.url), 'utf8')
  + await readFile(new URL('../src/screens/SettingsScreen.styles.ts', import.meta.url), 'utf8')
  + await readFile(new URL('../src/screens/SettingsListUi.tsx', import.meta.url), 'utf8');

describe('Settings mockup contract', () => {
  it('is Waze-style: a root of categories, each opening its own page', () => {
    const root = settingsSource.slice(settingsSource.indexOf('export function SettingsScreen()'), settingsSource.indexOf('function GeneralPage('));
    const categories = ['title="General"', 'title="Map & navigation"', 'title="Voice and sound"', 'title="Riding"', 'title="Ride Safe"', 'title="Vehicle details"', 'title="Notifications"', 'title="Account"', 'title="Account and login"', 'title="Privacy"', 'title="About"'];
    let cursor = -1;
    for (const label of categories) {
      const next = root.indexOf(label, cursor + 1);
      assert.ok(next > cursor, `Expected ${label} after the previous Settings category`);
      cursor = next;
    }
    assert.equal((root.match(/<CategoryRow /g) ?? []).length, 9);
    assert.match(root, /Version \{appVersion\}/);
    // The pages, in the same order as the PWA's.
    const pages = settingsSource.slice(settingsSource.indexOf('function GeneralPage('), settingsSource.indexOf('const VISIBILITY_LABELS'));
    const rows = ['title="Distance units"', 'title="Navigation app"', 'title="Avoid motorways"', 'title="Avoid tolls"', 'title="Spoken directions"', 'title="Vehicle type"', 'title="Notifications on this device"', 'title="Friend requests"', 'title="Messages"', 'title="Ride Safe auto-lock"',
      'title="Nearby rider visibility"', 'title="Blocked riders"', 'title="Login info"', 'title="Email"', 'title="Signed-in devices"',
      'title="Advanced"', 'title="Sign out"', 'title="Reset settings"', 'title="Delete account"'];
    cursor = -1;
    for (const label of rows) {
      const next = pages.indexOf(label, cursor + 1);
      assert.ok(next > cursor, `Expected ${label} after the previous Settings row`);
      cursor = next;
    }
    assert.equal((pages.match(/<SwitchRow /g) ?? []).length, 8);
    assert.match(pages, /RIDER_VEHICLE_OPTIONS\.map[\s\S]*<CheckRow /);
    assert.match(pages, /<SegmentedRow first title="Distance units"/);
    assert.match(pages, /title="Navigation app" value=\{navigationAppLabel\}/);
    assert.match(pages, /title="Email" value=\{emailVerified \? 'Verified' : 'Not verified'\}/);
    // Turning Ride Safe off asks first; deleting the account asks first.
    assert.match(pages, /function changeRideSafe[\s\S]*Turn off Automatic Ride Safe\?/);
    assert.match(pages, /function confirmDeleteAccount[\s\S]*Delete account\?/);
    assert.match(pages, /title="Delete account" danger chevron=\{false\}/);
    // Sub-pages have back and an X that closes every Settings level.
    assert.match(settingsSource, /MENU_PAGES\.has\(page\) \? \(\) => navigation\.popToTop\(\) : \(\) => navigation\.popTo\('Settings'\)/);
    assert.match(settingsSource, /onClose=\{close\}/);
    for (const old of ['Communication', 'Units & Preferences', 'accountHub', 'unitsPreferences']) {
      assert.ok(!settingsSource.includes(old), `Old Settings category still present: ${old}`);
    }
  });

  it('keeps settings rows compact and consistent', () => {
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
  });

  it('opens a page only for choices and lists', () => {
    for (const key of ['general', 'mapNavigation', 'voiceSound', 'rideSafe', 'vehicle', 'notifications', 'account', 'privacy', 'about']) {
      assert.ok(settingsSource.includes(`page === '${key}'`), `Missing Settings page: ${key}`);
      assert.ok(settingsSource.includes(`openPage('${key}')`), `Settings root does not open page: ${key}`);
    }
    for (const key of ['navigationApp', 'blockedRiders', 'email', 'devices']) {
      assert.ok(settingsSource.includes(`page === '${key}'`), `Missing Settings page: ${key}`);
      assert.ok(settingsSource.includes(`navigation.push('SettingsPage', { page: '${key}' })`), `No row opens page: ${key}`);
    }
    // Every page is the same SettingsPage route, so opening one must push a
    // new screen (navigate() would replace the current page and break Back).
    assert.ok(settingsSource.includes("navigation.push('SettingsPage', { page: 'editProfile' })"));
    assert.ok(!settingsSource.includes("navigation.navigate('SettingsPage'"));
    // Opened from the avatar menu instead: View profile, Edit profile, Help.
    for (const key of ['myProfile', 'editProfile', 'help']) {
      assert.ok(settingsSource.includes(`page === '${key}'`), `Missing menu page: ${key}`);
    }
    assert.ok(!settingsSource.includes('<SettingsSheet'));
    assert.ok(!settingsSource.includes('setActiveSheet('));
    assert.match(settingsSource, /function MyProfilePage\(\)[\s\S]*Edit profile[\s\S]*title="Connected profiles"/);
    assert.match(settingsSource, /function EditProfilePage\(\)[\s\S]*title="Avatar"[\s\S]*title="Name"[\s\S]*title="Connected profiles"/);
    assert.match(settingsSource, /function DevicesPage\(\)[\s\S]*Refresh devices/);
    assert.match(settingsSource, /function EmailPage\(\)[\s\S]*Resend verification email/);
    // No settings for features that don't work yet (App Review 2.1):
    // offline map downloads. Notifications are real now: the page registers
    // this phone and the switches are the server-side preferences.
    assert.ok(!settingsSource.includes('offlineMaps'));
    assert.match(settingsSource, /function NotificationsPage\(\)[\s\S]*enablePush\(client, riderId\)[\s\S]*setNotifyInvites[\s\S]*setNotifyChat/);
    // Help & Support: contact first, then common questions, riding safely,
    // and the legal pages as rows.
    assert.match(settingsSource, /function HelpPage\(\)[\s\S]*Contact support[\s\S]*title="Common questions"[\s\S]*title="Riding safely"[\s\S]*title="Legal"[\s\S]*title="Privacy Policy"[\s\S]*title="Terms of Service"[\s\S]*title="Community Guidelines"/);
    assert.match(settingsSource, /accessibilityState=\{\{ expanded: open \}\}/);
    // Off switches keep a visible track.
    assert.match(settingsSource, /trackColor=\{\{ false: colors\.switchTrackOff/);
  });

  it('matches backend and PWA profile field limits', () => {
    assert.match(settingsSource, /value=\{nameDraft\}[\s\S]*?maxLength=\{50\}/);
    assert.match(settingsSource, /value=\{handleDraft\}[\s\S]*?maxLength=\{25\}/);
  });

  it('validates and normalizes profile fields before syncing', () => {
    assert.ok(settingsSource.includes("rawHandle.startsWith('@') ? rawHandle : `@${rawHandle}`"));
    // Edit profile saves on Save, like the PWA, not field by field on blur.
    assert.match(settingsSource, /function EditProfilePage\(\)[\s\S]*testID="save-profile"[\s\S]*Save changes/);
    assert.doesNotMatch(settingsSource.slice(settingsSource.indexOf('function EditProfilePage()'), settingsSource.indexOf('function AccountPage()')), /onBlur=/);
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
    assert.match(settingsSource, /<Switch\s+accessibilityLabel=\{title\}/);
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
