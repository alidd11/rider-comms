import type { ImageSourcePropType } from 'react-native';

/**
 * Bundled brand imagery, so the sign-in and ride screens look right offline
 * and on first launch (no third-party image host sees riders' requests).
 */
export const AUTH_HERO_IMAGE: ImageSourcePropType = require('../assets/hero/auth.jpg');
export const RIDE_HERO_IMAGE: ImageSourcePropType = require('../assets/hero/ride.jpg');
/** The app icon's mark, for the splash. */
export const BRAND_MARK_IMAGE: ImageSourcePropType = require('../assets/brand/splash-icon.png');
