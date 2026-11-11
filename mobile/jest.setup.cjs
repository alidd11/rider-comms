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
  AndroidImportance: { HIGH: 4 },
}));
