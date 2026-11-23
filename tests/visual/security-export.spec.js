// Password-confirmed data portability must not leak through an unauthenticated
// export, bypass the step-up dialog or cache the payload in app storage.
import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { mockAuthenticatedApi, RIDER_ID } from './helpers.js';

test('PWA account-data download requires password and preserves private JSON', async ({ page }) => {
  let exportReads = 0;
  let passwordConfirmed = false;
  const privateMessage = 'private <script>text</script> & account data';
  await mockAuthenticatedApi(page, 'stationary', async ({ request, url }) => {
    if (url.pathname === '/auth/reauthenticate' && request.method() === 'POST') {
      const body = JSON.parse(request.postData() || '{}');
      if (body.password !== 'valid-export-password') {
        return { status: 401, body: { error: 'invalid_credentials' } };
      }
      passwordConfirmed = true;
      return { body: { reauthenticated: true, validForMs: 900000 } };
    }
    if (url.pathname === '/auth/export' && request.method() === 'GET') {
      exportReads += 1;
      if (!passwordConfirmed) return { status: 403, body: { error: 'reauth_required' } };
      return { body: { account: { rider_id: RIDER_ID }, messages: [{ text: privateMessage }] } };
    }
    if (url.pathname === '/auth/me' && request.method() === 'DELETE') {
      return { status: 403, body: { error: 'reauth_required' } };
    }
    return null;
  });
  await page.goto('/#settings');
  await page.locator('[data-settings-open="account"]').click();
  await page.locator('#exportAccountBtn').click();
  const dialog = page.locator('#accountStepupDialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('downloading a copy');
  expect(exportReads).toBe(0);

  await dialog.locator('#accountStepupPassword').fill('wrong-password');
  await dialog.locator('[data-stepup-submit]').click();
  await expect(dialog.locator('#accountStepupError')).toHaveText('Incorrect password. Try again.');
  expect(exportReads).toBe(0);

  await dialog.locator('#accountStepupPassword').fill('valid-export-password');
  const downloadPromise = page.waitForEvent('download');
  await dialog.locator('[data-stepup-submit]').click();
  const download = await downloadPromise;
  await expect(dialog).toHaveCount(0);
  expect(download.suggestedFilename()).toMatch(/^rider-comms-data-\d{4}-\d{2}-\d{2}\.json$/);
  const exported = JSON.parse(await readFile(await download.path(), 'utf8'));
  expect(exported.account.rider_id).toBe(RIDER_ID);
  expect(exported.messages[0].text).toBe(privateMessage);
  expect(exportReads).toBe(1);
  const leaked = await page.evaluate((privateText) =>
    Object.keys(localStorage).some((key) => (localStorage.getItem(key) || '').includes(privateText)), privateMessage);
  expect(leaked).toBe(false);
});
