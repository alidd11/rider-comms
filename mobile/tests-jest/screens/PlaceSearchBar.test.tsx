import * as React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ApiError } from '../../src/api/client';
import type { PlaceSummary } from '../../src/api/client';
import { PLACE_SEARCH_DEBOUNCE_MS } from '../../src/api/places';
import type { PlaceResult } from '../../src/api/places';
import { recentPlacesStorageKey } from '../../src/search/recentPlaces';
import { PlaceSearchBar } from '../../src/screens/PlaceSearchBar';

const RIDER_ID = 'rider-1';
const NEAR = { lat: 51.5, lon: -0.1 };
const SAFE_AREA_METRICS = {
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
  frame: { x: 0, y: 0, width: 320, height: 640 },
};

const mockClient = {
  searchPlaces: jest.fn<Promise<{ places: PlaceSummary[] }>, [string, { lat: number; lon: number }]>(),
  searchNearbyPlaces: jest.fn<Promise<{ places: PlaceSummary[] }>, [readonly string[], { lat: number; lon: number }]>(),
};

jest.mock('../../src/auth/AuthContext', () => ({
  useAuth: () => ({ riderId: 'rider-1', client: mockClient }),
}));

jest.mock('../../src/settings/SettingsContext', () => ({
  useSettings: () => ({ unitSystem: 'km' }),
}));

function place(id: string, name: string, lat = 51.501, lon = -0.1): PlaceSummary {
  return { id, name, address: `${name} address`, lat, lon };
}

interface Props {
  near: { lat: number; lon: number } | null;
  onSelect: jest.Mock<void, [PlaceResult]>;
  onRequestLocation: jest.Mock<Promise<void>, []>;
}

async function renderSearchBar(overrides: Partial<Props> = {}) {
  const props: Props = {
    near: NEAR,
    onSelect: jest.fn(),
    onRequestLocation: jest.fn(async () => undefined),
    ...overrides,
  };
  await render(
    <SafeAreaProvider initialMetrics={SAFE_AREA_METRICS}>
      <PlaceSearchBar {...props} />
    </SafeAreaProvider>,
  );
  await act(async () => {});
  return props;
}

async function openSearch() {
  await fireEvent.press(screen.getByLabelText('Search for a place'));
}

async function typeQuery(value: string) {
  await fireEvent.changeText(screen.getByPlaceholderText('Search for a place'), value);
  await act(async () => { jest.advanceTimersByTime(PLACE_SEARCH_DEBOUNCE_MS); });
}

beforeEach(async () => {
  jest.useFakeTimers();
  mockClient.searchPlaces.mockReset();
  mockClient.searchNearbyPlaces.mockReset();
  await AsyncStorage.clear();
});

afterEach(() => {
  jest.useRealTimers();
});

// PlaceSearchBar keeps a module-level session cache of successful searches,
// so each test below uses its own query/category to avoid cross-test hits.

test('searches through the backend client after the debounce and shows results', async () => {
  mockClient.searchPlaces.mockResolvedValue({ places: [place('p1', 'Bike Cafe')] });
  await renderSearchBar();
  await openSearch();

  await fireEvent.changeText(screen.getByPlaceholderText('Search for a place'), 'bike ca');
  await fireEvent.changeText(screen.getByPlaceholderText('Search for a place'), 'bike cafe');
  await act(async () => { jest.advanceTimersByTime(PLACE_SEARCH_DEBOUNCE_MS - 1); });
  expect(mockClient.searchPlaces).not.toHaveBeenCalled();
  await act(async () => { jest.advanceTimersByTime(1); });

  expect(mockClient.searchPlaces).toHaveBeenCalledTimes(1);
  expect(mockClient.searchPlaces).toHaveBeenCalledWith('bike cafe', NEAR);
  expect(await screen.findByText('Bike Cafe')).toBeTruthy();
  expect(screen.getByText('1 closest')).toBeTruthy();
});

test('selecting a result hands it to the map and remembers it', async () => {
  mockClient.searchPlaces.mockResolvedValue({ places: [place('p2', 'Fuel Stop')] });
  const props = await renderSearchBar();
  await openSearch();
  await typeQuery('fuel stop');

  await fireEvent.press(await screen.findByLabelText('Fuel Stop, Fuel Stop address'));

  expect(props.onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'p2', name: 'Fuel Stop' }));
  const stored = JSON.parse((await AsyncStorage.getItem(recentPlacesStorageKey(RIDER_ID)))!) as PlaceResult[];
  expect(stored.map((item) => item.id)).toEqual(['p2']);
});

test('category chips run a nearby type search', async () => {
  mockClient.searchNearbyPlaces.mockResolvedValue({ places: [place('c1', 'Corner Coffee')] });
  await renderSearchBar();
  await openSearch();

  await fireEvent.press(screen.getByText('Coffee'));
  await act(async () => { jest.advanceTimersByTime(PLACE_SEARCH_DEBOUNCE_MS); });

  expect(mockClient.searchNearbyPlaces).toHaveBeenCalledWith(['cafe', 'coffee_shop'], NEAR);
  expect(mockClient.searchPlaces).not.toHaveBeenCalled();
  expect(await screen.findByText('Corner Coffee')).toBeTruthy();
  expect(screen.getByText('Nearby')).toBeTruthy();
});

test('shows a busy state when the backend rate-limits, and retries on demand', async () => {
  mockClient.searchPlaces
    .mockRejectedValueOnce(new ApiError(429, { error: 'rate_limited' }))
    .mockResolvedValueOnce({ places: [place('r1', 'Retry Diner')] });
  await renderSearchBar();
  await openSearch();
  await typeQuery('retry diner');

  expect(await screen.findByText('Search is busy')).toBeTruthy();

  await fireEvent.press(screen.getByText('Try again'));
  await act(async () => { jest.advanceTimersByTime(PLACE_SEARCH_DEBOUNCE_MS); });

  expect(mockClient.searchPlaces).toHaveBeenCalledTimes(2);
  expect(await screen.findByText('Retry Diner')).toBeTruthy();
});

test('shows an unavailable state when place search is not configured on the backend', async () => {
  mockClient.searchPlaces.mockRejectedValue(new ApiError(503, { error: 'places_not_configured' }));
  await renderSearchBar();
  await openSearch();
  await typeQuery('unconfigured');

  expect(await screen.findByText('Search unavailable')).toBeTruthy();
});

test('shows an offline state when the backend cannot be reached', async () => {
  mockClient.searchPlaces.mockRejectedValue(new TypeError('Network request failed'));
  await renderSearchBar();
  await openSearch();
  await typeQuery('offline query');

  expect(await screen.findByText('Can’t reach place search')).toBeTruthy();
});

test('shows a no-results state for a genuine empty search', async () => {
  mockClient.searchPlaces.mockResolvedValue({ places: [] });
  await renderSearchBar();
  await openSearch();
  await typeQuery('zzzz nowhere');

  expect(await screen.findByText('No matching places')).toBeTruthy();
});

test('asks for location instead of searching when none is known', async () => {
  const props = await renderSearchBar({ near: null });
  await openSearch();

  expect(props.onRequestLocation).toHaveBeenCalledTimes(1);
  expect(screen.getByText('Location needed')).toBeTruthy();

  await typeQuery('no location');
  expect(mockClient.searchPlaces).not.toHaveBeenCalled();
});

test('lists and clears this rider’s recent places', async () => {
  await AsyncStorage.setItem(recentPlacesStorageKey(RIDER_ID), JSON.stringify([
    { ...place('recent-1', 'Old Haunt'), distanceMeters: 0 },
  ]));
  await renderSearchBar();
  await openSearch();

  expect(await screen.findByText('Old Haunt')).toBeTruthy();

  await fireEvent.press(screen.getByLabelText('Clear recent places'));

  expect(screen.queryByText('Old Haunt')).toBeNull();
  expect(await AsyncStorage.getItem(recentPlacesStorageKey(RIDER_ID))).toBeNull();
});
