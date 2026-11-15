/* global process */
/**
 * UI screenshots and automated domain tests may use fictional content, but the
 * regular production/social preview bundle must never represent invented users,
 * engagement, clubs, prices, merchants, or posts as real.
 *
 * Expo inlines this exact public build variable at export time; neither user
 * settings nor URL parameters can enable it at runtime.
 */
export function shouldEnableSocialFixtures(flag: string | undefined): boolean {
  return flag === 'true';
}
export const socialFixturesEnabled =
  shouldEnableSocialFixtures(process.env.EXPO_PUBLIC_SOCIAL_TEST_FIXTURES);
