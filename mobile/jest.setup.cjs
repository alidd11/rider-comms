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
