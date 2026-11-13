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

test('sign-in stays top anchored while iPhone keyboard viewport changes', async ({ page }) => {
  await fakeBackend(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const form = page.locator('#social-auth-form');
  const loginScroll = page.locator('#social-auth-scroll');
  await expect(form).toBeVisible();
  const start = await form.boundingBox();
  const username = page.getByRole('textbox', { name: 'Username' });
  await username.focus();
  const inputSize = await username.evaluate(input => parseFloat(window.getComputedStyle(input).fontSize));
  expect(inputSize).toBeGreaterThanOrEqual(16);
  await page.setViewportSize({ width: 390, height: 545 });
  const focused = await form.boundingBox();
  expect(Math.abs((focused?.y ?? -100) - (start?.y ?? -200))).toBeLessThan(10);
  expect(await loginScroll.evaluate(scroll => scroll.scrollTop)).toBe(0);
  await page.setViewportSize({ width: 390, height: 844 });
  const restored = await form.boundingBox();
  expect(Math.abs((restored?.y ?? -100) - (start?.y ?? -200))).toBeLessThan(10);
});

test('sign-in textboxes have no filled blue rectangle and keep a visible focus underline', async ({ page }) => {
  await fakeBackend(page);
  await page.goto('/');
  const field = page.getByTestId('auth-field-username');
  const input = field.locator('input');
  const look = await input.evaluate(node => {
    const own = window.getComputedStyle(node);
    const wrapper = window.getComputedStyle(node.parentElement);
    return {
      fill: own.backgroundColor,
      wrapperFill: wrapper.backgroundColor,
      topWidth: parseFloat(wrapper.borderTopWidth),
      bottomWidth: parseFloat(wrapper.borderBottomWidth),
    };
  });
  expect(['transparent', 'rgba(0, 0, 0, 0)']).toContain(look.fill);
  expect(['transparent', 'rgba(0, 0, 0, 0)']).toContain(look.wrapperFill);
  expect(look.topWidth).toBe(0);
  expect(look.bottomWidth).toBeGreaterThan(0);
  await input.focus();
  const focused = await input.evaluate(node => window.getComputedStyle(node).boxShadow);
  expect(focused).not.toBe('none');
});

test('login errors sit beside the affected input instead of shifting the page header', async ({ page }) => {
  await fakeBackend(page, { accountResult: 'invalid' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByTestId('auth-field-error-username')).toHaveText('Enter your Rider Comms username.');
  const username = page.getByRole('textbox', { name: 'Username' });
  await username.fill('sample-rider');
  await expect(page.getByTestId('auth-field-error-username')).toHaveCount(0);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByTestId('auth-field-error-password')).toHaveText('Enter your password.');
  await page.getByRole('textbox', { name: 'Password' }).fill(randomUUID());
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const message = page.getByTestId('auth-field-error-password');
  await expect(message).toHaveText('Username or password is incorrect.');
  const password = await page.getByTestId('auth-field-password').boundingBox();
  const feedback = await message.boundingBox();
  expect(feedback?.y ?? -1).toBeGreaterThan(password?.y ?? 10000);
  expect((feedback?.y ?? 10000) - ((password?.y ?? 0) + (password?.height ?? 0))).toBeLessThan(26);
  await page.getByRole('button', { name: 'Show password' }).click();
  await expect(page.getByRole('button', { name: 'Hide password' })).toBeVisible();
  await page.getByRole('button', { name: 'Hide password' }).click();
  await expect(page.getByRole('button', { name: 'Show password' })).toBeVisible();
});

test('unavailable account service presents compact non-password error and stays on sign-in', async ({ page }) => {
  await page.route(origin + '/**', async route => route.abort('failed'));
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Username' }).fill('sample-rider');
  await page.getByRole('textbox', { name: 'Password' }).fill(randomUUID());
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const error = page.getByTestId('auth-error');
  await expect(error).toContainText('Connection unavailable');
  await expect(error).toContainText('Rider Comms is unreachable');
  await expect(error).toContainText('web access enabled');
  await expect(page.getByTestId('auth-field-error-password')).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Home' })).toHaveCount(0);
  const look = await error.evaluate(node => {
    const css = window.getComputedStyle(node);
    return { fill: css.backgroundColor, borderLeft: parseFloat(css.borderLeftWidth) };
  });
  expect(['transparent', 'rgba(0, 0, 0, 0)']).toContain(look.fill);
  expect(look.borderLeft).toBeGreaterThan(0);
  const injectedCss = await page.locator('#social-edge-to-edge').textContent();
  expect(injectedCss).toContain('input:-webkit-autofill');
  expect(injectedCss).toContain('-webkit-text-fill-color');
});

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
