import * as React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ApiError } from '../../src/api/client';
import type { PlaceSuggestionSummary, PlaceSummary } from '../../src/api/client';
import { PLACE_SEARCH_DEBOUNCE_MS, PLACE_SUGGEST_DEBOUNCE_MS } from '../../src/api/places';
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
  searchNearbyPlaces: jest.fn<Promise<{ places: PlaceSummary[] }>, [readonly string[], { lat: number; lon: number }]>(),
  suggestPlaces: jest.fn<Promise<{ suggestions: PlaceSuggestionSummary[] }>, [string, { lat: number; lon: number }, string]>(),
  placeDetails: jest.fn<Promise<{ place: PlaceSummary }>, [string, string]>(),
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

function suggestion(id: string, name: string, distanceMeters?: number): PlaceSuggestionSummary {
  return { id, name, address: `${name} address`, ...(distanceMeters === undefined ? {} : { distanceMeters }) };
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
  await fireEvent.press(screen.getByLabelText('Where to?'));
}

async function typeQuery(value: string) {
  await fireEvent.changeText(screen.getByPlaceholderText('Search for a place'), value);
  await act(async () => { jest.advanceTimersByTime(PLACE_SUGGEST_DEBOUNCE_MS); });
}

beforeEach(async () => {
  jest.useFakeTimers();
  mockClient.searchNearbyPlaces.mockReset();
  mockClient.suggestPlaces.mockReset();
  mockClient.placeDetails.mockReset();
  await AsyncStorage.clear();
});

afterEach(() => {
  jest.useRealTimers();
});

// PlaceSearchBar keeps a module-level session cache of successful searches,
// so each test below uses its own query/category to avoid cross-test hits.

test('suggests places as the rider types, after a short pause', async () => {
  mockClient.suggestPlaces.mockResolvedValue({ suggestions: [suggestion('p1', 'Bike Cafe', 1200)] });
  await renderSearchBar();
  await openSearch();

  await fireEvent.changeText(screen.getByPlaceholderText('Search for a place'), 'bike ca');
  await fireEvent.changeText(screen.getByPlaceholderText('Search for a place'), 'bike cafe');
  await act(async () => { jest.advanceTimersByTime(PLACE_SUGGEST_DEBOUNCE_MS - 1); });
  expect(mockClient.suggestPlaces).not.toHaveBeenCalled();
  await act(async () => { jest.advanceTimersByTime(1); });

  expect(mockClient.suggestPlaces).toHaveBeenCalledTimes(1);
  expect(mockClient.suggestPlaces).toHaveBeenCalledWith('bike cafe', NEAR, expect.stringMatching(/^rc[0-9a-f]{30}$/));
  await act(async () => {});
  expect(await screen.findByText('Bike Cafe')).toBeTruthy();
  expect(screen.getByText('1.2 km')).toBeTruthy();
});

test('picking a suggestion looks it up in the same session, hands it to the map and remembers it', async () => {
  mockClient.suggestPlaces.mockResolvedValue({ suggestions: [suggestion('p2', 'Fuel Stop')] });
  mockClient.placeDetails.mockResolvedValue({ place: place('p2', 'Fuel Stop') });
  const props = await renderSearchBar();
  await openSearch();
  await typeQuery('fuel stop');

  await fireEvent.press(await screen.findByLabelText('Fuel Stop, Fuel Stop address'));
  await act(async () => {});

  const token = mockClient.suggestPlaces.mock.calls[0]![2];
  expect(mockClient.placeDetails).toHaveBeenCalledWith('p2', token);
  expect(props.onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'p2', name: 'Fuel Stop', lat: 51.501 }));
  const stored = JSON.parse((await AsyncStorage.getItem(recentPlacesStorageKey(RIDER_ID)))!) as PlaceResult[];
  expect(stored.map((item) => item.id)).toEqual(['p2']);

  // The pick ended that session: the next search starts a new one.
  await openSearch();
  await typeQuery('fuel again');
  expect(mockClient.suggestPlaces.mock.calls[1]![2]).not.toBe(token);
});

test('closing search while a pick is still loading drops that pick', async () => {
  mockClient.suggestPlaces.mockResolvedValue({ suggestions: [suggestion('p4', 'Slow Place')] });
  let answer!: (value: { place: PlaceSummary }) => void;
  mockClient.placeDetails.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
  const props = await renderSearchBar();
  await openSearch();
  await typeQuery('slow place');

  await fireEvent.press(await screen.findByLabelText('Slow Place, Slow Place address'));
  await fireEvent.press(screen.getByLabelText('Back to map'));
  await act(async () => { answer({ place: place('p4', 'Slow Place') }); });

  expect(props.onSelect).not.toHaveBeenCalled();
});

test('a failed lookup of the picked suggestion says so and stays on search', async () => {
  mockClient.suggestPlaces.mockResolvedValue({ suggestions: [suggestion('p3', 'Lost Place')] });
  mockClient.placeDetails.mockRejectedValue(new TypeError('Network request failed'));
  const props = await renderSearchBar();
  await openSearch();
  await typeQuery('lost place');

  await fireEvent.press(await screen.findByLabelText('Lost Place, Lost Place address'));
  await act(async () => {});

  expect(props.onSelect).not.toHaveBeenCalled();
  expect(await screen.findByText('Can’t reach place search')).toBeTruthy();
});

test('category chips run a nearby type search', async () => {
  mockClient.searchNearbyPlaces.mockResolvedValue({ places: [place('c1', 'Corner Coffee')] });
  await renderSearchBar();
  await openSearch();

  await fireEvent.press(screen.getByText('Coffee'));
  await act(async () => { jest.advanceTimersByTime(PLACE_SEARCH_DEBOUNCE_MS); });

  expect(mockClient.searchNearbyPlaces).toHaveBeenCalledWith(['cafe', 'coffee_shop'], NEAR);
  expect(mockClient.suggestPlaces).not.toHaveBeenCalled();
  expect(await screen.findByText('Corner Coffee')).toBeTruthy();
  expect(screen.getByText('Nearby')).toBeTruthy();
});

test('shows a busy state when the backend rate-limits, and retries on demand', async () => {
  mockClient.suggestPlaces
    .mockRejectedValueOnce(new ApiError(429, { error: 'rate_limited' }))
    .mockResolvedValueOnce({ suggestions: [suggestion('r1', 'Retry Diner')] });
  await renderSearchBar();
  await openSearch();
  await typeQuery('retry diner');

  expect(await screen.findByText('Search is busy')).toBeTruthy();

  await fireEvent.press(screen.getByText('Try again'));
  await act(async () => { jest.advanceTimersByTime(PLACE_SUGGEST_DEBOUNCE_MS); });

  expect(mockClient.suggestPlaces).toHaveBeenCalledTimes(2);
  expect(await screen.findByText('Retry Diner')).toBeTruthy();
});

test('shows an unavailable state when place search isn’t configured on the backend', async () => {
  mockClient.suggestPlaces.mockRejectedValue(new ApiError(503, { error: 'places_not_configured' }));
  await renderSearchBar();
  await openSearch();
  await typeQuery('unconfigured');

  expect(await screen.findByText('Search unavailable')).toBeTruthy();
});

test('shows an offline state when the backend can’t be reached', async () => {
  mockClient.suggestPlaces.mockRejectedValue(new TypeError('Network request failed'));
  await renderSearchBar();
  await openSearch();
  await typeQuery('offline query');

  expect(await screen.findByText('Can’t reach place search')).toBeTruthy();
});

test('shows a no-results state for a genuine empty search', async () => {
  mockClient.suggestPlaces.mockResolvedValue({ suggestions: [] });
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
  expect(mockClient.suggestPlaces).not.toHaveBeenCalled();
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

test('choosing a recent place opens it on the map', async () => {
  await AsyncStorage.setItem(recentPlacesStorageKey(RIDER_ID), JSON.stringify([
    { ...place('recent-2', 'Bike Night'), distanceMeters: 0 },
  ]));
  const props = await renderSearchBar();
  await openSearch();
  await fireEvent.press(await screen.findByLabelText(/^Recent place: Bike Night, Bike Night address/));
  expect(props.onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'recent-2' }));
});

test('shows no recent places when they can’t be read', async () => {
  const originalGetItem = AsyncStorage.getItem;
  AsyncStorage.getItem = jest.fn(async () => { throw new Error('storage unavailable'); });
  try {
    await renderSearchBar();
    await openSearch();
    expect(screen.queryByText('Recent places')).toBeNull();
  } finally {
    AsyncStorage.getItem = originalGetItem;
  }
});

test('tapping the active category again clears it', async () => {
  mockClient.searchNearbyPlaces.mockResolvedValue({ places: [place('f1', 'Fuel Co')] });
  await renderSearchBar();
  await openSearch();
  await fireEvent.press(screen.getByText('Repair'));
  await act(async () => { jest.advanceTimersByTime(PLACE_SEARCH_DEBOUNCE_MS); });
  expect(await screen.findByText('Fuel Co')).toBeTruthy();
  // The chip, not the search field now showing the same word.
  await fireEvent.press(screen.getAllByText('Repair')[0]!);
  expect(screen.queryByText('Fuel Co')).toBeNull();
});

test('a generic search failure says so, and location can be retried', async () => {
  mockClient.suggestPlaces.mockRejectedValue(new ApiError(500, { error: 'boom' }));
  await renderSearchBar();
  await openSearch();
  await typeQuery('server error query');
  expect(await screen.findByText('Place search failed')).toBeTruthy();
});

test('“Try location again” asks for location', async () => {
  const props = await renderSearchBar({ near: null });
  await openSearch();
  await fireEvent.press(screen.getByText('Try location again'));
  expect(props.onRequestLocation).toHaveBeenCalledTimes(2);
});

test('Android shows its own clear button', async () => {
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'android' });
  try {
    mockClient.suggestPlaces.mockResolvedValue({ suggestions: [] });
    await renderSearchBar();
    await openSearch();
    await fireEvent.changeText(screen.getByPlaceholderText('Search for a place'), 'clear me');
    await fireEvent.press(screen.getByLabelText('Clear search'));
    expect(screen.getByPlaceholderText('Search for a place').props.value).toBe('');
  } finally {
    Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'ios' });
  }
});
