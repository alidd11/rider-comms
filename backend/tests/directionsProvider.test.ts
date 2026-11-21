import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DirectionsProviderError,
  decodeGooglePolyline,
  fetchDrivingRoute,
  fetchGoogleDrivingRoute,
  fetchGoogleRoutes,
  routeAvoidance,
  routesManeuver,
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
          summary: 'A1',
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
    assert.equal(route.summary, 'A1');
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

  it('passes the rider route options to Google as avoid=', async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: string | URL | Request) => {
      urls.push(String(url));
      return new Response(JSON.stringify({ status: 'ZERO_RESULTS', routes: [] }), { status: 200 });
    }) as typeof fetch;
    for (const avoid of [{}, { highways: true }, { highways: true, tolls: true }, { ferries: true }]) {
      await fetchGoogleDrivingRoute(origin, destination, { apiKey: 'k', fetchImpl, avoid }).catch(() => {});
    }
    assert.equal(new URL(urls[0]!).searchParams.get('avoid'), null);
    assert.equal(new URL(urls[1]!).searchParams.get('avoid'), 'highways');
    assert.equal(new URL(urls[2]!).searchParams.get('avoid'), 'highways|tolls');
    assert.equal(new URL(urls[3]!).searchParams.get('avoid'), 'ferries');
  });

  it('reads route options from a request body, treating anything but true as off', () => {
    assert.deepEqual(routeAvoidance({ highways: true, tolls: 'yes', ferries: true }), { highways: true, tolls: false, ferries: true });
    assert.deepEqual(routeAvoidance(null), {});
    assert.deepEqual(routeAvoidance(['highways']), {});
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

function routesStep(overrides: Record<string, unknown> = {}) {
  return {
    distanceMeters: 600,
    staticDuration: '100s',
    polyline: { encodedPolyline },
    startLocation: { latLng: { latitude: 51.5, longitude: -0.1 } },
    endLocation: { latLng: { latitude: 51.51, longitude: -0.11 } },
    navigationInstruction: { maneuver: 'TURN_SLIGHT_LEFT', instructions: 'Turn slightly left onto A1' },
    ...overrides,
  };
}

function routesRoute(duration: string, staticDuration: string, steps = [routesStep(), routesStep({ navigationInstruction: undefined })]) {
  return { distanceMeters: 1200, duration, staticDuration, polyline: { encodedPolyline }, legs: [{ steps }] };
}

describe('Google Routes API provider', () => {
  it('asks for live traffic and alternatives, and spreads the delay over the steps', async () => {
    let request: { url: string; init?: RequestInit } | null = null;
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      request = { url: String(url), init };
      return new Response(JSON.stringify({ routes: [
        { ...routesRoute('300s', '200s'), description: '  A41 and\nM25 ', travelAdvisory: { speedReadingIntervals: [
          { endPolylinePointIndex: 1, speed: 'SLOW' },
          { startPolylinePointIndex: 1, endPolylinePointIndex: 2, speed: 'TRAFFIC_JAM' },
          { startPolylinePointIndex: 0, endPolylinePointIndex: 2, speed: 'NORMAL' },
          { startPolylinePointIndex: 2, endPolylinePointIndex: 9, speed: 'SLOW' },
          { startPolylinePointIndex: 1, endPolylinePointIndex: 1, speed: 'SLOW' },
          { startPolylinePointIndex: 'x', endPolylinePointIndex: 2, speed: 'SLOW' },
        ] } },
        { ...routesRoute('360s', '330s'), description: 'x'.repeat(120) },
        routesRoute('400s', '400s'),
        routesRoute('500s', '500s'),
      ] }), { status: 200 });
    }) as typeof fetch;

    const route = await fetchGoogleRoutes(origin, destination, { apiKey: 'server-secret', fetchImpl, avoid: { tolls: true } });

    assert.equal(request!.url, 'https://routes.googleapis.com/directions/v2:computeRoutes');
    const headers = request!.init!.headers as Record<string, string>;
    assert.equal(headers['X-Goog-Api-Key'], 'server-secret');
    assert.match(headers['X-Goog-FieldMask']!, /routes\.legs\.steps\.navigationInstruction/);
    assert.match(headers['X-Goog-FieldMask']!, /routes\.description/);
    const body = JSON.parse(String(request!.init!.body));
    assert.equal(body.routingPreference, 'TRAFFIC_AWARE');
    assert.equal(body.computeAlternativeRoutes, true);
    assert.equal(body.polylineQuality, 'HIGH_QUALITY');
    assert.deepEqual(body.extraComputations, ['TRAFFIC_ON_POLYLINE']);
    assert.match(headers['X-Goog-FieldMask']!, /routes\.travelAdvisory\.speedReadingIntervals/);
    assert.deepEqual(body.routeModifiers, { avoidHighways: false, avoidTolls: true, avoidFerries: false });
    assert.deepEqual(body.origin, { location: { latLng: { latitude: 51.5, longitude: -0.1 } } });

    assert.equal(route.durationSeconds, 300);
    assert.equal(route.typicalDurationSeconds, 200);
    // 200 s of steps stretched to the 300 s the traffic says.
    assert.deepEqual(route.steps.map((step) => step.durationSeconds), [150, 150]);
    assert.equal(route.steps[0]?.instruction, 'Turn slightly left onto A1');
    assert.equal(route.steps[0]?.maneuver, 'turn-slight-left');
    // A step Google gives no instruction for still reads as something.
    assert.equal(route.steps[1]?.instruction, 'Continue');
    assert.equal(route.steps[1]?.maneuver, undefined);
    // At most two alternatives, without nesting.
    assert.deepEqual(route.alternatives?.map((alt) => alt.durationSeconds), [360, 400]);
    assert.equal(route.alternatives?.[0]?.alternatives, undefined);
    // The main road for the route preview, tidied and kept short.
    assert.equal(route.summary, 'A41 and M25');
    // Slow and jammed stretches only, and only ones on the line.
    assert.deepEqual(route.traffic, [{ startIndex: 0, endIndex: 1, speed: 'slow' }, { startIndex: 1, endIndex: 2, speed: 'jam' }]);
    assert.equal(route.alternatives?.[0]?.traffic, undefined);
    assert.equal(route.alternatives?.[0]?.summary?.length, 80);
    assert.equal(route.alternatives?.[1]?.summary, undefined);
    assert.equal(JSON.stringify(route).includes('server-secret'), false);
  });

  it('works without traffic figures, and with no alternatives', async () => {
    const steps = [routesStep({ staticDuration: '0s' })];
    const fetchImpl = (async () => new Response(JSON.stringify({ routes: [
      { polyline: { encodedPolyline }, legs: [{ steps }] },
    ] }), { status: 200 })) as typeof fetch;
    const route = await fetchGoogleRoutes(origin, destination, { apiKey: 'k', fetchImpl });
    assert.equal(route.durationSeconds, 0);
    assert.equal(route.distanceMeters, 600);
    assert.equal(route.alternatives, undefined);
  });

  it('maps Routes API maneuvers to the names both apps draw', () => {
    assert.equal(routesManeuver('UTURN_RIGHT'), 'uturn-right');
    assert.equal(routesManeuver('ROUNDABOUT_LEFT'), 'roundabout-left');
    assert.equal(routesManeuver('MANEUVER_UNSPECIFIED'), undefined);
    assert.equal(routesManeuver(''), undefined);
    assert.equal(routesManeuver(42), undefined);
  });

  it('falls back to the legacy Directions API while the Routes API is not enabled', async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: string | URL | Request) => {
      urls.push(String(url));
      if (String(url).startsWith('https://routes.googleapis.com')) {
        return new Response(JSON.stringify({ error: { status: 'PERMISSION_DENIED' } }), { status: 403 });
      }
      return new Response(JSON.stringify({ status: 'OK', routes: [{
        overview_polyline: { points: encodedPolyline },
        legs: [{ distance: { value: 900 }, duration: { value: 120 }, steps: [{
          html_instructions: 'Head north', distance: { value: 900 }, duration: { value: 120 },
          start_location: { lat: 51.5, lng: -0.1 }, end_location: { lat: 51.51, lng: -0.11 }, polyline: { points: encodedPolyline },
        }] }],
      }] }), { status: 200 });
    }) as typeof fetch;
    const route = await fetchDrivingRoute(origin, destination, { apiKey: 'k', fetchImpl });
    assert.equal(urls.length, 2);
    assert.match(urls[1]!, /maps\/api\/directions\/json/);
    assert.equal(route.durationSeconds, 120);
  });

  it('passes other failures through rather than falling back', async () => {
    const fail = (status: number, body: unknown = {}) => (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
    const code = async (promise: Promise<unknown>) => {
      try { await promise; return 'ok'; } catch (error) { return error instanceof DirectionsProviderError ? error.code : String(error); }
    };
    assert.equal(await code(fetchDrivingRoute(origin, destination, { apiKey: 'k', fetchImpl: fail(500) })), 'directions_unavailable');
    assert.equal(await code(fetchDrivingRoute(origin, destination, { apiKey: 'k', fetchImpl: fail(200, {}) })), 'directions_no_route');
    assert.equal(await code(fetchGoogleRoutes(origin, destination, { apiKey: 'k', fetchImpl: (async () => new Response('not json', { status: 200 })) as typeof fetch })), 'directions_invalid_response');
    assert.equal(await code(fetchGoogleRoutes(origin, destination, { apiKey: 'k', fetchImpl: fail(200, { routes: [{ polyline: { encodedPolyline } }] }) })), 'directions_invalid_response');
    assert.equal(await code(fetchGoogleRoutes(origin, destination, { apiKey: 'k', fetchImpl: fail(200, { routes: [{ polyline: { encodedPolyline: '' }, legs: [{ steps: [routesStep()] }] }] }) })), 'directions_invalid_response');
    assert.equal(await code(fetchGoogleRoutes(origin, destination, { apiKey: 'k', fetchImpl: fail(200, { routes: [routesRoute('1s', '1s', [routesStep({ staticDuration: 'soon' })])] }) })), 'directions_invalid_response');
    assert.equal(await code(fetchGoogleRoutes(origin, destination, { apiKey: '', fetchImpl: fail(200) })), 'directions_not_configured');
    assert.equal(await code(fetchGoogleRoutes({ lat: 99, lon: 0 }, destination, { apiKey: 'k', fetchImpl: fail(200) })), 'directions_invalid_request');
    assert.equal(await code(fetchGoogleRoutes(origin, destination, { apiKey: 'k', fetchImpl: (async () => { throw new TypeError('offline'); }) as typeof fetch })), 'directions_unavailable');
    const hang = ((_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })) as typeof fetch;
    assert.equal(await code(fetchGoogleRoutes(origin, destination, { apiKey: 'k', fetchImpl: hang, timeoutMs: 5 })), 'directions_timeout');
  });
});

describe('ordered curated route waypoints', () => {
  it('passes every ordered waypoint to Google Routes and disables alternatives', async () => {
    const intermediate = [{ lat: 51.502, lon: -0.101 }, { lat: 51.506, lon: -0.105 }, { lat: 51.508, lon: -0.108 }];
    let body: Record<string, unknown> = {};
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ routes: [routesRoute('300s', '280s')] }), { status: 200 });
    }) as typeof fetch;
    await fetchGoogleRoutes(origin, destination, { apiKey: 'k', fetchImpl, avoid: { waypoints: intermediate } });
    assert.deepEqual(body.intermediates, intermediate.map((coordinate) => ({ location: { latLng: { latitude: coordinate.lat, longitude: coordinate.lon } } })));
    assert.equal(body.computeAlternativeRoutes, false);
  });

  it('keeps ordered waypoints on legacy Directions fallback', async () => {
    let url = '';
    const fetchImpl = (async (requested: string | URL | Request) => {
      url = String(requested);
      return new Response(JSON.stringify({ status: 'ZERO_RESULTS' }), { status: 200 });
    }) as typeof fetch;
    await assert.rejects(() => fetchGoogleDrivingRoute(origin, destination, {
      apiKey: 'k', fetchImpl, avoid: { waypoints: [{ lat: 51.502, lon: -0.101 }, { lat: 51.506, lon: -0.105 }] },
    }), (error: unknown) => error instanceof DirectionsProviderError && error.code === 'directions_no_route');
    assert.equal(new URL(url).searchParams.get('waypoints'), '51.502,-0.101|51.506,-0.105');
  });

  it('rejects invalid and oversized waypoint sets before requesting a provider', async () => {
    const invalidSets = [[{ lat: Number.NaN, lon: 0 }], Array.from({ length: 21 }, (_, i) => ({ lat: 51.5 + i / 1000, lon: -0.1 }))];
    for (const waypoints of invalidSets) {
      const fail = () => { throw new Error('provider should not be called'); };
      for (const run of [fetchGoogleRoutes, fetchGoogleDrivingRoute]) {
        await assert.rejects(() => run(origin, destination, { apiKey: 'k', fetchImpl: fail as typeof fetch, avoid: { waypoints } }),
          (error: unknown) => error instanceof DirectionsProviderError && error.code === 'directions_invalid_request');
      }
    }
  });
});

describe('a stop on the way', () => {
  it('asks the Routes API to go through it, without alternatives, and rides its legs as one', async () => {
    let body: Record<string, unknown> = {};
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      body = JSON.parse(String(init!.body));
      return new Response(JSON.stringify({ routes: [{
        distanceMeters: 1200, duration: '200s', staticDuration: '200s', polyline: { encodedPolyline },
        legs: [{ steps: [routesStep()] }, { steps: [routesStep({ navigationInstruction: { maneuver: 'TURN_RIGHT', instructions: 'Turn right' } })] }],
      }] }), { status: 200 });
    }) as typeof fetch;
    const route = await fetchGoogleRoutes(origin, destination, { apiKey: 'k', fetchImpl, avoid: { via: { lat: 51.505, lon: -0.105 } } });
    assert.deepEqual(body.intermediates, [{ location: { latLng: { latitude: 51.505, longitude: -0.105 } } }]);
    assert.equal(body.computeAlternativeRoutes, false);
    assert.deepEqual(route.steps.map((step) => step.instruction), ['Turn slightly left onto A1', 'Turn right']);
  });

  it('asks the Directions API to stop there too, adding up its legs', async () => {
    let requested = '';
    const leg = (instruction: string) => ({
      distance: { value: 500 }, duration: { value: 60 },
      steps: [{ html_instructions: instruction, distance: { value: 500 }, duration: { value: 60 },
        start_location: { lat: 51.5, lng: -0.1 }, end_location: { lat: 51.51, lng: -0.11 }, polyline: { points: encodedPolyline } }],
    });
    const fetchImpl = (async (url: string | URL | Request) => {
      requested = String(url);
      return new Response(JSON.stringify({ status: 'OK', routes: [{ overview_polyline: { points: encodedPolyline }, legs: [leg('Head north'), leg('Turn left')] }] }), { status: 200 });
    }) as typeof fetch;
    const route = await fetchGoogleDrivingRoute(origin, destination, { apiKey: 'k', fetchImpl, avoid: { via: { lat: 51.505, lon: -0.105 } } });
    assert.match(requested, /waypoints=51\.505%2C-0\.105/);
    assert.equal(route.distanceMeters, 1000);
    assert.equal(route.durationSeconds, 120);
    assert.deepEqual(route.steps.map((step) => step.instruction), ['Head north', 'Turn left']);
  });
});
