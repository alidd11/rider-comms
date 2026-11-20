jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// The store SDK is native; screens get a store adapter injected or mocked.
jest.mock('expo-iap', () => ({
  initConnection: jest.fn(async () => false),
  endConnection: jest.fn(async () => undefined),
  fetchProducts: jest.fn(async () => []),
  getAvailablePurchases: jest.fn(async () => []),
  requestPurchase: jest.fn(async () => null),
  finishTransaction: jest.fn(async () => undefined),
  deepLinkToSubscriptions: jest.fn(async () => undefined),
  isUserCancelledError: jest.fn(() => false),
  purchaseUpdatedListener: jest.fn(() => ({ remove: jest.fn() })),
  purchaseErrorListener: jest.fn(() => ({ remove: jest.fn() })),
}));

// Speech recognition is native. Off by default, so screens show no mic; a
// test turns it on and plays recognition events through __emit.
jest.mock('expo-speech-recognition', () => {
  const React = require('react');
  const listeners = new Map();
  const ExpoSpeechRecognitionModule = {
    isRecognitionAvailable: jest.fn(() => false),
    requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
    start: jest.fn(),
    abort: jest.fn(),
    __emit: (name, event) => [...(listeners.get(name) || [])].forEach((listener) => listener(event)),
  };
  function useSpeechRecognitionEvent(name, handler) {
    const ref = React.useRef(handler);
    ref.current = handler;
    React.useEffect(() => {
      const listener = (event) => ref.current(event);
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(listener);
      return () => listeners.get(name).delete(listener);
    }, [name]);
  }
  return { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent };
});

// Haptics are native; tests only need the calls to resolve.
jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(async () => undefined),
  impactAsync: jest.fn(async () => undefined),
  notificationAsync: jest.fn(async () => undefined),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

// Push notifications are native; tests get a phone that hasn't been asked.
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(async () => ({ status: 'undetermined' })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'denied' })),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: 'ExponentPushToken[test-token-000]' })),
  setNotificationChannelAsync: jest.fn(async () => null),
  getLastNotificationResponseAsync: jest.fn(async () => null),
  clearLastNotificationResponseAsync: jest.fn(async () => undefined),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  setNotificationCategoryAsync: jest.fn(async () => null),
  dismissNotificationAsync: jest.fn(async () => undefined),
  DEFAULT_ACTION_IDENTIFIER: 'expo.modules.notifications.actions.DEFAULT',
  AndroidImportance: { HIGH: 4 },
}));
