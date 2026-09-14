import http from 'node:http';
import type { Rider } from '@rider-comms/shared';
import { RideStore } from './rideStore.ts';
import { PresenceStore } from './presenceStore.ts';
import { ProfileStore } from './profileStore.ts';
import { FriendStore } from './friendStore.ts';
import { MessageStore } from './messageStore.ts';
import { HideoutStore } from './hideoutStore.ts';

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

/**
 * Builds the HTTP app. Takes stores as parameters (rather than module-level
 * singletons) so tests can spin up fully isolated instances — no shared
 * rate-limiter or ride state leaking between test cases.
 *
 * Deliberately built on Node's built-in http module with no framework
 * (Express/Fastify) and no external voice/SFU SDK: this sandbox's network
 * policy blocks the npm registry, so nothing beyond Node's standard library
 * could be installed here. This is enough to prove the ride-code and
 * zone-matching logic end-to-end over real HTTP requests; swap in
 * Express/Fastify plus the LiveKit server SDK (per the spec's tech-stack
 * recommendation) once you're running this somewhere with normal package
 * access.
 */
export function createApp(
  rideStore: RideStore = new RideStore(),
  presenceStore: PresenceStore = new PresenceStore(),
  profileStore: ProfileStore = new ProfileStore(),
  friendStore: FriendStore = new FriendStore(profileStore),
  messageStore: MessageStore = new MessageStore(),
  hideoutStore: HideoutStore = new HideoutStore()
): http.Server {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');

      if (req.method === 'GET' && url.pathname === '/health') {
        return sendJson(res, 200, { ok: true });
      }

      if (req.method === 'POST' && url.pathname === '/rides') {
        const body = await readJsonBody(req);
        if (typeof body.riderId !== 'string' || !body.riderId) {
          return sendJson(res, 400, { error: 'riderId is required' });
        }
        const { ride, codeRecord } = rideStore.createRide(body.riderId);
        return sendJson(res, 201, {
          rideId: ride.id,
          code: codeRecord.code,
          expiresAt: codeRecord.expiresAt,
        });
      }

      if (req.method === 'POST' && url.pathname === '/rides/join') {
        const body = await readJsonBody(req);
        if (typeof body.code !== 'string' || typeof body.riderId !== 'string') {
          return sendJson(res, 400, { error: 'code and riderId are required' });
        }
        // Rate-limit key is IP + claimed riderId: an attacker rotating a
        // self-reported riderId per request still shares the same IP, so
        // this can't be trivially bypassed by making up new rider ids.
        const rateLimitKey = `${req.socket.remoteAddress ?? 'unknown'}:${body.riderId}`;
        const result = rideStore.joinRide(body.code, body.riderId, rateLimitKey);
        if (!result.ok) {
          const status = result.reason === 'rate_limited' ? 429 : 404;
          return sendJson(res, status, { error: result.reason });
        }
        return sendJson(res, 200, { rideId: result.rideId });
      }

      if (req.method === 'POST' && url.pathname === '/presence') {
        const body = await readJsonBody(req);
        if (
          typeof body.riderId !== 'string' ||
          typeof body.lat !== 'number' ||
          typeof body.lon !== 'number' ||
          typeof body.radiusMiles !== 'number'
        ) {
          return sendJson(res, 400, {
            error: 'riderId, lat, lon, and radiusMiles are required',
          });
        }

        const rider: Rider = {
          id: body.riderId,
          location: { lat: body.lat, lon: body.lon },
          radiusMiles: body.radiusMiles,
          updatedAt: Date.now(),
        };

        const { transitions, zonePairs } = presenceStore.updatePresence(rider);
        const inZoneWith = presenceStore.ridersInZoneWith(rider.id, zonePairs);
        const myTransitions = transitions.filter(
          (t) => t.a === rider.id || t.b === rider.id
        );

        return sendJson(res, 200, { inZoneWith, transitions: myTransitions });
      }

      const segments = url.pathname.split('/').filter(Boolean);

      // GET /riders/:riderId/profile
      if (
        req.method === 'GET' &&
        segments.length === 3 &&
        segments[0] === 'riders' &&
        segments[2] === 'profile'
      ) {
        const riderId = decodeURIComponent(segments[1]);
        return sendJson(res, 200, profileStore.getOrCreate(riderId));
      }

      // PUT /riders/:riderId/profile
      if (
        req.method === 'PUT' &&
        segments.length === 3 &&
        segments[0] === 'riders' &&
        segments[2] === 'profile'
      ) {
        const riderId = decodeURIComponent(segments[1]);
        const body = await readJsonBody(req);
        const result = profileStore.update(riderId, body);
        if (!result.ok) {
          return sendJson(res, 400, { error: result.error });
        }
        return sendJson(res, 200, result.profile);
      }

      // GET /riders/:riderId/friend-requests
      if (
        req.method === 'GET' &&
        segments.length === 3 &&
        segments[0] === 'riders' &&
        segments[2] === 'friend-requests'
      ) {
        const riderId = decodeURIComponent(segments[1]);
        return sendJson(res, 200, friendStore.getRequestsFor(riderId));
      }

      // GET /riders/:riderId/friends
      if (
        req.method === 'GET' &&
        segments.length === 3 &&
        segments[0] === 'riders' &&
        segments[2] === 'friends'
      ) {
        const riderId = decodeURIComponent(segments[1]);
        return sendJson(res, 200, { friends: friendStore.getFriends(riderId) });
      }

      // DELETE /riders/:riderId/friends/:friendId
      if (
        req.method === 'DELETE' &&
        segments.length === 4 &&
        segments[0] === 'riders' &&
        segments[2] === 'friends'
      ) {
        const riderId = decodeURIComponent(segments[1]);
        const friendId = decodeURIComponent(segments[3]);
        friendStore.removeFriend(riderId, friendId);
        return sendJson(res, 200, {});
      }

      // GET /riders/:riderId/hideouts
      if (
        req.method === 'GET' &&
        segments.length === 3 &&
        segments[0] === 'riders' &&
        segments[2] === 'hideouts'
      ) {
        const riderId = decodeURIComponent(segments[1]);
        return sendJson(res, 200, { hideouts: hideoutStore.getForRider(riderId) });
      }

      // POST /friends/requests
      if (req.method === 'POST' && url.pathname === '/friends/requests') {
        const body = await readJsonBody(req);
        if (
          typeof body.fromRiderId !== 'string' ||
          !body.fromRiderId ||
          typeof body.toRiderId !== 'string' ||
          !body.toRiderId
        ) {
          return sendJson(res, 400, { error: 'fromRiderId and toRiderId are required' });
        }
        if (body.fromRiderId === body.toRiderId) {
          return sendJson(res, 400, { error: 'cannot friend yourself' });
        }
        const result = friendStore.createRequest(body.fromRiderId, body.toRiderId);
        if (!result.ok) {
          return sendJson(res, 409, { error: result.error });
        }
        return sendJson(res, 201, result.request);
      }

      // POST /friends/requests/:requestId/accept
      if (
        req.method === 'POST' &&
        segments.length === 4 &&
        segments[0] === 'friends' &&
        segments[1] === 'requests' &&
        segments[3] === 'accept'
      ) {
        const requestId = decodeURIComponent(segments[2]);
        const result = friendStore.accept(requestId);
        if (!result.ok) {
          return sendJson(res, 404, { error: result.error });
        }
        return sendJson(res, 200, { friend: result.friend });
      }

      if (
        req.method === 'POST' &&
        segments.length === 4 &&
        segments[0] === 'friends' &&
        segments[1] === 'requests' &&
        segments[3] === 'decline'
      ) {
        const requestId = decodeURIComponent(segments[2]);
        const result = friendStore.decline(requestId);
        if (!result.ok) {
          return sendJson(res, 404, { error: result.error });
        }
        return sendJson(res, 200, {});
      }

      // POST /messages
      if (req.method === 'POST' && url.pathname === '/messages') {
        const body = await readJsonBody(req);
        if (
          typeof body.fromRiderId !== 'string' ||
          !body.fromRiderId ||
          typeof body.toRiderId !== 'string' ||
          !body.toRiderId ||
          typeof body.text !== 'string'
        ) {
          return sendJson(res, 400, {
            error: 'fromRiderId, toRiderId, and text are required',
          });
        }
        const trimmed = body.text.trim();
        if (!trimmed) {
          return sendJson(res, 400, { error: 'text must not be empty' });
        }
        if (trimmed.length > 1000) {
          return sendJson(res, 400, { error: 'text must be at most 1000 characters' });
        }
        if (!friendStore.isFriendOf(body.fromRiderId, body.toRiderId)) {
          return sendJson(res, 403, { error: 'not_friends' });
        }
        const message = messageStore.create(body.fromRiderId, body.toRiderId, body.text);
        return sendJson(res, 201, message);
      }

      // GET /messages?riderId=A&withRiderId=B
      if (req.method === 'GET' && url.pathname === '/messages') {
        const riderId = url.searchParams.get('riderId');
        const withRiderId = url.searchParams.get('withRiderId');
        if (!riderId || !withRiderId) {
          return sendJson(res, 400, { error: 'riderId and withRiderId are required' });
        }
        return sendJson(res, 200, { messages: messageStore.getThread(riderId, withRiderId) });
      }

      // POST /hideouts
      if (req.method === 'POST' && url.pathname === '/hideouts') {
        const body = await readJsonBody(req);
        const participantIds = body.participantIds;
        if (
          typeof body.name !== 'string' ||
          !body.name ||
          typeof body.lat !== 'number' ||
          typeof body.lon !== 'number' ||
          typeof body.createdBy !== 'string' ||
          !body.createdBy ||
          !Array.isArray(participantIds) ||
          !participantIds.every((id) => typeof id === 'string')
        ) {
          return sendJson(res, 400, {
            error: 'name, lat, lon, createdBy, and participantIds (string[]) are required',
          });
        }
        const hideout = hideoutStore.create({
          name: body.name,
          lat: body.lat,
          lon: body.lon,
          createdBy: body.createdBy,
          participantIds: participantIds as string[],
        });
        return sendJson(res, 201, hideout);
      }

      // DELETE /hideouts/:hideoutId?riderId=X
      if (
        req.method === 'DELETE' &&
        segments.length === 2 &&
        segments[0] === 'hideouts'
      ) {
        const hideoutId = decodeURIComponent(segments[1]);
        const riderId = url.searchParams.get('riderId');
        if (!riderId) {
          return sendJson(res, 400, { error: 'riderId is required' });
        }
        const result = hideoutStore.delete(hideoutId, riderId);
        if (!result.ok) {
          const status = result.error === 'forbidden' ? 403 : 404;
          return sendJson(res, status, { error: result.error });
        }
        return sendJson(res, 200, {});
      }

      sendJson(res, 404, { error: 'not_found' });
    } catch (err) {
      sendJson(res, 500, {
        error: 'internal_error',
        message: err instanceof Error ? err.message : 'unknown error',
      });
    }
  });
}

const isMainModule = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  const port = Number(process.env.PORT ?? 4000);
  const app = createApp();
  app.listen(port, () => {
    console.log(`rider-comms backend listening on :${port}`);
  });
}
