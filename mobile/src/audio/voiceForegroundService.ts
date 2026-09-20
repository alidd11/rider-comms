import { NativeModules, PermissionsAndroid, Platform } from 'react-native';

interface AndroidForegroundServiceNativeModule {
  startService(config: {
    id: number;
    title: string;
    message: string;
    ServiceType: 'microphone';
    vibration: boolean;
    visibility: 'private' | 'public' | 'secret';
    icon: string;
    largeIcon: string;
    importance: 'none' | 'min' | 'low' | 'default' | 'high' | 'max';
    number: string;
    setOnlyAlertOnce: boolean;
  }): Promise<void>;
  stopServiceAll(): Promise<void>;
  isRunning(): Promise<number>;
}

const VOICE_SERVICE_NOTIFICATION_ID = 24017;

function nativeForegroundService(): AndroidForegroundServiceNativeModule {
  const service = NativeModules.ForegroundService as AndroidForegroundServiceNativeModule | undefined;
  if (!service?.startService || !service?.stopServiceAll) {
    throw new Error('Android background voice service is unavailable in this build.');
  }
  return service;
}

async function ensureAndroidMicrophonePermission(): Promise<void> {
  if (Platform.OS !== 'android') return;
  const permission = PermissionsAndroid.PERMISSIONS.RECORD_AUDIO;
  const alreadyGranted = await PermissionsAndroid.check(permission);
  if (alreadyGranted) return;

  const result = await PermissionsAndroid.request(permission);
  if (result !== PermissionsAndroid.RESULTS.GRANTED) {
    throw new Error('Microphone permission is required for voice chat.');
  }
}

/**
 * Android requires a microphone-typed foreground service for a LiveKit call
 * to remain eligible to capture audio while the app is backgrounded. Start it
 * while Rider Comms is still foregrounded and before the LiveKit audio session
 * becomes ready; Android 14+ forbids creating this microphone service after
 * the app has already moved to the background.
 */
export async function startAndroidVoiceForegroundService(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await ensureAndroidMicrophonePermission();
  const service = nativeForegroundService();
  await service.startService({
    id: VOICE_SERVICE_NOTIFICATION_ID,
    title: 'Rider Comms voice',
    message: 'Voice chat is active',
    ServiceType: 'microphone',
    vibration: false,
    visibility: 'private',
    icon: 'ic_launcher',
    largeIcon: 'ic_launcher',
    importance: 'low',
    number: '0',
    setOnlyAlertOnce: true,
  });

  // The bridge resolves when Android accepts the start command. The Service
  // itself calls startForeground() asynchronously from onStartCommand(), so
  // confirm that step really completed before LiveKit is allowed to publish.
  // This catches manifest/permission/notification failures that would
  // otherwise look like a healthy audio session until the app backgrounds.
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if ((await service.isRunning()) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  await service.stopServiceAll().catch(() => {});
  throw new Error('Android background voice service could not start.');
}

export async function stopAndroidVoiceForegroundService(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await nativeForegroundService().stopServiceAll();
}
