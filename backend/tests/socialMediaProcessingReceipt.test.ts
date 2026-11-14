import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isSocialMediaReady, type SocialMediaProcessingReceipt } from '../src/socialMediaProcessingReceipt.ts';

const hash = 'a'.repeat(64);
function valid(): SocialMediaProcessingReceipt {
  return {
    kind: 'image', sourceSha256: hash, outputSha256: 'b'.repeat(64),
    quarantineScan: 'clean', unsafeContentReview: 'approved',
    metadataScrub: 'verified', outputInspection: 'verified',
    outputStorage: 'private',
  };
}

describe('trusted Social media processing receipt', () => {
  it('accepts fully attested private images and bounded transcoded videos', () => {
    assert.equal(isSocialMediaReady(valid()), true);
    assert.equal(isSocialMediaReady({
      ...valid(), kind: 'video', videoTranscode: 'verified', videoDurationSeconds: 180,
    }), true);
  });
  it('fails closed for absent, malformed and incomplete receipts', () => {
    assert.equal(isSocialMediaReady(null), false);
    assert.equal(isSocialMediaReady(undefined), false);
    assert.equal(isSocialMediaReady({ ...valid(), kind: 'audio' } as unknown as SocialMediaProcessingReceipt), false);
    for (const field of Object.keys(valid()) as Array<keyof SocialMediaProcessingReceipt>) {
      assert.equal(isSocialMediaReady({ ...valid(), [field]: undefined }), false, field);
    }
    assert.equal(isSocialMediaReady({ ...valid(), sourceSha256: hash.toUpperCase() }), false);
    assert.equal(isSocialMediaReady({ ...valid(), outputSha256: 'bad' }), false);
  });
  it('rejects unscanned, unsafe, unsanitised or publicly stored output', () => {
    for (const quarantineScan of ['infected', 'error', 'pending'] as const) {
      assert.equal(isSocialMediaReady({ ...valid(), quarantineScan }), false);
    }
    for (const unsafeContentReview of ['rejected', 'pending', 'error'] as const) {
      assert.equal(isSocialMediaReady({ ...valid(), unsafeContentReview }), false);
    }
    for (const metadataScrub of ['failed', 'pending'] as const) {
      assert.equal(isSocialMediaReady({ ...valid(), metadataScrub }), false);
    }
    for (const outputInspection of ['failed', 'pending'] as const) {
      assert.equal(isSocialMediaReady({ ...valid(), outputInspection }), false);
    }
    for (const outputStorage of ['public', 'missing'] as const) {
      assert.equal(isSocialMediaReady({ ...valid(), outputStorage }), false);
    }
  });
  it('rejects video without verified transcode and valid bounded duration', () => {
    const video = { ...valid(), kind: 'video' as const };
    assert.equal(isSocialMediaReady(video), false);
    for (const videoTranscode of ['failed', 'pending'] as const) {
      assert.equal(isSocialMediaReady({ ...video, videoTranscode, videoDurationSeconds: 10 }), false);
    }
    for (const videoDurationSeconds of [undefined, NaN, Infinity, -1, 0, 180.01]) {
      assert.equal(isSocialMediaReady({
        ...video, videoTranscode: 'verified', videoDurationSeconds,
      }), false);
    }
  });
  it('rejects image receipts containing video-specific fields', () => {
    assert.equal(isSocialMediaReady({ ...valid(), videoTranscode: 'verified' }), false);
    assert.equal(isSocialMediaReady({ ...valid(), videoDurationSeconds: 5 }), false);
  });
});
