import { test } from 'node:test';
import assert from 'node:assert/strict';
import { postCaption, publishableKind, publishDraft, PublishError, videoTypeFor } from '../src/publishPost.ts';
import type { ComposerDraft, ComposerMedia } from '../src/upload.ts';

const photo = (id: string): ComposerMedia => ({ id, uri: 'file:///' + id + '.jpg', kind: 'image', fileName: id + '.jpg', width: 4000, height: 3000 });
const video = (id: string, extra: Partial<ComposerMedia> = {}): ComposerMedia => ({ id, uri: 'file:///' + id + '.mov', kind: 'video', fileName: id + '.mov', ...extra });
const draft = (mode: ComposerDraft['mode'], media: ComposerMedia[], caption = 'Box Hill', title?: string): ComposerDraft =>
  ({ mode, media, caption, audience: 'public', category: 'motorcycles', ...(title !== undefined ? { title } : {}) });

test('only photo posts and one-video Reels can be published', () => {
  assert.deepEqual(publishableKind(draft('Post', [photo('a'), photo('b')])), { kind: 'photo' });
  assert.deepEqual(publishableKind(draft('Reel', [video('v')])), { kind: 'reel' });
  assert.match((publishableKind(draft('Story', [photo('a')])) as { error: string }).error, /Stories/);
  assert.match((publishableKind(draft('Post', [photo('a'), video('v')])) as { error: string }).error, /as a Reel/);
  assert.match((publishableKind(draft('Reel', [photo('a')])) as { error: string }).error, /one video/);
  assert.match((publishableKind(draft('Post', [])) as { error: string }).error, /1 to 6/);
  assert.match((publishableKind(draft('Post', Array.from({ length: 7 }, (_, i) => photo('p' + i)))) as { error: string }).error, /1 to 6/);
});

test('declares a video by its picker type, its own type, then its extension', () => {
  assert.equal(videoTypeFor({ mimeType: 'video/quicktime', fileName: 'x.mp4', uri: '' }), 'video/quicktime');
  assert.equal(videoTypeFor({ mimeType: 'video/x-m4v', fileName: '', uri: '' }), 'video/mp4');
  assert.equal(videoTypeFor({ fileName: '', uri: 'blob:abc' }, 'video/webm;codecs=vp9'), 'video/webm');
  assert.equal(videoTypeFor({ fileName: 'ride.MOV', uri: '' }), 'video/quicktime');
  assert.equal(videoTypeFor({ fileName: '', uri: 'file:///clip.webm?x=1' }), 'video/webm');
  assert.equal(videoTypeFor({ fileName: 'Video', uri: 'blob:abc' }), 'video/mp4');
});

test('a caption joins the title and the text', () => {
  assert.equal(postCaption({ title: '  Dawn run ', caption: ' Box Hill ' }), 'Dawn run\n\nBox Hill');
  assert.equal(postCaption({ caption: '' }), '');
});

test('uploads each file in order, then posts them with progress in words', async () => {
  const calls: unknown[][] = [];
  const client = {
    uploadSocialMedia: async (body: Blob, type: string) => { calls.push(['upload', await body.text(), type]); return { id: 'm' + calls.length, kind: 'image' as const, width: 1, height: 1, durationMs: null }; },
    createSocialPost: async (kind: 'photo' | 'reel', caption: string, ids: string[]) => { calls.push(['post', kind, caption, ids]); return { id: 'post1' } as never; },
  };
  const progress: string[] = [];
  const prepared: string[] = [];
  await publishDraft(client, draft('Post', [photo('a'), photo('b')], 'Sunday'), async (item) => {
    prepared.push(item.id);
    return { body: new Blob([item.id]), type: 'image/jpeg' };
  }, (message) => progress.push(message));
  assert.deepEqual(prepared, ['a', 'b']);
  assert.deepEqual(calls, [['upload', 'a', 'image/jpeg'], ['upload', 'b', 'image/jpeg'], ['post', 'photo', 'Sunday', ['m1', 'm2']]]);
  assert.deepEqual(progress, ['Uploading photo 1 of 2…', 'Uploading photo 2 of 2…', 'Posting…']);

  progress.length = 0;
  await publishDraft(client, draft('Reel', [video('v')]), async () => ({ body: new Blob(['v']), type: 'video/quicktime' }), (m) => progress.push(m));
  assert.match(progress[0]!, /video/);
  await publishDraft(client, draft('Post', [photo('solo')]), async () => ({ body: new Blob(['s']), type: 'image/jpeg' }), (m) => progress.push(m));
  assert.ok(progress.includes('Uploading your photo…'));
  await publishDraft(client, draft('Post', [photo('quiet')]), async () => ({ body: new Blob(['q']), type: 'image/jpeg' }));
});

test('refuses a draft that can’t be posted before uploading anything', async () => {
  let uploads = 0;
  const client = { uploadSocialMedia: async () => { uploads += 1; return {} as never; }, createSocialPost: async () => ({}) as never };
  await assert.rejects(publishDraft(client, draft('Story', [photo('a')]), async () => ({ body: new Blob([]), type: 'image/jpeg' })), PublishError);
  assert.equal(uploads, 0);
});
