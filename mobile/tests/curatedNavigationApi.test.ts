import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RiderCommsClient } from '../src/api/client.ts';

describe('native multi-stop navigation API contract', () => {
  it('sends the full curated journey in order and retains existing avoid options', async () => {
    let request: Record<string, unknown> = {};
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      request = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ coordinates: [], steps: [], distanceMeters: 0, durationSeconds: 0 }), { status: 200 });
    }) as typeof fetch;
    const client = new RiderCommsClient('https://example.invalid', fetchImpl);
    await client.getDrivingRoute(
      { lat: 51.5, lon: -0.1 },
      { lat: 51.6, lon: -0.2 },
      { highways: true, tolls: false, ferries: false },
      undefined,
      [{ lat: 51.51, lon: -0.11 }, { lat: 51.52, lon: -0.12 }],
    );
    assert.deepEqual(request.waypoints, [{ lat: 51.51, lon: -0.11 }, { lat: 51.52, lon: -0.12 }]);
    assert.equal(request.via, undefined);
    assert.deepEqual(request.avoid, { highways: true, tolls: false, ferries: false });
  });

  it('keeps a petrol stop ahead of the remaining curated route', async () => {
    let request: Record<string, unknown> = {};
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      request = JSON.parse(String(init?.body));
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    const client = new RiderCommsClient('https://example.invalid', fetchImpl);
    await client.getDrivingRoute(
      { lat: 51.5, lon: -0.1 }, { lat: 51.6, lon: -0.2 },
      undefined, { lat: 51.505, lon: -0.105 }, [{ lat: 51.51, lon: -0.11 }],
    );
    assert.deepEqual(request.waypoints, [{ lat: 51.505, lon: -0.105 }, { lat: 51.51, lon: -0.11 }]);
    assert.equal(request.via, undefined);
  });

  it('preserves the legacy single via request when no curated stops exist', async () => {
    let request: Record<string, unknown> = {};
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      request = JSON.parse(String(init?.body));
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    const client = new RiderCommsClient('https://example.invalid', fetchImpl);
    await client.getDrivingRoute(
      { lat: 51.5, lon: -0.1 }, { lat: 51.6, lon: -0.2 }, undefined, { lat: 51.505, lon: -0.105 },
    );
    assert.deepEqual(request.via, { lat: 51.505, lon: -0.105 });
    assert.equal(request.waypoints, undefined);
  });
});
