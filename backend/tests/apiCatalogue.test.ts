import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { API_ENDPOINTS, apiPath, openApiDocument, requiresVerifiedEmail } from '../src/apiCatalogue.ts';
import { startTestServer } from './httpTestUtils.ts';
import type { TestServer } from './httpTestUtils.ts';

const ROUTES = fileURLToPath(new URL('../src/routes/', import.meta.url));

describe('API catalogue', () => {
  it('lists every literal route the handlers serve', () => {
    const listed = new Set(API_ENDPOINTS.map((endpoint) => `${endpoint.method} ${endpoint.path}`));
    const missing: string[] = [];
    for (const file of readdirSync(ROUTES).filter((name) => name.endsWith('.ts'))) {
      const source = readFileSync(`${ROUTES}${file}`, 'utf8');
      for (const match of source.matchAll(/req\.method === '([A-Z]+)' && url\.pathname === '([^']+)'/g)) {
        if (!listed.has(`${match[1]} ${match[2]}`)) missing.push(`${match[1]} ${match[2]} (${file})`);
      }
      for (const match of source.matchAll(/url\.pathname === '([^']+)' && req\.method === '([A-Z]+)'/g)) {
        if (!listed.has(`${match[2]} ${match[1]}`)) missing.push(`${match[2]} ${match[1]} (${file})`);
      }
    }
    assert.deepEqual(missing, []);
  });

  it('has no duplicates and gives staff endpoints their permission', () => {
    const keys = API_ENDPOINTS.map((endpoint) => `${endpoint.method} ${endpoint.path}`);
    assert.equal(new Set(keys).size, keys.length);
    for (const endpoint of API_ENDPOINTS.filter((candidate) => candidate.reauth)) assert.equal(endpoint.access, 'staff');
  });

  it('describes the API as OpenAPI 3.1, with access notes per operation', () => {
    const doc = openApiDocument('https://api.example.com/') as { openapi: string; servers: { url: string }[]; paths: Record<string, Record<string, { description: string; security?: unknown[]; parameters?: { name: string }[]; responses: Record<string, unknown>; 'x-permission'?: string }>> };
    assert.equal(doc.openapi, '3.1.0');
    assert.deepEqual(doc.servers.map((server) => server.url), ['https://api.example.com/', 'https://api.example.com/v1']);
    assert.deepEqual(doc.paths['/health']!.get!.security, []);
    assert.match(doc.paths['/messages']!.post!.description, /verified email/);
    assert.ok(doc.paths['/messages']!.post!.responses[403]);
    assert.match(doc.paths['/messages']!.get!.description, /^Signed in\./);
    const staff = doc.paths['/admin/staff/{riderId}/remove']!.post!;
    assert.equal(staff['x-permission'], 'manage_staff');
    assert.match(staff.description, /re-entered within 15 minutes/);
    assert.deepEqual(staff.parameters!.map((parameter) => parameter.name), ['riderId']);
    assert.equal((openApiDocument() as { servers?: unknown }).servers, undefined);
  });

  it('knows which posts need a verified email', () => {
    assert.equal(requiresVerifiedEmail('POST', '/messages'), true);
    assert.equal(requiresVerifiedEmail('POST', '/hazards/abc/confirm'), true);
    assert.equal(requiresVerifiedEmail('POST', '/social/posts/abc/report'), true);
    assert.equal(requiresVerifiedEmail('GET', '/messages'), false);
    assert.equal(requiresVerifiedEmail('POST', '/auth/logout'), false);
  });

  it('maps /v1 paths onto the API', () => {
    assert.equal(apiPath('/v1/rides/current'), '/rides/current');
    assert.equal(apiPath('/v1'), '/');
    assert.equal(apiPath('/v10/rides'), '/v10/rides');
    assert.equal(apiPath('/rides'), '/rides');
  });
});

describe('served API description and versioned paths', () => {
  let ctx: TestServer;
  before(async () => { ctx = startTestServer({ publicApiUrl: 'https://api.example.com' }); await ctx.ready; });
  after(async () => { await ctx.close(); });

  it('serves /openapi.json and answers under /v1', async () => {
    const doc = await (await fetch(`${ctx.baseUrl()}/openapi.json`)).json() as { info: { title: string }; servers: unknown[] };
    assert.equal(doc.info.title, 'Rider Comms API');
    assert.equal(doc.servers.length, 2);
    assert.equal((await fetch(`${ctx.baseUrl()}/v1/health`)).status, 200);
    assert.equal((await fetch(`${ctx.baseUrl()}/v1/openapi.json`)).status, 200);
    assert.equal((await fetch(`${ctx.baseUrl()}/v1/auth/me`)).status, 401);
  });
});
