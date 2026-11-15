import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { decodeSocialCursor, encodeSocialCursor, InvalidSocialCursorError } from '../src/socialPostStore.ts';

const id = '12345678-1234-4234-8234-123456789abc';
const invalid = (value: string) =>
  assert.throws(() => decodeSocialCursor(value), InvalidSocialCursorError);

describe('Social feed cursor input validation', () => {
  it('round-trips valid timestamps including zero and current milliseconds', () => {
    for (const createdAt of [0, 1, 1_763_230_000_000, 9_999_999_999_999_999]) {
      const encoded = encodeSocialCursor({ createdAt, id });
      assert.deepEqual(decodeSocialCursor(encoded), { createdAt, id });
    }
  });
  it('rejects malformed, padded, oversized and noncanonical encodings', () => {
    const good = encodeSocialCursor({ createdAt: 123, id });
    for (const value of ['', good + '=', good + '!', ' '.repeat(100),
      'a'.repeat(1000), 'a', '___', '💥']) invalid(value);
  });
  it('rejects invalid IDs, noncanonical timestamps and unsafe integers', () => {
    for (const text of ['01:' + id, '-1:' + id, '1.5:' + id,
      '9007199254740992:' + id, '123:../../etc/passwd',
      '123:12345678-1234-4234-8234-123456789abz']) {
      invalid(Buffer.from(text).toString('base64url'));
    }
  });
});
