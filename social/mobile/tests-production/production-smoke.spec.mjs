/* global window, navigator */
import { test, expect } from '@playwright/test';
import { URL } from 'node:url';
import { mkdir } from 'node:fs/promises';

/**
 * Production app checks must use the real export with NO synthetic content.
 * Backend calls are strictly mocked; no personal accounts or credentials
 * enter the screenshot artifacts. Covers the exact dark/empty-state path that
 * fixture-heavy CI failed to verify before the reported blank Create screen.
 */
const backend = 'https://backend-production-7fa0.up.railway.app';
// Real account ID shape from backend/src/authStore.ts (generated, never a customer ID).
const testRiderId = 'rider_abcd1234';
const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,content-type',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
};

test.beforeEach(async ({ page }) => {
  await page.route(backend + '/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    const isMe = pathname === '/auth/me';
    const isFriends = pathname === '/riders/' + testRiderId + '/friends';
    const isConversations = pathname === '/conversations';
    const status = isMe || isFriends || isConversations ? 200 : 404;
    const body = isMe
      ? { riderId: testRiderId, username: 'production-smoke', emailVerified: true,
          termsAccepted: true, termsVersion: 'terms-test-only' }
      : isFriends ? { friends: [], nextCursor: null }
        : isConversations ? { conversations: [], nextCursor: null }
          : { error: 'not_found' };
    await route.fulfill({
      status, contentType: 'application/json', headers: cors,
      body: JSON.stringify(body),
    });
  });
  await page.addInitScript((riderId) => {
    window.sessionStorage.setItem('rider_social_account_session_v1', 'synthetic-production-smoke');
    window.sessionStorage.setItem('rider_social_age_ack_v1', riderId);
    // Deterministic denied/re-prompted permission: no real hardware access.
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: async () => { throw Error('permission denied fixture'); } },
    });
  }, testRiderId);
});

async function verifyScreen(page, testInfo, name) {
  await expect(page.getByTestId('social-app-recovery')).toHaveCount(0);
  await expect(page.getByTestId('create-recovery')).toHaveCount(0);
  await expect(page.locator('#social-screen')).toBeVisible();
  const size = await page.locator('#social-screen').evaluate(node => {
    const rect = node.getBoundingClientRect();
    return { width: rect.width, height: rect.height,
      text: (node.textContent || '').trim().length };
  });
  expect(size.width, name + ' should occupy a usable screen width').toBeGreaterThan(250);
  expect(size.height, name + ' should occupy a usable viewport height').toBeGreaterThan(300);
  expect(size.text, name + ' must never be an empty dark surface').toBeGreaterThan(12);
  await mkdir('test-results/screenshots/production', { recursive: true });
  await page.screenshot({
    path: 'test-results/screenshots/production/' + testInfo.project.name + '-' + name + '.png',
    animations: 'disabled',
  });
}

test('production: every major route and empty state is visible, navigable and error-free', async ({ page }, testInfo) => {
  const uncaught = [];
  page.on('pageerror', e => uncaught.push(e.message));
  await page.goto('/');
  await expect(page.getByText('No posts yet')).toBeVisible();
  await expect(page.getByText('Sample feed')).toHaveCount(0);
  await verifyScreen(page, testInfo, 'home-empty');

  await page.getByRole('button', { name: 'Following' }).click();
  await expect(page.getByText('No posts yet')).toBeVisible();
  await verifyScreen(page, testInfo, 'following-empty');

  await page.getByRole('tab', { name: 'Create' }).click();
  await expect(page.getByTestId('camera-first-studio')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enable camera' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Choose from library' })).toBeVisible();
  await verifyScreen(page, testInfo, 'create-camera');
  await page.getByRole('button', { name: 'Enable camera' }).click();
  await expect(page.getByText(/Camera access was blocked or could not start/)).toBeVisible();
  await verifyScreen(page, testInfo, 'create-permission-refused');
  await page.getByRole('button', { name: 'Story format' }).click();
  await expect(page.getByText('New story')).toBeVisible();
  await page.getByRole('button', { name: 'Reel format' }).click();
  await expect(page.getByRole('button', { name: 'Choose Reel video' })).toBeEnabled();
  await verifyScreen(page, testInfo, 'create-reel');
  await page.getByRole('button', { name: 'Close Create' }).click();
  await expect(page.getByText('No posts yet')).toBeVisible();

  await page.getByRole('tab', { name: 'Reels' }).click();
  await expect(page.getByTestId('reels-empty-state')).toBeVisible();
  await expect(page.getByText('No Reels yet')).toBeVisible();
  await verifyScreen(page, testInfo, 'reels-empty');
  await page.getByRole('button', { name: 'Create Reel' }).click();
  await expect(page.getByRole('button', { name: 'Choose Reel video' })).toBeVisible();
  await page.getByRole('button', { name: 'Close Create' }).click();

  await page.getByRole('tab', { name: 'Clubs' }).click();
  await expect(page.getByText('No clubs yet')).toBeVisible();
  await expect(page.getByText('No upcoming events.')).toBeVisible();
  await verifyScreen(page, testInfo, 'clubs-empty');

  await page.getByRole('tab', { name: 'Shop' }).click();
  await expect(page.getByTestId('shop-discovery')).toBeVisible();
  await expect(page.getByText('Marketplace preview')).toBeVisible();
  await expect(page.getByText('Sample marketplace')).toHaveCount(0);
  await expect(page.getByText('Nothing to show')).toBeVisible();
  await verifyScreen(page, testInfo, 'shop-empty');
  await page.getByRole('button', { name: 'Shop filters' }).click();
  await expect(page.getByTestId('shop-vehicle-filters')).toBeVisible();
  await page.getByRole('button', { name: 'Shop interest Motorcycles' }).click();
  await expect(page.getByText('Nothing to show')).toBeVisible();
  for (const section of ['Saved', 'Basket', 'Orders']) {
    await page.getByRole('button', { name: 'Shop section ' + section }).click();
    await expect(page.getByText(section === 'Orders' ? 'No orders yet' : 'Nothing to show')).toBeVisible();
    await verifyScreen(page, testInfo, 'shop-' + section.toLowerCase());
  }
  await page.getByRole('button', { name: 'Shop section Discover' }).click();

  await page.getByRole('button', { name: 'Open profile' }).click();
  await expect(page.getByTestId('social-profile-summary')).toBeVisible();
  await expect(page.getByText('Your posts will appear here')).toBeVisible();
  await verifyScreen(page, testInfo, 'profile-posts');
  await page.getByRole('tab', { name: 'Reels profile tab' }).click();
  await expect(page.getByText('Your Reels will appear here')).toBeVisible();
  await verifyScreen(page, testInfo, 'profile-reels');
  await page.getByRole('tab', { name: 'Garage profile tab' }).click();
  await expect(page.getByText('Your garage starts here')).toBeVisible();
  await verifyScreen(page, testInfo, 'profile-garage');
  await page.getByRole('button', { name: 'Open settings and privacy' }).click();
  await expect(page.getByTestId('social-settings')).toBeVisible();
  await expect(page.getByText('Settings & privacy', { exact: true })).toBeVisible();
  await verifyScreen(page, testInfo, 'settings');
  await page.getByRole('button', { name: 'Back to profile' }).click();
  await expect(page.getByTestId('social-profile-summary')).toBeVisible();

  await page.getByRole('button', { name: 'Open messages' }).click();
  await expect(page.getByTestId('shared-message-inbox')).toBeVisible();
  await verifyScreen(page, testInfo, 'messages-empty');
  await page.getByRole('button', { name: 'Refresh shared messages' }).click();
  await expect(page.getByTestId('shared-message-inbox')).toBeVisible();
  await verifyScreen(page, testInfo, 'messages-refreshed');

  expect(uncaught, 'No route should throw an uncaught browser exception').toEqual([]);
});

test('production: signed-out sign-in, signup and recovery remain accessible', async ({ page }, testInfo) => {
  const uncaught = [];
  page.on('pageerror', e => uncaught.push(e.message));
  // Override the synthetic session used for the authenticated journey.
  await page.addInitScript(() => {
    window.sessionStorage.removeItem('rider_social_account_session_v1');
    window.sessionStorage.removeItem('rider_social_age_ack_v1');
  });
  await page.goto('/');
  await expect(page.getByTestId('social-account-gate')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await mkdir('test-results/screenshots/production', { recursive: true });
  await page.screenshot({
    path: 'test-results/screenshots/production/' + testInfo.project.name + '-signin.png',
    animations: 'disabled',
  });
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('textbox', { name: 'Email' })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Accept Terms and Guidelines' })).toBeVisible();
  await page.screenshot({
    path: 'test-results/screenshots/production/' + testInfo.project.name + '-signup.png',
    animations: 'disabled',
  });
  await page.getByRole('button', { name: 'Back to sign in' }).click();
  await page.getByRole('button', { name: 'Forgot password' }).click();
  await expect(page.getByRole('textbox', { name: 'Email' })).toBeVisible();
  await page.screenshot({
    path: 'test-results/screenshots/production/' + testInfo.project.name + '-recover.png',
    animations: 'disabled',
  });
  await expect(page.getByTestId('social-app-recovery')).toHaveCount(0);
  expect(uncaught).toEqual([]);
});