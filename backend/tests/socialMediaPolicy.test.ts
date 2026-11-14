import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  matchesSocialMediaSignature, SOCIAL_MEDIA_TYPES, validateSocialMediaIntent,
} from '../src/socialMediaPolicy.ts';

const utf8 = (s: string): number[] => [...new TextEncoder().encode(s)];

describe('Social media intake contract', () => {
  it('admits only explicitly supported formats within conservative byte limits', () => {
    for (const [mime, spec] of Object.entries(SOCIAL_MEDIA_TYPES)) {
      assert.deepEqual(validateSocialMediaIntent(mime, 1), {
        ok: true, mime, kind: spec.kind, extension: spec.extension,
        maxBytes: spec.maxBytes, bytes: 1,
      });
      assert.equal(validateSocialMediaIntent(mime, spec.maxBytes).ok, true);
      assert.deepEqual(validateSocialMediaIntent(mime, spec.maxBytes + 1),
        { ok: false, error: 'invalid_media_size' });
    }
  });

  it('refuses fake, executable, SVG, GIF and mismatched media declarations', () => {
    for (const mime of [undefined, null, 7, '', 'image/svg+xml', 'image/gif',
      'text/html', 'application/x-msdownload', 'video/webm',
      'IMAGE/JPEG', 'image/jpeg; charset=utf-8', '__proto__']) {
      assert.deepEqual(validateSocialMediaIntent(mime, 100),
        { ok: false, error: 'invalid_media_type' });
    }
  });

  it('rejects empty, fractional, infinite, huge and non-numeric sizes', () => {
    for (const value of [undefined, null, '', '1024', -1, 0, 0.1,
      Infinity, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      assert.deepEqual(validateSocialMediaIntent('image/jpeg', value),
        { ok: false, error: 'invalid_media_size' });
    }
  });

  it('checks all allowed magic signatures, not file extensions or Content-Type alone', () => {
    const valid: Array<[keyof typeof SOCIAL_MEDIA_TYPES, Uint8Array]> = [
      ['image/jpeg', Uint8Array.from([255, 216, 255, 224, 0, 16])],
      ['image/png', Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])],
      ['image/webp', Uint8Array.from([...utf8('RIFF'), 0, 0, 0, 0, ...utf8('WEBP')])],
      ['video/mp4', Uint8Array.from([0, 0, 0, 24, ...utf8('ftyp'), ...utf8('isom')])],
    ];
    for (const [mime, bytes] of valid) {
      assert.equal(matchesSocialMediaSignature(mime, bytes), true, mime);
      assert.equal(matchesSocialMediaSignature(mime, bytes.slice(0, 2)), false, mime);
      for (const other of Object.keys(SOCIAL_MEDIA_TYPES) as Array<keyof typeof SOCIAL_MEDIA_TYPES>) {
        if (other !== mime) assert.equal(matchesSocialMediaSignature(other, bytes), false,
          `${mime} must not pass as ${other}`);
      }
    }
    assert.equal(matchesSocialMediaSignature('video/mp4',
      Uint8Array.from([0, 0, 0, 24, ...utf8('ftyp'), ...utf8('evil')])), false);
    assert.equal(matchesSocialMediaSignature('video/mp4',
      Uint8Array.from([0, 0, 0, 24, ...utf8('ftyp'), ...utf8('mp42')])), true);
    assert.equal(matchesSocialMediaSignature('image/png',
      Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 0])), false);
    assert.equal(matchesSocialMediaSignature('image/webp',
      Uint8Array.from([...utf8('ROFF'), 0, 0, 0, 0, ...utf8('WEBP')])), false);
    assert.equal(matchesSocialMediaSignature('image/webp',
      Uint8Array.from([...utf8('RIFF'), 0, 0, 0, 0, ...utf8('WABP')])), false);
  });
});
