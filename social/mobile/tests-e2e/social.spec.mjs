import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

test('feed switches, hides posts and explains recommendations', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.getByText('Your world, in motion.')).toBeVisible();
  await expect(page.getByText('Members-only event details')).toHaveCount(0);
  await expect(page.getByText('Sunday roads, no rush.')).toBeVisible();

  await page.getByRole('button', { name: 'Why seeing post by Alex Morgan' }).click();
  await expect(page.getByText(/Demo recommendation/)).toBeVisible();
  await page.getByRole('button', { name: 'Dismiss notice' }).click();

  await page.getByRole('button', { name: 'Not interested in post by Alex Morgan' }).click();
  await expect(page.getByText('Sunday roads, no rush.')).toHaveCount(0);

  await page.getByRole('button', { name: 'Following' }).click();
  await expect(page.getByText('Sort:')).toBeVisible();
  await page.getByRole('button', { name: 'Newest' }).click();
  await expect(page.getByText('The early start was worth it.')).toBeVisible();

  await mkdir('test-results/screenshots', { recursive: true });
  await page.screenshot({ path: 'test-results/screenshots/' + testInfo.project.name + '-feed.png' });
});

test('clubs, marketplace and profile have independent usable screens', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Clubs' }).click();
  await expect(page.getByText('Clubs & events')).toBeVisible();
  await page.getByRole('button', { name: 'Open South Coast Riders' }).click();
  await expect(page.getByText('Weekend rides, scenic routes and friendly meetups.')).toBeVisible();
  await page.getByRole('button', { name: 'Join demo club' }).click();
  await expect(page.getByRole('button', { name: 'Leave demo club' })).toBeVisible();

  await page.getByRole('tab', { name: 'Shop' }).click();
  await expect(page.getByText('Marketplace')).toBeVisible();
  await expect(page.getByText('Private sellers are not permitted.', { exact: false })).toBeVisible();
  await page.getByRole('textbox', { name: 'Search marketplace' }).fill('bicycle helmet');
  await expect(page.getByText('Road bicycle helmet')).toBeVisible();
  await expect(page.getByText('Touring gloves')).toHaveCount(0);

  await page.getByRole('button', { name: 'Open profile' }).click();
  await expect(page.getByText('Personal garage')).toBeVisible();
  await mkdir('test-results/screenshots', { recursive: true });
  await page.screenshot({ path: 'test-results/screenshots/' + testInfo.project.name + '-profile.png' });
});
