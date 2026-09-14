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
        assert.deepEqual(JSON.parse(init.body as string), { riderId: 'ali' });
        return { status: 201, body: { rideId: 'r1', code: 'ABCDEF', expiresAt: 123 } };
      })
    );

    const result = await client.createRide('ali');
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
      () => client.joinRide('ZZZZZZ', 'ali'),
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
        assert.deepEqual(JSON.parse(init.body as string), {
          riderId: 'ali',
          lat: 40.0,
          lon: -105.0,
          radiusMiles: 1,
        });
        return {
          status: 200,
          body: { inZoneWith: ['friend'], transitions: [{ a: 'ali', b: 'friend', type: 'entered' }] },
        };
      })
    );

    const result = await client.updatePresence('ali', 40.0, -105.0, 1);
    assert.deepEqual(result.inZoneWith, ['friend']);
    assert.equal(result.transitions[0].type, 'entered');
  });
});
