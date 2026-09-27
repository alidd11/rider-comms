import { Alert } from 'react-native';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { HazardReport, HazardType } from '@rider-comms/shared';
import { ApiError } from '../../src/api/client';
import type { RiderCommsClient } from '../../src/api/client';
import { useHazardReports } from '../../src/screens/useHazardReports';

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
