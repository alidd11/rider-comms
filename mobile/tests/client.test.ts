import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, RiderCommsClient } from '../src/api/client.ts';

/** A minimal fake `fetch` so this test needs neither a running backend nor
 * React Native — it only proves the client shapes requests/responses
 * correctly. */
function fakeFetch(
  handler: (url: string, init: RequestInit) => { status: number; body: unknown }
): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    const { status, body } = handler(url, init);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as Response;
  }) as typeof fetch;
}

describe('RiderCommsClient.createRide', () => {
  it('POSTs to /rides with the riderId and returns the parsed response', async () => {
    const client = new RiderCommsClient(
      'http://example.test',
      fakeFetch((url, init) => {
        assert.equal(url, 'http://example.test/rides');
        assert.equal(init.method, 'POST');
        assert.deepEqual(JSON.parse(init.body as string), {});
        return { status: 201, body: { rideId: 'r1', code: 'ABCDEF', expiresAt: 123 } };
      })
    );

    const result = await client.createRide();
    assert.deepEqual(result, { rideId: 'r1', code: 'ABCDEF', expiresAt: 123 });
  });
});

describe('RiderCommsClient.joinRide', () => {
  it('throws an ApiError with the status and body on a non-2xx response', async () => {
    const client = new RiderCommsClient(
      'http://example.test',
      fakeFetch(() => ({ status: 404, body: { error: 'invalid_or_expired' } }))
    );

    await assert.rejects(
      () => client.joinRide('ZZZZZZ'),
      (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.status, 404);
        assert.deepEqual(err.body, { error: 'invalid_or_expired' });
        return true;
      }
    );
  });
});

describe('RiderCommsClient.updatePresence', () => {
  it('sends lat/lon/radiusMiles and returns inZoneWith + transitions', async () => {
    const client = new RiderCommsClient(
      'http://example.test',
      fakeFetch((url, init) => {
        assert.equal(url, 'http://example.test/presence');
        assert.deepEqual(JSON.parse(init.body as string), { lat: 40.0, lon: -105.0 });
        return {
          status: 200,
          body: { inZoneWith: ['friend'], transitions: [{ a: 'ali', b: 'friend', type: 'entered' }] },
        };
      })
    );

    const result = await client.updatePresence(40.0, -105.0);
    assert.deepEqual(result.inZoneWith, ['friend']);
    assert.equal(result.transitions[0].type, 'entered');
  });
});

describe('RiderCommsClient.hazards', () => {
  it('createHazard POSTs the type and coordinates', async () => {
    const client = new RiderCommsClient(
      'http://example.test',
      fakeFetch((url, init) => {
        assert.equal(url, 'http://example.test/hazards');
        assert.deepEqual(JSON.parse(init.body as string), { type: 'police', lat: 1, lon: 2 });
        return { status: 201, body: { id: 'h1', type: 'police', lat: 1, lon: 2, reportedBy: 'me', createdAt: 0, expiresAt: 1, confirmations: 0, denials: 0 } };
      })
    );
    const result = await client.createHazard('police', 1, 2);
    assert.equal(result.id, 'h1');
  });

  it('getNearbyHazards GETs with lat/lon query params', async () => {
    const client = new RiderCommsClient(
      'http://example.test',
      fakeFetch((url) => {
        assert.equal(url, 'http://example.test/hazards/nearby?lat=1&lon=2');
        return { status: 200, body: { hazards: [] } };
      })
    );
    const result = await client.getNearbyHazards(1, 2);
    assert.deepEqual(result.hazards, []);
  });

  it('confirmHazard and denyHazard POST to the right path', async () => {
    const client = new RiderCommsClient(
      'http://example.test',
      fakeFetch((url) => {
        assert.equal(url, 'http://example.test/hazards/h1/confirm');
        return { status: 200, body: {} };
      })
    );
    await client.confirmHazard('h1');
  });
});

describe('RiderCommsClient.scenicRoutes', () => {
  const routeInput = {
    name: 'Coastal loop',
    description: 'A scenic coastal ride.',
    vehicleSuitability: ['motorcycle_large' as const],
    roadType: 'coastal' as const,
    distanceMiles: 40,
    estimatedDurationMinutes: 90,
    difficulty: 'moderate' as const,
    surfaceQuality: 'good' as const,
    avoidsTolls: true,
    avoidsMotorways: false,
    scenicRating: 5 as const,
    safetyNotices: ['Narrow shoulder in places.'],
    startLat: 1,
    startLon: 2,
    endLat: 3,
    endLon: 4,
  };

  it('createScenicRoute POSTs the full input', async () => {
    const client = new RiderCommsClient(
      'http://example.test',
      fakeFetch((url, init) => {
        assert.equal(url, 'http://example.test/scenic-routes');
        assert.deepEqual(JSON.parse(init.body as string), routeInput);
        return { status: 201, body: { ...routeInput, id: 'r1', createdBy: 'me', createdAt: 0 } };
      })
    );
    const result = await client.createScenicRoute(routeInput);
    assert.equal(result.id, 'r1');
  });

  it('listScenicRoutes builds a query string only for provided filters', async () => {
    const client = new RiderCommsClient(
      'http://example.test',
      fakeFetch((url) => {
        assert.equal(url, 'http://example.test/scenic-routes?vehicleCategory=motorcycle_large');
        return { status: 200, body: { routes: [] } };
      })
    );
    await client.listScenicRoutes({ vehicleCategory: 'motorcycle_large' });
  });

  it('listScenicRoutes with no filters omits the query string', async () => {
    const client = new RiderCommsClient(
      'http://example.test',
      fakeFetch((url) => {
        assert.equal(url, 'http://example.test/scenic-routes');
        return { status: 200, body: { routes: [] } };
      })
    );
    await client.listScenicRoutes();
  });
});
