import { expect, test } from '@playwright/test';
import { mockAuthenticatedApi } from './helpers.js';

test('deletion reauthentication failure preserves the PWA session', async ({ page }) => {
  const attempts = [];
  let deletions = 0;
  await mockAuthenticatedApi(page, 'stationary', ({ request, url }) => {
    if (url.pathname === '/auth/reauthenticate' && request.method() === 'POST') {
      const { password } = JSON.parse(request.postData() || '{}');
      attempts.push(password === 'right-pass' ? 'valid' : 'invalid');
      return password === 'right-pass' ? { body: { reauthenticated: true, validForMs: 900000 } }
        : { status: 401, body: { error: 'invalid_credentials' } };
    }
    if (url.pathname === '/auth/me' && request.method() === 'DELETE') {
      deletions += 1;
      return { status: 403, body: { error: 'fixture_rejected' } };
    }
    return null;
  });
  page.on('dialog', (dialog) => void dialog.accept());
  await page.goto('/#settings');
  await page.locator('[data-settings-open="account"]').click();
  await page.locator('#deleteAccountBtn').click();
  const prompt = page.locator('#accountStepupDialog');
  await expect(prompt).toBeVisible();
  await expect(prompt.locator('input')).toHaveAttribute('type', 'password');
  expect(deletions).toBe(0);
  await prompt.locator('input').fill('wrong-pass');
  await prompt.locator('[data-stepup-submit]').click();
  await expect(prompt.locator('#accountStepupError')).toHaveText('Incorrect password. Try again.');
  await expect(prompt.locator('input')).toHaveValue('');
  await expect(prompt).toBeVisible();
  expect(deletions).toBe(0);
  await prompt.locator('input').fill('right-pass');
  await prompt.locator('[data-stepup-submit]').click();
  await expect(prompt).toHaveCount(0);
  await expect.poll(() => deletions).toBe(1);
  expect(attempts).toEqual(['invalid', 'valid']);
});
