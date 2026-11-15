import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getPool } from '../src/db.ts';
import { SocialMediaProcessingError } from '../src/socialMediaProcessor.ts';
import type { SocialMediaService } from '../src/socialMediaService.ts';
import { encodeSocialCursor, MAX_POST_CAPTION, REPORTS_TO_HIDE, SocialPostStore, UNATTACHED_MEDIA_TTL_MS } from '../src/socialPostStore.ts';
import { AccountDeletionStore } from '../src/accountDeletionStore.ts';
import { authenticatedFetch, clearSharedTestState, postJson, startTestServer } from './httpTestUtils.ts';
import type { TestServer } from './httpTestUtils.ts';

// Postgres-backed: skipped without DATABASE_URL, like the other store suites.
const hasDatabase = Boolean(process.env.DATABASE_URL);

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1]);
const MP4 = Buffer.from([0, 0, 0, 24, ...Buffer.from('ftypisom'), 0, 0, 2, 0, ...Buffer.from('isomiso2')]);

/** Storage in memory, processors that echo a recognisable result. */
function fakeMedia() {
  const objects = new Map<string, { bytes: Buffer; mime: string }>();
  const state = { failPut: false, failGet: false, imageError: null as SocialMediaProcessingError | null, videoError: null as SocialMediaProcessingError | null, videoContainers: [] as string[] };
  const service: SocialMediaService = {
    urlSecret: Buffer.alloc(32, 3),
    storage: {
      async putProcessed(key, bytes, mime) {
        if (state.failPut) throw new Error('social_media_storage_unavailable');
        objects.set(key, { bytes: Buffer.from(bytes), mime });
      },
      async getProcessed(key, range) {
        if (state.failGet) throw new Error('social_media_storage_unavailable');
        const object = objects.get(key);
        if (!object) throw new Error('social_media_not_found');
        if (range) {
          const [, from, to] = /bytes=(\d+)-(\d*)/.exec(range) ?? [];
          const end = to ? Number(to) : object.bytes.length - 1;
          return new Response(object.bytes.subarray(Number(from), end + 1), {
            status: 206, headers: { 'content-range': `bytes ${from}-${end}/${object.bytes.length}`, 'content-length': String(end - Number(from) + 1) },
          });
        }
        return new Response(object.bytes, { status: 200, headers: { 'content-length': String(object.bytes.length) } });
      },
      async deleteProcessed(key) { objects.delete(key); },
    },
    async processImage() {
      if (state.imageError) throw state.imageError;
      return { bytes: Buffer.from('processed-photo'), width: 1600, height: 1200 };
    },
    async processVideo(_path, container) {
      state.videoContainers.push(container);
      if (state.videoError) throw state.videoError;
      return { bytes: Buffer.from('processed-video-0123456789'), poster: Buffer.from('poster'), width: 720, height: 1280, durationMs: 12_000 };
    },
  };
  return { service, objects, state };
}

async function upload(ctx: TestServer, riderId: string, bytes: Buffer, type: string, headers: Record<string, string> = {}): Promise<Response> {
  return authenticatedFetch(ctx, riderId, '/social/media', { method: 'POST', body: bytes, headers: { 'Content-Type': type, ...headers } });
}

async function photoPost(ctx: TestServer, riderId: string, caption = 'Sunday roads'): Promise<{ id: string; media: Array<{ id: string; url: string; posterUrl: string | null }> }> {
  const media = await (await upload(ctx, riderId, JPEG, 'image/jpeg')).json() as { media: { id: string } };
  const res = await postJson(ctx, riderId, '/social/posts', { kind: 'photo', caption, mediaIds: [media.media.id] });
  assert.equal(res.status, 201);
  return (await res.json() as { post: { id: string; media: Array<{ id: string; url: string; posterUrl: string | null }> } }).post;
}

async function feed(ctx: TestServer, riderId: string, query = 'scope=for-you'): Promise<{ posts: Array<{ id: string; authorId: string; hidden: boolean }>; nextCursor: string | null }> {
  const res = await authenticatedFetch(ctx, riderId, `/social/feed?${query}`);
  assert.equal(res.status, 200);
  return res.json() as Promise<{ posts: Array<{ id: string; authorId: string; hidden: boolean }>; nextCursor: string | null }>;
}

async function resetSocial(): Promise<void> {
  await clearSharedTestState();
  await getPool().query(`DELETE FROM social_post_reports; DELETE FROM social_post_media; DELETE FROM social_posts;
    DELETE FROM social_media; DELETE FROM social_media_delete_outbox; DELETE FROM safety_reports;
    DELETE FROM moderation_actions WHERE moderator_id LIKE 'social_%';
    DELETE FROM users WHERE id LIKE 'social_%'`);
}

describe('Rider Social posts', { skip: !hasDatabase && 'DATABASE_URL not set; skipping Postgres-backed Social post tests' }, () => {
  let ctx: TestServer;
  let media: ReturnType<typeof fakeMedia>;
  before(async () => {
    media = fakeMedia();
    ctx = startTestServer({ socialOpenBetaEnabled: true, socialMedia: media.service });
    await ctx.ready;
  });
  after(() => ctx.close());
  beforeEach(async () => {
    await resetSocial();
    media.objects.clear();
    Object.assign(media.state, { failPut: false, failGet: false, imageError: null, videoError: null, videoContainers: [] });
  });

  it('switches uploads and posting on once storage is configured', async () => {
    const res = await authenticatedFetch(ctx, 'social_a', '/social/bootstrap');
    const body = await res.json() as { capabilities: Record<string, boolean> };
    assert.deepEqual(body.capabilities, {
      mediaUpload: true, privatePosting: false, publicPosting: true, liveStreaming: false, marketplaceCheckout: false, creatorPayouts: false,
    });
  });

  it('processes a photo upload, stores only the processed file, and posts it', async () => {
    const res = await upload(ctx, 'social_a', JPEG, 'image/jpeg');
    assert.equal(res.status, 201);
    const { media: uploaded } = await res.json() as { media: { id: string; kind: string; width: number } };
    assert.deepEqual({ kind: uploaded.kind, width: uploaded.width }, { kind: 'image', width: 1600 });
    assert.equal([...media.objects.values()][0]?.bytes.toString(), 'processed-photo');
    assert.match([...media.objects.keys()][0] ?? '', /^social\/processed\/[0-9a-f-]{36}\.jpg$/);
    const post = await postJson(ctx, 'social_a', '/social/posts', { kind: 'photo', caption: '  Box Hill at dawn  ', mediaIds: [uploaded.id] });
    assert.equal(post.status, 201);
    const created = await post.json() as { post: { caption: string; kind: string; authorId: string; media: Array<{ url: string; posterUrl: null }> } };
    assert.equal(created.post.caption, 'Box Hill at dawn');
    assert.equal(created.post.authorId, 'social_a');
    assert.match(created.post.media[0]!.url, /^\/social\/media\/[0-9a-f-]{36}\/file\?v=social_a&exp=\d+&sig=/);
    assert.equal(created.post.media[0]!.posterUrl, null);
    // An upload can only be used once.
    const again = await postJson(ctx, 'social_a', '/social/posts', { kind: 'photo', caption: '', mediaIds: [uploaded.id] });
    assert.equal(again.status, 404);
  });

  it('processes a Reel with its poster, choosing the demuxer from the declared type', async () => {
    for (const [type, container] of [['video/mp4', 'mov'], ['video/quicktime', 'mov'], ['video/webm', 'matroska']] as const) {
      const bytes = type === 'video/webm' ? Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4]) : MP4;
      const res = await upload(ctx, 'social_a', bytes, type);
      assert.equal(res.status, 201, type);
      assert.equal(media.state.videoContainers.at(-1), container);
      const { media: video } = await res.json() as { media: { id: string; durationMs: number } };
      assert.equal(video.durationMs, 12_000);
      if (type === 'video/mp4') {
        const reel = await postJson(ctx, 'social_a', '/social/posts', { kind: 'reel', caption: 'Twisties', mediaIds: [video.id] });
        assert.equal(reel.status, 201);
        const body = await reel.json() as { post: { media: Array<{ posterUrl: string }> } };
        assert.match(body.post.media[0]!.posterUrl, /\/poster\?/);
      }
    }
    assert.equal(media.objects.size, 6);
  });

  it('refuses unsupported, mislabelled, oversized and unprocessable uploads', async () => {
    assert.equal((await upload(ctx, 'social_a', JPEG, 'image/gif')).status, 415);
    assert.equal((await upload(ctx, 'social_a', MP4, 'image/jpeg')).status, 415);
    assert.equal((await upload(ctx, 'social_a', Buffer.alloc(0), 'image/jpeg')).status, 413);
    const big = await authenticatedFetch(ctx, 'social_a', '/social/media', {
      method: 'POST', body: JPEG, headers: { 'Content-Type': 'image/jpeg', 'Content-Length': String(21 * 1024 * 1024) },
    }).catch(() => null);
    assert.ok(!big || big.status === 413);
    media.state.imageError = new SocialMediaProcessingError('invalid_media');
    const bad = await upload(ctx, 'social_a', JPEG, 'image/jpeg');
    assert.deepEqual([bad.status, await bad.json()], [422, { error: 'invalid_media' }]);
    for (const [code, status] of [['media_too_long', 422], ['media_busy', 503], ['media_processing_failed', 500]] as const) {
      media.state.videoError = new SocialMediaProcessingError(code);
      const res = await upload(ctx, 'social_a', MP4, 'video/mp4');
      assert.deepEqual([res.status, await res.json()], [status, { error: code }]);
    }
    media.state.imageError = null;
    media.state.failPut = true;
    const down = await upload(ctx, 'social_a', JPEG, 'image/jpeg');
    assert.deepEqual([down.status, await down.json()], [502, { error: 'media_storage_unavailable' }]);
  });

  it('checks a post’s shape: kind, caption, its own unused media, photos or one video', async () => {
    const photo = (await (await upload(ctx, 'social_a', JPEG, 'image/jpeg')).json() as { media: { id: string } }).media.id;
    const video = (await (await upload(ctx, 'social_a', MP4, 'video/mp4')).json() as { media: { id: string } }).media.id;
    const post = (body: unknown, rider = 'social_a') => postJson(ctx, rider, '/social/posts', body);
    assert.equal((await post({ kind: 'story', mediaIds: [photo] })).status, 400);
    assert.equal((await post({ kind: 'photo', caption: 'x'.repeat(MAX_POST_CAPTION + 1), mediaIds: [photo] })).status, 400);
    assert.equal((await post({ kind: 'photo', mediaIds: [] })).status, 400);
    assert.equal((await post({ kind: 'photo', mediaIds: ['nope'] })).status, 400);
    assert.equal((await post({ kind: 'photo', mediaIds: [photo, photo] })).status, 400);
    assert.equal((await post({ kind: 'photo', mediaIds: [video] })).status, 400);
    assert.equal((await post({ kind: 'reel', mediaIds: [photo] })).status, 400);
    assert.equal((await post({ kind: 'reel', mediaIds: [video, photo] })).status, 400);
    assert.equal((await post({ kind: 'photo', mediaIds: [photo] }, 'social_b')).status, 404);
    const filtered = await post({ kind: 'photo', caption: 'Heil Hitler', mediaIds: [photo] });
    assert.deepEqual([filtered.status, await filtered.json()], [400, { error: 'objectionable_content' }]);
  });

  it('serves feeds newest first, with Following limited to friends, and pages through them', async () => {
    await getPool().query(`INSERT INTO friendships (rider_id, friend_id, created_at) VALUES ('social_a', 'social_b', 0), ('social_b', 'social_a', 0)`);
    const first = await photoPost(ctx, 'social_b', 'one');
    const second = await photoPost(ctx, 'social_c', 'two');
    const reelUpload = (await (await upload(ctx, 'social_c', MP4, 'video/mp4')).json() as { media: { id: string } }).media.id;
    const reel = await (await postJson(ctx, 'social_c', '/social/posts', { kind: 'reel', mediaIds: [reelUpload] })).json() as { post: { id: string } };
    assert.deepEqual((await feed(ctx, 'social_a')).posts.map((p) => p.id), [reel.post.id, second.id, first.id]);
    assert.deepEqual((await feed(ctx, 'social_a', 'scope=following')).posts.map((p) => p.id), [first.id]);
    assert.deepEqual((await feed(ctx, 'social_a', 'scope=reels')).posts.map((p) => p.id), [reel.post.id]);
    const page = await feed(ctx, 'social_a', 'scope=for-you&limit=2');
    assert.equal(page.posts.length, 2);
    const next = await feed(ctx, 'social_a', `scope=for-you&limit=2&cursor=${page.nextCursor}`);
    assert.deepEqual(next.posts.map((p) => p.id), [first.id]);
    assert.equal(next.nextCursor, null);
    const byRider = await authenticatedFetch(ctx, 'social_a', '/social/riders/social_c/posts');
    assert.deepEqual((await byRider.json() as { posts: Array<{ id: string }> }).posts.map((p) => p.id), [reel.post.id, second.id]);
    for (const query of ['scope=author', 'scope=everything', 'limit=0', 'limit=31', 'cursor=bad', `cursor=${Buffer.from('1:not-a-uuid').toString('base64url')}`]) {
      assert.equal((await authenticatedFetch(ctx, 'social_a', `/social/feed?${query}`)).status, 400, query);
    }
    assert.ok(encodeSocialCursor({ createdAt: 1, id: first.id }));
  });

  it('reads, and lets only the author delete, a post, queueing its files for deletion', async () => {
    const post = await photoPost(ctx, 'social_a');
    assert.equal((await authenticatedFetch(ctx, 'social_b', `/social/posts/${post.id}`)).status, 200);
    assert.equal((await authenticatedFetch(ctx, 'social_b', '/social/posts/not-a-uuid')).status, 404);
    assert.equal((await authenticatedFetch(ctx, 'social_b', `/social/posts/${post.id}`, { method: 'DELETE' })).status, 404);
    assert.equal((await authenticatedFetch(ctx, 'social_a', `/social/posts/${post.id}`, { method: 'DELETE' })).status, 204);
    assert.equal((await authenticatedFetch(ctx, 'social_b', `/social/posts/${post.id}`)).status, 404);
    const queued = await getPool().query('SELECT object_key FROM social_media_delete_outbox');
    assert.equal(queued.rows.length, 1);
  });

  it('hides blocked riders both ways and posts a rider reported, and hides a post after enough reports', async () => {
    const post = await photoPost(ctx, 'social_a');
    await getPool().query(`INSERT INTO rider_blocks (rider_id, blocked_rider_id, created_at) VALUES ('social_b', 'social_a', 0)`);
    assert.deepEqual((await feed(ctx, 'social_b')).posts, []);
    await getPool().query(`DELETE FROM rider_blocks; INSERT INTO rider_blocks (rider_id, blocked_rider_id, created_at) VALUES ('social_a', 'social_b', 0)`);
    assert.deepEqual((await feed(ctx, 'social_b')).posts, []);
    await getPool().query('DELETE FROM rider_blocks');

    const report = (rider: string, body: unknown = { reason: 'spam', details: 'selling things' }) =>
      postJson(ctx, rider, `/social/posts/${post.id}/report`, body);
    assert.equal((await report('social_b', { reason: 'nope' })).status, 400);
    assert.equal((await report('social_a')).status, 404, 'no reporting your own post');
    assert.equal((await report('social_b')).status, 202);
    assert.deepEqual((await feed(ctx, 'social_b')).posts, [], 'the reporter stops seeing it');
    assert.equal((await report('social_b')).status, 404);
    const queue = await getPool().query(`SELECT details FROM safety_reports WHERE reporter_id = 'social_b'`);
    assert.match(String(queue.rows[0]?.details), new RegExp(`Rider Social post ${post.id}: selling things`));
    for (let i = 1; i < REPORTS_TO_HIDE; i += 1) assert.equal((await report(`social_r${i}`, { reason: 'other' })).status, 202);
    assert.deepEqual((await feed(ctx, 'social_c')).posts, [], 'hidden for everyone else');
    const own = await feed(ctx, 'social_a');
    assert.deepEqual(own.posts.map((p) => [p.id, p.hidden]), [[post.id, true]], 'its author still sees it, marked hidden');
  });

  it('leaves out posts by suspended riders', async () => {
    await photoPost(ctx, 'social_a');
    await getPool().query(`INSERT INTO users (id, username, password_hash, suspended_at) VALUES ('social_a', 'social_a', 'x', 1)`);
    assert.deepEqual((await feed(ctx, 'social_b')).posts, []);
  });

  it('serves a signed file to its viewer only, with ranges, and re-checks visibility every time', async () => {
    const post = await photoPost(ctx, 'social_a');
    const link = post.media[0]!.url;
    const get = (path: string, init: RequestInit = {}) => fetch(ctx.baseUrl() + path, init);
    const ok = await get(link);
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('content-type'), 'image/jpeg');
    assert.equal(ok.headers.get('cache-control'), 'private, max-age=3600');
    assert.equal(await ok.text(), 'processed-photo');
    const partial = await get(link, { headers: { Range: 'bytes=0-8' } });
    assert.equal(partial.status, 206);
    assert.equal(partial.headers.get('content-range'), 'bytes 0-8/15');
    assert.equal(await partial.text(), 'processed');
    const head = await get(link, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
    // Someone else's copy of the link, a tampered one, a poster that doesn't exist.
    assert.equal((await get(link.replace('v=social_a', 'v=social_b'))).status, 403);
    assert.equal((await get(link.replace(/sig=[^&]+/, 'sig=AAAA'))).status, 403);
    assert.equal((await get(link.replace('/file?', '/poster?'))).status, 403);
    assert.equal((await get('/social/media/not-a-uuid/file')).status, 404);
    assert.equal((await get(link.replace('/file?', '/thumb?'))).status, 404);
    assert.equal((await get(link, { method: 'POST' })).status, 401);
    media.state.failGet = true;
    assert.equal((await get(link)).status, 502);
    media.state.failGet = false;
    media.objects.clear();
    assert.equal((await get(link)).status, 404);
    // Once the post is gone, so is the file — even with a still-valid link.
    await authenticatedFetch(ctx, 'social_a', `/social/posts/${post.id}`, { method: 'DELETE' });
    assert.equal((await get(link)).status, 404);
  });

  it('lets moderators review hidden posts, see their files, and restore or remove them', async () => {
    const post = await photoPost(ctx, 'social_a');
    for (let i = 0; i < REPORTS_TO_HIDE; i += 1) await postJson(ctx, `social_r${i}`, `/social/posts/${post.id}/report`, { reason: 'sexual' });
    await getPool().query(`INSERT INTO users (id, username, password_hash, is_admin) VALUES ('social_mod', 'social_mod', 'x', true)`);
    assert.equal((await authenticatedFetch(ctx, 'social_b', '/moderation/social-posts')).status, 403);
    assert.equal((await authenticatedFetch(ctx, 'social_mod', '/moderation/social-posts?limit=0')).status, 400);
    const list = await (await authenticatedFetch(ctx, 'social_mod', '/moderation/social-posts')).json() as { posts: Array<{ post: { id: string; media: Array<{ url: string }> }; reports: number; reasons: string[] }> };
    assert.deepEqual(list.posts.map((entry) => [entry.post.id, entry.reports, entry.reasons]), [[post.id, REPORTS_TO_HIDE, ['sexual']]]);
    assert.equal((await fetch(ctx.baseUrl() + list.posts[0]!.post.media[0]!.url)).status, 200, 'staff can open the hidden file');
    assert.equal((await postJson(ctx, 'social_mod', `/moderation/social-posts/${post.id}/restore`, {})).status, 400, 'a note is required');
    assert.equal((await postJson(ctx, 'social_mod', `/moderation/social-posts/${post.id}/restore`, { note: 'x'.repeat(1001) })).status, 400);
    assert.equal((await postJson(ctx, 'social_mod', `/moderation/social-posts/${post.id}/restore`, { note: 'Fine: a bike, not spam' })).status, 200);
    assert.deepEqual((await feed(ctx, 'social_c')).posts.map((p) => p.id), [post.id]);
    assert.equal((await postJson(ctx, 'social_mod', `/moderation/social-posts/${post.id}/remove`, { note: 'Removed on review' })).status, 200);
    assert.deepEqual((await feed(ctx, 'social_a')).posts, []);
    assert.equal((await postJson(ctx, 'social_mod', `/moderation/social-posts/${post.id}/remove`, { note: 'again' })).status, 404);
    const log = await getPool().query(`SELECT action, note, target_rider_id FROM moderation_actions WHERE moderator_id = 'social_mod' ORDER BY created_at`);
    assert.deepEqual(log.rows.map((row) => [row.action, row.target_rider_id]), [['social_post_restore', 'social_a'], ['social_post_remove', 'social_a']]);
    assert.match(String(log.rows[1]?.note), new RegExp(`^Rider Social post ${post.id}: Removed on review$`));
    assert.equal((await postJson(ctx, 'social_mod', '/moderation/social-posts/x/frobnicate', {})).status, 404);
  });

  it('clears unused uploads and a deleted rider’s posts, queueing every file', async () => {
    const store = new SocialPostStore();
    await photoPost(ctx, 'social_a');
    await upload(ctx, 'social_a', MP4, 'video/mp4');
    assert.equal(await store.sweepUnattachedMedia(Date.now()), 0, 'too recent to sweep');
    assert.equal(await store.sweepUnattachedMedia(Date.now() + UNATTACHED_MEDIA_TTL_MS + 1000), 1);
    assert.equal((await getPool().query('SELECT 1 FROM social_media_delete_outbox')).rows.length, 2, 'the video and its poster');
    await new AccountDeletionStore().deleteRider('social_a');
    assert.equal((await getPool().query('SELECT 1 FROM social_posts')).rows.length, 0);
    assert.equal((await getPool().query('SELECT 1 FROM social_media_delete_outbox')).rows.length, 3);
    assert.equal(await store.moderate('00000000-0000-4000-8000-000000000000', 'restore', 'social_mod', 'n'), false);
  });
});

describe('Rider Social without media storage', { skip: !hasDatabase && 'DATABASE_URL not set' }, () => {
  let ctx: TestServer;
  before(async () => {
    ctx = startTestServer({ socialOpenBetaEnabled: true, socialMedia: null });
    await ctx.ready;
  });
  after(() => ctx.close());

  it('stays read-only: no uploads, posts, feeds or files, and other paths fall through', async () => {
    assert.equal((await upload(ctx, 'social_a', JPEG, 'image/jpeg')).status, 503);
    assert.equal((await authenticatedFetch(ctx, 'social_a', '/social/feed')).status, 503);
    assert.equal((await authenticatedFetch(ctx, 'social_a', '/social/elsewhere')).status, 404);
    assert.equal((await fetch(ctx.baseUrl() + '/social/media/12345678-1234-4234-8234-123456789abc/file')).status, 404);
    await getPool().query(`INSERT INTO users (id, username, password_hash, is_admin) VALUES ('social_mod2', 'social_mod2', 'x', true) ON CONFLICT DO NOTHING`);
    assert.equal((await authenticatedFetch(ctx, 'social_mod2', '/moderation/social-posts')).status, 200);
  });
});
