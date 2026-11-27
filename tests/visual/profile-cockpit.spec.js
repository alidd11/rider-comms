// Profile is a first-class Rider Comms page, not a subsection of account settings.
// Screenshot and interaction checks on small phones, dark/light and WebKit.
import { expect, test } from '@playwright/test';
import { assertNoViewportOverflow, mockAuthenticatedApi, openOwnProfile } from './helpers.js';

test('Premium Rider Cockpit profile keeps identity, editing and visibility controls coherent', async ({ page }, testInfo) => {
  await mockAuthenticatedApi(page, 'stationary');
  await page.goto('/');
  await openOwnProfile(page);
  const body = page.locator('#sheetBody');
  const hero = body.locator('.my-profile-hero');
  await expect(hero).toBeVisible();
  await expect(hero).toHaveAttribute('aria-label', 'Your rider profile');
  await expect(hero.locator('.my-profile-name')).toHaveText('Alex Rider');
  await expect(hero.locator('.my-profile-handle')).toHaveText('@alex_rides');
  await expect(hero.locator('.my-profile-plan')).toHaveText('Free plan');
  await expect(hero.locator('.my-profile-bio')).toHaveText('Weekend rides along the coast.');
  await expect(hero.locator('.my-profile-edit-action')).toBeVisible();
  await expect(body.locator('.my-profile-section')).toContainText('Connected profiles');
  await expect(body.locator('.my-profile-section')).toContainText('Instagram');
  await expect(body.locator('.my-profile-section')).toContainText('TikTok');
  await expect(body).not.toContainText('Signed-in devices');
  await assertNoViewportOverflow(page);

  const dimensions = await hero.evaluate((element) => ({
    width: element.getBoundingClientRect().width,
    height: element.getBoundingClientRect().height,
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
  expect(dimensions.height).toBeLessThan(360);
  // Full-bleed rows reach the edges; the card and the section heading keep the gutter.
  const edges = await body.evaluate((element) => {
    const page = element.getBoundingClientRect();
    const card = element.querySelector('.my-profile-hero').getBoundingClientRect();
    const heading = element.querySelector('.my-profile-section .settings-page-heading');
    const text = document.createRange();
    text.selectNodeContents(heading);
    return { cardLeft: card.left - page.left, cardRight: page.right - card.right, headingLeft: text.getBoundingClientRect().left - page.left };
  });
  expect(edges.cardLeft).toBeGreaterThanOrEqual(12);
  expect(edges.cardRight).toBeGreaterThanOrEqual(12);
  expect(edges.headingLeft).toBeGreaterThanOrEqual(12);
  await body.screenshot({ path: testInfo.outputPath(`premium-profile-${testInfo.project.name}.png`) });

  await hero.locator('.my-profile-edit-action').click();
  await expect(page.locator('#sheetTitle')).toHaveText('Edit profile');
  await expect(page.locator('#editName')).toHaveValue('Alex Rider');
  await expect(page.locator('#editBio')).toHaveValue('Weekend rides along the coast.');
  await page.locator('#closeSheet').click();
  await expect(page.locator('#sheetTitle')).toHaveText('Profile');
});

test('own profile remains usable at narrow iPhone widths', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone-modern', 'Narrow-viewport regression on a single browser project');
  await mockAuthenticatedApi(page, 'stationary');
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto('/');
  await openOwnProfile(page);
  const edit = page.locator('.my-profile-edit-action');
  await edit.scrollIntoViewIfNeeded();
  await expect(edit).toBeInViewport({ ratio: 1 });
  await expect(page.locator('.my-profile-section')).toBeVisible();
  await assertNoViewportOverflow(page);
  await edit.click();
  await expect(page.locator('#sheetTitle')).toHaveText('Edit profile');
});
