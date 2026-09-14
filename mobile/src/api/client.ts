/**
 * Thin HTTP client for the rider-comms backend. Deliberately framework-free
 * (just `fetch`) so it has no dependency on React Native being installed —
 * it can be unit-tested with Node's test runner alone (see tests/client.test.ts),
 * which is more than the rest of this mobile scaffold can claim in this
 * sandbox.
 */

export interface CreateRideResponse {
  rideId: string;
  code: string;
  expiresAt: number;
}

export interface JoinRideResponse {
  rideId: string;
}

export interface PresenceResponse {
  inZoneWith: string[];
  transitions: Array<{ a: string; b: string; type: 'entered' | 'left' }>;
}

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, body: unknown) {
    super(`API error ${status}: ${JSON.stringify(body)}`);
    this.status = status;
    this.body = body;
  }
}

export class RiderCommsClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(baseUrl: string, fetchImpl: typeof fetch = fetch) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.fetchImpl = fetchImpl;
  }

  private async postJson<T>(path: string, body: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) {
      throw new ApiError(res.status, json);
    }
    return json as T;
  }

  createRide(riderId: string): Promise<CreateRideResponse> {
    return this.postJson('/rides', { riderId });
  }

  joinRide(code: string, riderId: string): Promise<JoinRideResponse> {
    return this.postJson('/rides/join', { code, riderId });
  }

  updatePresence(
    riderId: string,
    lat: number,
    lon: number,
    radiusMiles: number
  ): Promise<PresenceResponse> {
    return this.postJson('/presence', { riderId, lat, lon, radiusMiles });
  }
}
