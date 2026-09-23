import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DirectionsProviderError,
  decodeGooglePolyline,
  fetchGoogleDrivingRoute,
  stripGoogleNavigationInstruction,
} from '../src/directionsProvider.ts';

const origin = { lat: 51.5, lon: -0.1 };
const destination = { lat: 51.51, lon: -0.11 };
const encodedPolyline = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';

describe('Google directions provider', () => {
  it('normalises authoritative provider route data server-side', async () => {
    let requestedUrl = '';
    const fetchImpl = (async (url: string | URL | Request) => {
      requestedUrl = String(url);
      return new Response(JSON.stringify({
        status: 'OK',
        routes: [{
          overview_polyline: { points: encodedPolyline },
          legs: [{
            distance: { value: 1200 },
            duration: { value: 300 },
            steps: [{
              html_instructions: 'Turn <b>left</b><div>onto <b>A1</b> &amp; continue</div>',
              maneuver: 'turn-left',
              distance: { value: 1200 },
              duration: { value: 300 },
              start_location: { lat: 51.5, lng: -0.1 },
              end_location: { lat: 51.51, lng: -0.11 },
              polyline: { points: encodedPolyline },
            }],
          }],
        }],
      }), { status: 200 });
    }) as typeof fetch;

    const route = await fetchGoogleDrivingRoute(origin, destination, {
      apiKey: 'server-secret',
      fetchImpl,
    });

    assert.match(requestedUrl, /^https:\/\/maps\.googleapis\.com\/maps\/api\/directions\/json\?/);
    assert.match(requestedUrl, /key=server-secret/);
    assert.equal(route.steps[0]?.instruction, 'Turn left. onto A1 & continue');
    assert.equal(route.steps[0]?.maneuver, 'turn-left');
    assert.equal(route.distanceMeters, 1200);
    assert.equal(route.durationSeconds, 300);
    assert.equal(route.coordinates.length, 3);
    assert.equal(route.steps[0]?.coordinates.length, 3);
    assert.equal(JSON.stringify(route).includes('server-secret'), false);
  });

  it('decodes provider polylines and preserves provider-authored guidance', () => {
    assert.deepEqual(decodeGooglePolyline(encodedPolyline), [
      { lat: 38.5, lon: -120.2 },
      { lat: 40.7, lon: -120.95 },
      { lat: 43.252, lon: -126.453 },
    ]);
    assert.equal(
      stripGoogleNavigationInstruction("Continue straight onto <b>St Paul's Rd / A1201</b><div>Continue to follow St Paul's Rd / A1201</div>"),
      "Continue straight onto St Paul's Rd / A1201. Continue to follow St Paul's Rd / A1201",
    );
  });

  it('fails closed when the server credential is missing', async () => {
    await assert.rejects(
      () => fetchGoogleDrivingRoute(origin, destination, { apiKey: '' }),
      (error: unknown) => error instanceof DirectionsProviderError && error.code === 'directions_not_configured',
    );
  });

  it('maps provider errors to safe Rider Comms error codes without reflecting provider text', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({
      status: 'REQUEST_DENIED',
      error_message: 'server-secret should never be reflected',
    }), { status: 200 })) as typeof fetch;

    await assert.rejects(
      () => fetchGoogleDrivingRoute(origin, destination, { apiKey: 'server-secret', fetchImpl }),
      (error: unknown) => error instanceof DirectionsProviderError
        && error.code === 'directions_unavailable'
        && !error.message.includes('server-secret'),
    );
  });

  it('rejects missing route geometry instead of inventing a path', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({
      status: 'OK',
      routes: [{
        overview_polyline: { points: encodedPolyline },
        legs: [{
          distance: { value: 10 },
          duration: { value: 3 },
          steps: [{
            html_instructions: 'Turn <b>left</b>',
            distance: { value: 10 },
            duration: { value: 3 },
            start_location: { lat: 51.5, lng: -0.1 },
            end_location: { lat: 51.51, lng: -0.11 },
          }],
        }],
      }],
    }), { status: 200 })) as typeof fetch;

    await assert.rejects(
      () => fetchGoogleDrivingRoute(origin, destination, { apiKey: 'server-secret', fetchImpl }),
      (error: unknown) => error instanceof DirectionsProviderError && error.code === 'directions_invalid_response',
    );
  });

  it('distinguishes no-route results from provider failures', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({
      status: 'ZERO_RESULTS',
      routes: [],
    }), { status: 200 })) as typeof fetch;

    await assert.rejects(
      () => fetchGoogleDrivingRoute(origin, destination, { apiKey: 'server-secret', fetchImpl }),
      (error: unknown) => error instanceof DirectionsProviderError && error.code === 'directions_no_route',
    );
  });
});
