/* global document, window, getComputedStyle */
import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

test('feed switches, hides posts and explains recommendations', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Feed preferences' })).toBeVisible();
  await expect(page.getByText('Members-only event details')).toHaveCount(0);
  await expect(page.getByText('Sunday roads, no rush.')).toBeVisible();

  await page.getByRole('button', { name: 'Post options for Alex Morgan' }).click();
  await page.getByRole('button', { name: 'Why seeing post by Alex Morgan' }).click();
  await expect(page.getByText(/Sample recommendation/)).toBeVisible();
  await page.getByRole('button', { name: 'Dismiss notice' }).click();

  await page.getByRole('button', { name: 'Post options for Alex Morgan' }).click();
  await page.getByRole('button', { name: 'Not interested in post by Alex Morgan' }).click();
  await expect(page.getByText('Sunday roads, no rush.')).toHaveCount(0);

  await page.getByRole('button', { name: 'Following' }).click();
  await expect(page.getByRole('button', { name: 'Newest' })).toBeVisible();
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
  await expect(page.getByText('Verified only')).toBeVisible();
  await page.getByRole('textbox', { name: 'Search marketplace' }).fill('bicycle helmet');
  await expect(page.getByText('Road bicycle helmet')).toBeVisible();
  await expect(page.getByText('Touring gloves')).toHaveCount(0);

  await page.getByRole('button', { name: 'Open profile' }).click();
  await expect(page.getByText('Personal garage')).toBeVisible();
  await mkdir('test-results/screenshots', { recursive: true });
  await page.screenshot({ path: 'test-results/screenshots/' + testInfo.project.name + '-profile.png' });
});


test('social profile and private garage edits survive reload without publishing', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open profile' }).click();
  await expect(page.getByText('Your garage starts here')).toBeVisible();
  await page.getByRole('button', { name: 'Edit social profile' }).click();
  await page.getByRole('textbox', { name: 'Social display name' }).fill('Weekend Rider');
  await page.getByRole('textbox', { name: 'Social bio' }).fill('Cars, motorcycles and Sunday rides.');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByText('Weekend Rider')).toBeVisible();

  await page.getByRole('button', { name: 'Add vehicle to garage' }).click();
  await page.getByRole('textbox', { name: 'Vehicle make' }).fill('Honda');
  await page.getByRole('textbox', { name: 'Vehicle model' }).fill('PCX');
  await page.getByRole('textbox', { name: 'Vehicle year' }).fill('2024');
  await page.getByRole('button', { name: 'Save vehicle' }).click();
  await expect(page.getByText('Honda PCX')).toBeVisible();
  await expect(page.getByText('PRIVATE', { exact: true })).toBeVisible();

  await page.reload();
  await page.getByRole('button', { name: 'Open profile' }).click();
  await expect(page.getByText('Weekend Rider')).toBeVisible();
  await expect(page.getByText('Honda PCX')).toBeVisible();
  await page.getByRole('button', { name: 'Toggle privacy for Honda PCX' }).click();
  await expect(page.getByText('PUBLIC', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Remove Honda PCX' }).click();
  await page.getByRole('button', { name: 'Confirm remove' }).click();
  await expect(page.getByText('Your garage starts here')).toBeVisible();

  await mkdir('test-results/screenshots', { recursive: true });
  await page.screenshot({ path: 'test-results/screenshots/' + testInfo.project.name + '-garage.png' });
});

test('event detail includes only demo interest, not real RSVP', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Clubs' }).click();
  await page.getByRole('button', { name: 'View event Coffee & Cars' }).click();
  await expect(page.getByText('Preview event · private details stay protected')).toBeVisible();
  await page.getByRole('button', { name: 'Mark interested in demo event' }).click();
  await expect(page.getByRole('button', { name: 'Remove demo RSVP interest' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to clubs and events' }).click();
  await expect(page.getByText('Upcoming events')).toBeVisible();
});


test('iPhone and desktop render true edge-to-edge background with safe content insets', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Feed preferences' })).toBeVisible();
  const geometry = await page.evaluate(() => {
    const viewport = document.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? '';
    const status = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.getAttribute('content') ?? '';
    const root = document.getElementById('root');
    const screen = document.getElementById('social-screen');
    const tabs = document.getElementById('social-bottom-tabs');
    const rootRect = root?.getBoundingClientRect();
    const screenRect = screen?.getBoundingClientRect();
    const tabsRect = tabs?.getBoundingClientRect();
    return {
      viewport, status,
      htmlBackground: getComputedStyle(document.documentElement).backgroundColor,
      bodyBackground: getComputedStyle(document.body).backgroundColor,
      screenBackground: screen ? getComputedStyle(screen).backgroundColor : '',
      tabsBackground: tabs ? getComputedStyle(tabs).backgroundColor : '',
      rootBottom: rootRect?.bottom ?? -1,
      screenBottom: screenRect?.bottom ?? -1,
      tabsBottom: tabsRect?.bottom ?? -1,
      viewportHeight: window.innerHeight,
      screenWidth: screenRect?.width ?? -1,
      viewportWidth: window.innerWidth,
      screenPaddingTop: screen ? getComputedStyle(screen).paddingTop : '',
      tabsPaddingBottom: tabs ? parseFloat(getComputedStyle(tabs).paddingBottom) : 0,
      hasSafeAreaCss: !!document.getElementById('social-edge-to-edge')?.textContent?.includes('env(safe-area-inset-bottom'),
    };
  });
  expect(geometry.viewport).toContain('viewport-fit=cover');
  expect(geometry.status).toBe('black-translucent');
  expect(geometry.htmlBackground).toBe('rgb(8, 13, 19)');
  expect(geometry.bodyBackground).toBe('rgb(8, 13, 19)');
  expect(geometry.screenBackground).toBe('rgb(8, 13, 19)');
  expect(geometry.tabsBackground).toBe('rgb(8, 13, 19)');
  expect(geometry.hasSafeAreaCss).toBe(true);
  expect(geometry.rootBottom).toBeGreaterThanOrEqual(geometry.viewportHeight - 2);
  expect(geometry.screenBottom).toBeGreaterThanOrEqual(geometry.viewportHeight - 2);
  expect(geometry.tabsBottom).toBeGreaterThanOrEqual(geometry.viewportHeight - 2);
  expect(geometry.screenWidth).toBeGreaterThanOrEqual(geometry.viewportWidth - 2);
  expect(geometry.tabsPaddingBottom).toBeGreaterThanOrEqual(12);
});


test('media-first home removes intro and keeps content close to top', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.getByText('Your world, in motion.')).toHaveCount(0);
  await expect(page.getByText('Visual placeholder · media integration pending')).toHaveCount(0);
  const media = page.getByTestId('post-media-p1');
  await expect(media).toBeVisible();
  const rect = await media.boundingBox();
  expect(rect).not.toBeNull();
  expect(rect?.y).toBeLessThan(460);
  await page.getByRole('button', { name: 'Feed preferences' }).click();
  await expect(page.getByText('Feed preferences')).toBeVisible();
  await page.getByRole('button', { name: 'Feed preferences' }).click();
  await expect(page.getByText('Feed preferences')).toHaveCount(0);
  await mkdir('test-results/screenshots', { recursive: true });
  await page.screenshot({ path: 'test-results/screenshots/' + testInfo.project.name + '-feed-first.png' });
});

test('create flow shows only a private draft preview and no publishing control', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Create' }).click();
  await expect(page.getByText('Built for safer sharing')).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Post draft' }).fill('Saturday meet preview');
  await page.getByRole('button', { name: 'Preview post' }).click();
  await expect(page.getByText('Saturday meet preview').last()).toBeVisible();
  await expect(page.getByText('PRIVATE POST')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Publish' })).toHaveCount(0);
});
