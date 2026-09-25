import http from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import type { RouteCoordinate } from './directionsProvider.ts';
import type { RateLimitAction, RateLimitStore } from './rateLimitStore.ts';
import type { SocialRateAction, SocialRateLimitStore } from './socialRateLimitStore.ts';

const MAX_BODY_BYTES = 32 * 1024;

export class RequestError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function requestId(req: http.IncomingMessage, pattern: RegExp): string {
  const supplied = req.headers['x-request-id'];
  return typeof supplied === 'string' && pattern.test(supplied) ? supplied : randomUUID();
}

export function clientAddress(req: http.IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    const candidate = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
    if (candidate && isIP(candidate)) return candidate;
  }
  return req.socket.remoteAddress ?? 'unknown';
}

export function applyResponsePolicy(res: http.ServerResponse, id: string): void {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Request-ID', id);
}

export function applyCors(req: http.IncomingMessage, res: http.ServerResponse, allowedOrigins: ReadonlySet<string>): boolean {
  const origin = req.headers.origin;
  res.setHeader('Vary', 'Origin');
  if (!origin) return true;
  if (!allowedOrigins.has(origin)) return false;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Request-ID');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Expose-Headers', 'Retry-After, X-Request-ID');
  res.setHeader('Access-Control-Max-Age', '600');
  return true;
}

export function parseAllowedOrigins(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return [...new Set(raw.split(',').map((value) => value.trim()).filter(Boolean).map((value) => {
    const parsed = new URL(value);
    const localHttp = parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
    if (parsed.origin !== value || (parsed.protocol !== 'https:' && !localHttp)) {
      throw new Error(`Invalid CORS origin: ${value}`);
    }
    return parsed.origin;
  }))];
}

export function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
}

export function sendEmpty(res: http.ServerResponse, status: number): void {
  res.writeHead(status);
  res.end();
}

export function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let data = '', bytes = 0, tooLarge = false;
    req.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > MAX_BODY_BYTES) tooLarge = true; else data += chunk.toString('utf8'); });
    req.on('end', () => {
      if (tooLarge) return reject(new RequestError(413, 'request body is too large'));
      if (!data) return resolve({});
      try { const parsed: unknown = JSON.parse(data); if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new RequestError(400, 'request body must be a JSON object'); resolve(parsed as Record<string, unknown>); }
      catch (error) { reject(error instanceof RequestError ? error : new RequestError(400, 'invalid JSON')); }
    });
    req.on('error', reject);
  });
}

export function bearerToken(req: http.IncomingMessage): string {
  const header = req.headers.authorization;
  return header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

export function isCoordinate(lat: unknown, lon: unknown): boolean {
  return typeof lat === 'number' && Number.isFinite(lat) && lat >= -90 && lat <= 90
    && typeof lon === 'number' && Number.isFinite(lon) && lon >= -180 && lon <= 180;
}

export function routeCoordinate(value: unknown): RouteCoordinate | null {
  if (!value || Array.isArray(value) || typeof value !== 'object') return null;
  const candidate = value as { lat?: unknown; lon?: unknown };
  if (!isCoordinate(candidate.lat, candidate.lon)) return null;
  return { lat: candidate.lat as number, lon: candidate.lon as number };
}

export function rateLimitSubject(scope: 'ip' | 'rider', value: string): string {
  return createHash('sha256').update(`${scope}:${value}`).digest('hex');
}

export async function consumeRateLimit(
  res: http.ServerResponse,
  store: Pick<RateLimitStore, 'consume'>,
  subjectKey: string,
  action: RateLimitAction,
): Promise<boolean> {
  const result = await store.consume(subjectKey, action);
  if (result.allowed) return true;
  res.setHeader('Retry-After', String(result.retryAfterSeconds));
  sendJson(res, 429, { error: 'rate_limited' });
  return false;
}

export async function consumeSocialWrite(
  res: http.ServerResponse,
  store: Pick<SocialRateLimitStore, 'consume'>,
  actorId: string,
  action: SocialRateAction,
): Promise<boolean> {
  const result = await store.consume(actorId, action);
  if (result.allowed) return true;
  res.setHeader('Retry-After', String(result.retryAfterSeconds));
  sendJson(res, 429, { error: 'rate_limited' });
  return false;
}
