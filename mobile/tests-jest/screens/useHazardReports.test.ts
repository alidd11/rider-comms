import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { HazardReport, HazardType } from '@rider-comms/shared';
import { ApiError } from '../../src/api/client';
import type { RiderCommsClient } from '../../src/api/client';
import { QUEUED_REPORT_MAX_AGE_MS, QUEUED_REPORT_RETRY_MS, parseQueuedReports, queuedReportsStorageKey, queuedReportsText, useHazardReports } from '../../src/screens/useHazardReports';

function fakeHazard(id: string, type: HazardType = 'police'): HazardReport {
  return {
    id,
    type,
    lat: 51.5,
    lon: -0.1,
    reportedBy: 'rider-1',
    createdAt: 0,
    expiresAt: Number.MAX_SAFE_INTEGER,
    confirmations: 0,
    denials: 0,
  };
}

interface Props {
  client: Partial<RiderCommsClient>;
  hasCurrentLocation: boolean;
  currentLocationRef: { current: { lat: number; lon: number } | null };
  requestCurrentLocation: jest.Mock;
}

async function renderHazards(overrides: Partial<Props> = {}) {
  const props: Props = {
    hasCurrentLocation: true,
    currentLocationRef: { current: { lat: 51.5, lon: -0.1 } },
    requestCurrentLocation: jest.fn(async () => ({ lat: 51.5, lon: -0.1 })),
    ...overrides,
    client: {
      getNearbyHazards: jest.fn(async () => ({ hazards: [] })),
      createHazard: jest.fn(async (type: HazardType, lat: number, lon: number) => ({ ...fakeHazard('new', type), lat, lon })),
      confirmHazard: jest.fn(async () => ({})),
      denyHazard: jest.fn(async () => ({})),
      ...overrides.client,
    },
  };

  return { props, ...await renderHook(
    (p: Props) => useHazardReports(
      p.client as RiderCommsClient,
      p.hasCurrentLocation,
      p.currentLocationRef,
      p.requestCurrentLocation,
    ),
    { initialProps: props },
  ) };
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test('fetches nearby hazards for the current location', async () => {
  const client = { getNearbyHazards: jest.fn(async () => ({ hazards: [fakeHazard('h1')] })) };
  const { result } = await renderHazards({ client });

  await waitFor(() => expect(result.current.hazards).toEqual([fakeHazard('h1')]));
  expect(client.getNearbyHazards).toHaveBeenCalledWith(51.5, -0.1);
});

test('clears hazards and skips fetching without a current location', async () => {
  const client = { getNearbyHazards: jest.fn(async () => ({ hazards: [fakeHazard('h1')] })) };
  const { result } = await renderHazards({ client, hasCurrentLocation: false });

  await waitFor(() => expect(result.current.hazards).toEqual([]));
  expect(client.getNearbyHazards).not.toHaveBeenCalled();
});

test('re-fetches hazards on the refresh interval', async () => {
  const client = { getNearbyHazards: jest.fn(async () => ({ hazards: [] })) };
  await renderHazards({ client });

  await waitFor(() => expect(client.getNearbyHazards).toHaveBeenCalledTimes(1));

  await act(async () => {
    jest.advanceTimersByTime(60_000);
  });
  await waitFor(() => expect(client.getNearbyHazards).toHaveBeenCalledTimes(2));
});

test('derives the selected hazard from its id', async () => {
  const client = { getNearbyHazards: jest.fn(async () => ({ hazards: [fakeHazard('h1'), fakeHazard('h2')] })) };
  const { result } = await renderHazards({ client });

  await waitFor(() => expect(result.current.hazards).toHaveLength(2));

  await act(() => {
    result.current.setSelectedHazardId('h2');
  });

  expect(result.current.selectedHazard).toEqual(fakeHazard('h2'));
});

test('opens the report sheet immediately when a location is already known', async () => {
  const requestCurrentLocation = jest.fn();
  const { result } = await renderHazards({ requestCurrentLocation });

  await act(async () => {
    await result.current.openReportSheet();
  });

  expect(result.current.reportSheetOpen).toBe(true);
  expect(requestCurrentLocation).not.toHaveBeenCalled();
});

test('requests a fresh location for the report sheet when none is cached, and alerts if none is available', async () => {
  const requestCurrentLocation = jest.fn(async () => null);
  const { result } = await renderHazards({
    requestCurrentLocation,
    currentLocationRef: { current: null },
  });

  await act(async () => {
    await result.current.openReportSheet();
  });

  expect(requestCurrentLocation).toHaveBeenCalled();
  expect(result.current.reportSheetOpen).toBe(false);
  expect(Alert.alert).toHaveBeenCalledWith('Location needed', expect.any(String));
});

test('closing the report sheet clears its pending location', async () => {
  const { result } = await renderHazards();

  await act(async () => {
    await result.current.openReportSheet();
  });
  expect(result.current.reportSheetOpen).toBe(true);

  await act(() => {
    result.current.closeReportSheet();
  });
  expect(result.current.reportSheetOpen).toBe(false);
});

test('reporting a hazard adds it to the list, selects it, and closes the sheet', async () => {
  const client = {
    getNearbyHazards: jest.fn(async () => ({ hazards: [fakeHazard('existing')] })),
    createHazard: jest.fn(async (type: HazardType) => ({ ...fakeHazard('new-hazard', type) })),
  };
  const { result } = await renderHazards({ client });
  await waitFor(() => expect(result.current.hazards).toHaveLength(1));

  await act(async () => {
    await result.current.openReportSheet();
  });
  await act(async () => {
    await result.current.handleReport('police');
  });

  expect(client.createHazard).toHaveBeenCalledWith('police', 51.5, -0.1);
  expect(result.current.hazards.map((h) => h.id)).toEqual(['new-hazard', 'existing']);
  expect(result.current.selectedHazardId).toBe('new-hazard');
  expect(result.current.reportSheetOpen).toBe(false);
});

test('surfaces the email-verification alert distinctly from a generic report failure', async () => {
  const client = {
    createHazard: jest.fn(async () => {
      throw new ApiError(403, { error: 'email_verification_required' });
    }),
  };
  const { result } = await renderHazards({ client });

  await act(async () => {
    await result.current.openReportSheet();
  });
  await act(async () => {
    await result.current.handleReport('camera');
  });

  expect(Alert.alert).toHaveBeenCalledWith('Verify your email', expect.any(String));
});

test('reporting without any known location is a no-op', async () => {
  const client = { createHazard: jest.fn() };
  const { result } = await renderHazards({ client, currentLocationRef: { current: null } });

  await act(async () => {
    await result.current.handleReport('accident');
  });

  expect(client.createHazard).not.toHaveBeenCalled();
});

test('confirming a hazard increments its confirmation count and clears the selection', async () => {
  const client = {
    getNearbyHazards: jest.fn(async () => ({ hazards: [fakeHazard('h1')] })),
    confirmHazard: jest.fn(async () => ({})),
  };
  const { result } = await renderHazards({ client });
  await waitFor(() => expect(result.current.hazards).toHaveLength(1));

  await act(() => {
    result.current.setSelectedHazardId('h1');
  });

  await act(async () => {
    await result.current.handleVote('h1', 'confirm');
  });

  expect(client.confirmHazard).toHaveBeenCalledWith('h1');
  expect(result.current.hazards[0]!.confirmations).toBe(1);
  expect(result.current.selectedHazardId).toBeNull();
});

test('denying a hazard increments its denial count', async () => {
  const client = {
    getNearbyHazards: jest.fn(async () => ({ hazards: [fakeHazard('h1')] })),
    denyHazard: jest.fn(async () => ({})),
  };
  const { result } = await renderHazards({ client });
  await waitFor(() => expect(result.current.hazards).toHaveLength(1));

  await act(async () => {
    await result.current.handleVote('h1', 'deny');
  });

  expect(client.denyHazard).toHaveBeenCalledWith('h1');
  expect(result.current.hazards[0]!.denials).toBe(1);
});

test('surfaces a generic alert and still clears selection when a vote fails', async () => {
  const client = {
    getNearbyHazards: jest.fn(async () => ({ hazards: [fakeHazard('h1')] })),
    confirmHazard: jest.fn(async () => { throw new Error('network down'); }),
  };
  const { result } = await renderHazards({ client });
  await waitFor(() => expect(result.current.hazards).toHaveLength(1));

  await act(() => {
    result.current.setSelectedHazardId('h1');
  });

  await act(async () => {
    await result.current.handleVote('h1', 'confirm');
  });

  expect(Alert.alert).toHaveBeenCalledWith('Couldn’t update road report', expect.any(String));
  expect(result.current.selectedHazardId).toBeNull();
  expect(result.current.hazards[0]!.confirmations).toBe(0);
});

test('confirms the rider\'s report on its card, and says when it was already there', async () => {
  const { result } = await renderHazards({
    client: {
      getNearbyHazards: jest.fn(async () => ({ hazards: [fakeHazard('existing', 'accident')] })),
      createHazard: jest.fn(async (type: HazardType) => fakeHazard(type === 'accident' ? 'existing' : 'fresh', type)),
    },
  });
  await waitFor(() => expect(result.current.hazards).toHaveLength(1));

  await act(async () => { await result.current.openReportSheet(); });
  await act(async () => { await result.current.handleReport('police'); });
  expect(result.current.reportNotice).toEqual({ hazardId: 'fresh', text: 'Police reported.' });

  await act(async () => { await result.current.openReportSheet(); });
  await act(async () => { await result.current.handleReport('accident'); });
  expect(result.current.reportNotice?.text).toBe('Accident already reported here. Thanks for confirming it.');

  // Selecting another report hides the confirmation.
  await act(async () => { result.current.setSelectedHazardId('fresh'); });
  expect(result.current.reportNotice).toBeNull();
});

describe('a report made with no signal', () => {
  async function reportOffline(createHazard: jest.Mock, announce = jest.fn()) {
    const props = {
      hasCurrentLocation: true,
      currentLocationRef: { current: { lat: 51.5, lon: -0.1 } },
      requestCurrentLocation: jest.fn(),
      client: { getNearbyHazards: jest.fn(async () => ({ hazards: [] })), createHazard } as Partial<RiderCommsClient>,
    };
    const view = await renderHook(() => useHazardReports(
      props.client as RiderCommsClient, props.hasCurrentLocation, props.currentLocationRef, props.requestCurrentLocation, announce,
    ));
    await act(async () => { await view.result.current.openReportSheet(); });
    await act(async () => { await view.result.current.handleReport('police'); });
    return { ...view, announce };
  }

  test('waits for signal, then sends and says so', async () => {
    const createHazard = jest.fn()
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockResolvedValueOnce(fakeHazard('sent'));
    const { result, announce } = await reportOffline(createHazard);
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(result.current.queuedReportCount).toBe(1);
    expect(announce).toHaveBeenLastCalledWith('No signal. Your police report will send when you’re back in signal.');

    // Still no signal on the first retry.
    await act(async () => { await jest.advanceTimersByTimeAsync(QUEUED_REPORT_RETRY_MS); });
    expect(result.current.queuedReportCount).toBe(1);

    await act(async () => { await jest.advanceTimersByTimeAsync(QUEUED_REPORT_RETRY_MS); });
    expect(createHazard).toHaveBeenCalledTimes(3);
    expect(createHazard).toHaveBeenLastCalledWith('police', 51.5, -0.1);
    expect(result.current.queuedReportCount).toBe(0);
    expect(result.current.hazards.map((hazard) => hazard.id)).toEqual(['sent']);
    expect(announce).toHaveBeenLastCalledWith('Police report sent.');
  });

  test('is dropped if the server turns it down', async () => {
    const createHazard = jest.fn()
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockRejectedValueOnce(new ApiError(429, { error: 'rate_limited' }));
    const { result } = await reportOffline(createHazard);
    await act(async () => { await jest.advanceTimersByTimeAsync(QUEUED_REPORT_RETRY_MS); });
    expect(result.current.queuedReportCount).toBe(0);
    expect(result.current.hazards).toEqual([]);
  });

  test('is dropped, with a word, after waiting too long', async () => {
    const createHazard = jest.fn(async () => { throw new TypeError('Network request failed'); });
    const { result, announce } = await reportOffline(createHazard);
    await act(async () => { await jest.advanceTimersByTimeAsync(QUEUED_REPORT_MAX_AGE_MS + QUEUED_REPORT_RETRY_MS); });
    expect(result.current.queuedReportCount).toBe(0);
    expect(announce).toHaveBeenLastCalledWith('Couldn’t send your earlier police report. There was no signal for too long.');
  });

  test('the map text counts the waiting reports', () => {
    expect(queuedReportsText(1)).toBe('Road report waiting for signal.');
    expect(queuedReportsText(3)).toBe('3 road reports waiting for signal.');
  });
});

describe('waiting reports are kept on the device', () => {
  const location = { current: { lat: 51.5, lon: -0.1 } };
  function renderFor(riderId: string | null, createHazard: jest.Mock) {
    const client = { getNearbyHazards: jest.fn(async () => ({ hazards: [] })), createHazard } as Partial<RiderCommsClient>;
    return renderHook(({ id }: { id: string | null }) => useHazardReports(
      client as RiderCommsClient, true, location, jest.fn(), jest.fn(), id,
    ), { initialProps: { id: riderId } });
  }

  beforeEach(async () => { await AsyncStorage.clear(); });

  test('a report waiting when the app closed is sent after it reopens', async () => {
    await AsyncStorage.setItem(queuedReportsStorageKey('me'), JSON.stringify([
      { hazardType: 'accident', lat: 51.4, lon: -0.2, queuedAt: Date.now() },
    ]));
    const createHazard = jest.fn(async () => fakeHazard('sent', 'accident'));
    const { result } = await renderFor('me', createHazard);
    await waitFor(() => expect(result.current.queuedReportCount).toBe(1));
    await act(async () => { await jest.advanceTimersByTimeAsync(QUEUED_REPORT_RETRY_MS); });
    expect(createHazard).toHaveBeenCalledWith('accident', 51.4, -0.2);
    expect(result.current.queuedReportCount).toBe(0);
    await waitFor(async () => expect(await AsyncStorage.getItem(queuedReportsStorageKey('me'))).toBeNull());
  });

  test('a report made with no signal is saved for this rider only', async () => {
    const createHazard = jest.fn(async () => { throw new TypeError('Network request failed'); });
    const view = await renderFor('me', createHazard);
    await waitFor(() => expect(AsyncStorage.getItem).toHaveBeenCalledWith(queuedReportsStorageKey('me')));
    await act(async () => { await view.result.current.openReportSheet(); });
    await act(async () => { await view.result.current.handleReport('police'); });
    await waitFor(async () => expect(parseQueuedReports(await AsyncStorage.getItem(queuedReportsStorageKey('me')))).toEqual([
      expect.objectContaining({ hazardType: 'police', lat: 51.5, lon: -0.1 }),
    ]));
    // Another rider signing in on this phone doesn't inherit it.
    await view.rerender({ id: 'someone-else' });
    await waitFor(() => expect(view.result.current.queuedReportCount).toBe(0));
    await view.rerender({ id: null });
    expect(view.result.current.queuedReportCount).toBe(0);
  });

  test('saved reports that are malformed are ignored', () => {
    expect(parseQueuedReports(null)).toEqual([]);
    expect(parseQueuedReports('not json')).toEqual([]);
    expect(parseQueuedReports('{"a":1}')).toEqual([]);
    expect(parseQueuedReports(JSON.stringify([
      null,
      { hazardType: 'tank', lat: 1, lon: 1, queuedAt: 1 },
      { hazardType: 'police', lat: 91, lon: 1, queuedAt: 1 },
      { hazardType: 'police', lat: 1, lon: 181, queuedAt: 1 },
      { hazardType: 'police', lat: 1, lon: 1 },
      { hazardType: 'camera', lat: 1, lon: 2, queuedAt: 3, extra: true },
    ]))).toEqual([{ hazardType: 'camera', lat: 1, lon: 2, queuedAt: 3 }]);
  });

  test('a storage failure leaves reporting working', async () => {
    jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('disk'));
    const createHazard = jest.fn(async () => fakeHazard('ok'));
    const { result } = await renderFor('me', createHazard);
    await act(async () => { await result.current.openReportSheet(); });
    await act(async () => { await result.current.handleReport('police'); });
    expect(createHazard).toHaveBeenCalled();
  });
});
