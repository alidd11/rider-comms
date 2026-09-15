import type http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/server.ts';
import type { ApiServerOptions } from '../src/server.ts';
import { AuthStore } from '../src/authStore.ts';
import { ProfileStore } from '../src/profileStore.ts';
import { FriendStore } from '../src/friendStore.ts';
export interface TestServer { baseUrl: () => string; close: () => Promise<void>; authStore: AuthStore; profileStore: ProfileStore; friendStore: FriendStore; ready: Promise<void> }
export function startTestServer(options: ApiServerOptions = {}): TestServer { const authStore = new AuthStore(); const profileStore = new ProfileStore(); const friendStore = new FriendStore(profileStore); const server: http.Server = createApp(undefined, undefined, profileStore, friendStore, undefined, undefined, authStore, undefined, undefined, undefined, options); let base = ''; const ready = new Promise<void>((resolve) => server.listen(0, () => { base = `http://localhost:${(server.address() as AddressInfo).port}`; resolve(); })); return { baseUrl: () => base, close: () => new Promise((resolve) => server.close(() => resolve())), authStore, profileStore, friendStore, ready }; }
export function authenticatedFetch(ctx: TestServer, riderId: string, path: string, init: RequestInit = {}): Promise<Response> { const { token } = ctx.authStore.createTestSession(riderId); const headers = { ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}), Authorization: `Bearer ${token}`, ...(init.headers as Record<string, string> | undefined) }; return fetch(`${ctx.baseUrl()}${path}`, { ...init, headers }); }
export function postJson(ctx: TestServer, riderId: string, path: string, body: unknown): Promise<Response> { return authenticatedFetch(ctx, riderId, path, { method: 'POST', body: JSON.stringify(body) }); }
