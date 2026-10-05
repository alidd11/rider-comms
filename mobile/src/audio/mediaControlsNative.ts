import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import { MediaControls, type MediaControlsNative } from './mediaControls';

// Optional so Expo Go and older builds without the module still run; the UI
// then hides the controls.
const native = requireOptionalNativeModule<MediaControlsNative>('RiderMediaControls');

export const mediaControls = new MediaControls(native, Platform.OS === 'android');
