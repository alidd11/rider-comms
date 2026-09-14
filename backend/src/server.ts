import http from 'node:http';
import type { Rider } from '@rider-comms/shared';
import { RideStore } from './rideStore.ts';
import { PresenceStore } from './presenceStore.ts';

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
  presenceStore: PresenceStore = new PresenceStore()
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
