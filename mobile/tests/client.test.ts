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

describe('RiderCommsClient authentication', () => {
  it('signs up and logs in without sending a client-controlled rider ID', async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    const client = new RiderCommsClient(
      'http://example.test',
      fakeFetch((url, init) => {
        requests.push({ url, body: JSON.parse(init.body as string) });
        if (url.endsWith('/auth/signup')) return { status: 201, body: { riderId: 'rider_abc23456', token: 'signup-token', emailVerified: false, emailVerificationSent: true } };
        return { status: 200, body: { riderId: 'rider_abc23456', token: 'login-token', emailVerified: false } };
      })
    );

    assert.equal((await client.signUp('alex_rides', 'alex@example.com', 'secure-password')).token, 'signup-token');
    assert.equal((await client.logIn('alex_rides', 'secure-password')).token, 'login-token');
    assert.deepEqual(requests, [
      { url: 'http://example.test/auth/signup', body: { username: 'alex_rides', email: 'alex@example.com', password: 'secure-password', deviceName: 'Rider Comms mobile' } },
      { url: 'http://example.test/auth/login', body: { username: 'alex_rides', password: 'secure-password', deviceName: 'Rider Comms mobile' } },
    ]);
  });

  it('lists and revokes account sessions', async () => {
    const requests: Array<{ url: string; method: string }> = [];
    const client = new RiderCommsClient('http://example.test', fakeFetch((url, init) => {
      requests.push({ url, method: init.method ?? 'GET' });
      if (init.method === 'DELETE') return { status: 204, body: {} };
      return { status: 200, body: { sessions: [{ id: 'session-1', deviceName: 'Phone', current: true }] } };
    }), 'token');
    assert.equal((await client.getSessions()).sessions[0].current, true);
    await client.revokeSession('session/2');
    assert.deepEqual(requests, [
      { url: 'http://example.test/auth/sessions', method: 'GET' },
      { url: 'http://example.test/auth/sessions/session%2F2', method: 'DELETE' },
    ]);
  });

  it('revokes the authenticated session on logout', async () => {
    const client = new RiderCommsClient(
      'http://example.test',
      fakeFetch((url, init) => {
        assert.equal(url, 'http://example.test/auth/logout');
        assert.equal(init.method, 'POST');
        assert.equal((init.headers as Record<string, string>).Authorization, 'Bearer session-token');
        return { status: 204, body: {} };
      }),
      'session-token'
    );
    await client.logOut();
  });

  it('requests and confirms password recovery without authentication', async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    const client = new RiderCommsClient('http://example.test', fakeFetch((url, init) => {
      requests.push({ url, body: JSON.parse(init.body as string) });
      return url.endsWith('/request')
        ? { status: 202, body: { accepted: true } }
        : { status: 200, body: { reset: true } };
    }));
    assert.deepEqual(await client.requestPasswordReset('rider@example.com'), { accepted: true });
    assert.deepEqual(await client.resetPassword('reset-token', 'new-password'), { reset: true });
    assert.deepEqual(requests, [
      { url: 'http://example.test/auth/password-reset/request', body: { email: 'rider@example.com' } },
      { url: 'http://example.test/auth/password-reset/confirm', body: { token: 'reset-token', password: 'new-password' } },
    ]);
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
  it('sends coordinate evidence and returns inZoneWith + transitions', async () => {
    const client = new RiderCommsClient(
      'http://example.test',
      fakeFetch((url, init) => {
        assert.equal(url, 'http://example.test/presence');
        assert.deepEqual(JSON.parse(init.body as string), {
          lat: 40.0,
          lon: -105.0,
          accuracyMeters: 8,
          recordedAt: 1_700_000_000_000,
        });
        return {
          status: 200,
          body: { inZoneWith: ['friend'], transitions: [{ a: 'ali', b: 'friend', type: 'entered' }] },
        };
      })
    );

    const result = await client.updatePresence(40.0, -105.0, 8, 1_700_000_000_000);
    assert.deepEqual(result.inZoneWith, ['friend']);
    assert.equal(result.transitions[0].type, 'entered');
  });
});

describe('RiderCommsClient social profiles and messages', () => {
  it('loads a privacy-filtered public profile from the public profile route', async () => {
    const client = new RiderCommsClient(
      'http://example.test',
      fakeFetch((url, init) => {
        assert.equal(url, 'http://example.test/profiles/rider%2Ffriend');
        assert.equal(init.method, 'GET');
        return {
          status: 200,
          body: {
            riderId: 'rider/friend',
            displayName: 'Sam',
            handle: '@sam',
            avatarId: 'roadster',
            instagramUsername: '',
            tiktokUsername: '',
          },
        };
      })
    );

    assert.equal((await client.getPublicProfile('rider/friend')).handle, '@sam');
  });

  it('sends a private message only to the requested rider', async () => {
    const client = new RiderCommsClient(
      'http://example.test',
      fakeFetch((url, init) => {
        assert.equal(url, 'http://example.test/messages');
        assert.equal(init.method, 'POST');
        assert.deepEqual(JSON.parse(init.body as string), { toRiderId: 'friend-1', text: 'Meet at seven?' });
        return { status: 201, body: { id: 'm1', fromRiderId: 'me', toRiderId: 'friend-1', text: 'Meet at seven?', createdAt: 1 } };
      })
    );

    assert.equal((await client.sendMessage('friend-1', 'Meet at seven?')).id, 'm1');
  });

  it('persists an editable profile field through the authenticated rider route', async () => {
    const client = new RiderCommsClient(
      'http://example.test',
      fakeFetch((url, init) => {
        assert.equal(url, 'http://example.test/riders/rider%2Fme/profile');
        assert.equal(init.method, 'PUT');
        assert.deepEqual(JSON.parse(init.body as string), { handle: '@night_rider' });
        return { status: 200, body: { riderId: 'rider/me', handle: '@night_rider' } };
      })
    );

    assert.equal((await client.updateProfile('rider/me', { handle: '@night_rider' })).handle, '@night_rider');
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

describe('RiderCommsClient.voice', () => {
  it('getRideVoiceToken POSTs the ride target and id', async () => {
    const client = new RiderCommsClient(
      'http://example.test',
      fakeFetch((url, init) => {
        assert.equal(url, 'http://example.test/voice/token');
        assert.deepEqual(JSON.parse(init.body as string), { target: 'ride', rideId: 'ride1' });
        return { status: 200, body: { token: 'a.b.c', url: 'wss://example.livekit.cloud' } };
      })
    );
    const result = await client.getRideVoiceToken('ride1');
    assert.equal(result.token, 'a.b.c');
    assert.equal(result.url, 'wss://example.livekit.cloud');
  });

  it('getChannelVoiceToken POSTs the channel target with no id', async () => {
    const client = new RiderCommsClient(
      'http://example.test',
      fakeFetch((url, init) => {
        assert.equal(url, 'http://example.test/voice/token');
        assert.deepEqual(JSON.parse(init.body as string), { target: 'channel' });
        return { status: 200, body: { token: 'x.y.z', url: 'wss://example.livekit.cloud' } };
      })
    );
    const result = await client.getChannelVoiceToken();
    assert.equal(result.token, 'x.y.z');
  });
});
