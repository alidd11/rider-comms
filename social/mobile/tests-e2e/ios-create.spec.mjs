/* global navigator, window */
import { test, expect } from '@playwright/test';
import { URL } from 'node:url';

test.beforeEach(async ({ page }) => {
  await page.route('https://backend-production-7fa0.up.railway.app/**', async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const headers = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'authorization,content-type',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
    };
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers });
      return;
    }
    const me = path === '/auth/me';
    const connections = path === '/conversations' || path.endsWith('/friends');
    const body = me
      ? { riderId: 'rider_abcd1234', username: 'webkit-fixture',
          emailVerified: true, termsAccepted: true, termsVersion: 'terms-fixture' }
      : connections ? { conversations: [], friends: [], nextCursor: null }
        : { error: 'not_found' };
    await route.fulfill({
      status: me || connections ? 200 : 404,
      contentType: 'application/json', headers, body: JSON.stringify(body),
    });
  });
  await page.addInitScript(() => {
    // Test a denied/re-prompted iOS Home Screen permission without a real camera.
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: async () => { throw new Error('permission denied fixture'); } },
    });
    window.sessionStorage.setItem('rider_social_account_session_v1', 'synthetic-webkit-test');
    window.sessionStorage.setItem('rider_social_age_ack_v1', 'rider_abcd1234');
  });
});

test('iPhone WebKit Create never becomes an empty viewport after camera refusal', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Create' })).toBeVisible();
  await page.getByRole('tab', { name: 'Create' }).click();
  await expect(page.getByTestId('camera-first-studio')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close Create' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enable camera' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Choose from library' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open Gallery' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Enable camera' }).click();
  await expect(page.getByText(/Camera access was blocked or could not start/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Choose from library' })).toBeVisible();
  await page.getByRole('button', { name: 'Reel format' }).click();
  await expect(page.getByRole('button', { name: 'Choose Reel video' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Choose Reel video' })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Flip camera' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Take photo' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Choose from library' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Enable camera' })).toHaveCount(0);
  await expect(page.getByText('Create a Reel')).toBeVisible();
  await expect(page.getByText('Select a video from Gallery to review your Reel before posting.')).toBeVisible();
  await page.getByRole('button', { name: 'Close Create' }).click();
  await expect(page.getByRole('tab', { name: 'Home' })).toBeVisible();
  expect(errors).toEqual([]);
});
