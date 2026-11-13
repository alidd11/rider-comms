/* global window */
import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { URL } from 'node:url';

const origin = 'https://backend-production-7fa0.up.railway.app';
const fakeAccount = {
  riderId: 'rider-auth-e2e', username: 'sample-rider', emailVerified: false,
  termsAccepted: true, termsVersion: 'terms-fixture',
};
const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,content-type',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
};
async function fakeBackend(page, options = {}) {
  const { identity = fakeAccount, accountResult = 'ok' } = options;
  await page.route(origin + '/**', async route => {
    const method = route.request().method();
    const pathname = new URL(route.request().url()).pathname;
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    let status = 404;
    let body = { error: 'not_found' };
    if (pathname === '/auth/login' || pathname === '/auth/signup') {
      if (accountResult === 'invalid') {
        status = 401; body = { error: 'invalid_credentials' };
      } else {
        status = pathname === '/auth/signup' ? 201 : 200;
        body = { riderId: identity.riderId, token: randomUUID(),
          emailVerified: identity.emailVerified, termsAccepted: identity.termsAccepted };
      }
    } else if (pathname === '/auth/me') {
      status = accountResult === 'expired' ? 401 : 200;
      body = status === 401 ? { error: 'unauthorized' } : identity;
    } else if (pathname === '/auth/logout') {
      return route.fulfill({ status: 204, headers: cors });
    } else if (pathname === '/auth/accept-terms') {
      status = 200; body = { accepted: true };
    } else if (pathname === '/riders/' + identity.riderId + '/friends') {
      status = 200; body = { friends: [], nextCursor: null };
    } else if (pathname === '/conversations') {
      status = 200; body = { conversations: [], nextCursor: null };
    }
    return route.fulfill({ status, contentType: 'application/json',
      headers: cors, body: JSON.stringify(body) });
  });
}
test('Social begins with Rider Comms sign-in and rejects invalid credentials', async ({ page }) => {
  await fakeBackend(page, { accountResult: 'invalid' });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Username' }).fill('sample-rider');
  await page.getByRole('textbox', { name: 'Password' }).fill(randomUUID());
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText('Username or password is incorrect.')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Home' })).toHaveCount(0);
});
test('shared-account login requires separate Social age acknowledgment and signs out', async ({ page }) => {
  await fakeBackend(page);
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Username' }).fill('sample-rider');
  await page.getByRole('textbox', { name: 'Password' }).fill(randomUUID());
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Enter Social preview' })).toBeDisabled();
  await page.getByRole('checkbox', { name: 'I confirm I am at least 16' }).click();
  await page.getByRole('button', { name: 'Enter Social preview' }).click();
  await expect(page.getByRole('tab', { name: 'Home' })).toBeVisible();
  await page.getByRole('button', { name: 'Open profile' }).click();
  await expect(page.getByText('@sample-rider · Rider Comms account')).toBeVisible();
  await page.getByRole('button', { name: 'Sign out of Social' }).click();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  const stored = await page.evaluate(() => window.sessionStorage.getItem('rider_social_account_session_v1'));
  expect(stored).toBeNull();
});
test('a guest identity with null username is not accepted into Social', async ({ page }) => {
  await fakeBackend(page, { identity: { ...fakeAccount, username: null } });
  await page.addInitScript(() => window.sessionStorage.setItem('rider_social_account_session_v1', 'not-a-real-session'));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Home' })).toHaveCount(0);
  expect(await page.evaluate(() => window.sessionStorage.getItem('rider_social_account_session_v1'))).toBeNull();
});
test('server 401 during session restore clears local credential and shows sign-in', async ({ page }) => {
  await fakeBackend(page, { accountResult: 'expired' });
  await page.addInitScript(() => window.sessionStorage.setItem('rider_social_account_session_v1', 'not-a-real-session'));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.sessionStorage.getItem('rider_social_account_session_v1'))).toBeNull();
});
test('signup never submits without accepting Terms and Guidelines', async ({ page }) => {
  await fakeBackend(page);
  let signupRequests = 0;
  page.on('request', request => { if (new URL(request.url()).pathname === '/auth/signup') signupRequests += 1; });
  await page.goto('/');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('textbox', { name: 'Username' }).fill('sample-rider');
  await page.getByRole('textbox', { name: 'Email' }).fill('example@invalid.test');
  await page.getByRole('textbox', { name: 'Password' }).fill(randomUUID());
  await page.getByRole('button', { name: 'Create Rider Comms account' }).click();
  await expect(page.getByText('Please accept the Terms and Community Guidelines.')).toBeVisible();
  expect(signupRequests).toBe(0);
  await page.getByRole('checkbox', { name: 'Accept Terms and Guidelines' }).click();
  await page.getByRole('button', { name: 'Create Rider Comms account' }).click();
  await expect(page.getByRole('button', { name: 'Enter Social preview' })).toBeVisible();
  expect(signupRequests).toBe(1);
});
