import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACCOUNT_EXPORT_MAX_CACHE_AGE_MS,
  isExpiredAccountExportFile,
} from '../src/security/accountExportRetention.ts';

const now = 1_800_000_000_000;
const name = (createdAt: number, suffix = 'abc12345') =>
  'rider-comms-data-' + createdAt + '-' + suffix + '.json';

describe('private account export cache retention', () => {
  it('keeps recently generated files available for the OS preview handoff', () => {
    assert.equal(isExpiredAccountExportFile(name(now), now), false);
    assert.equal(isExpiredAccountExportFile(name(now - 1), now), false);
    assert.equal(isExpiredAccountExportFile(name(now - ACCOUNT_EXPORT_MAX_CACHE_AGE_MS + 1), now), false);
  });

  it('removes only known exports at or beyond the 24-hour retention boundary', () => {
    assert.equal(isExpiredAccountExportFile(name(now - ACCOUNT_EXPORT_MAX_CACHE_AGE_MS), now), true);
    assert.equal(isExpiredAccountExportFile(name(now - ACCOUNT_EXPORT_MAX_CACHE_AGE_MS - 1), now), true);
  });

  it('ignores unrelated files, malformed names and future timestamps', () => {
    assert.equal(isExpiredAccountExportFile('some-other-file.json', now), false);
    assert.equal(isExpiredAccountExportFile('rider-comms-data-1700000000000.json', now), false);
    assert.equal(isExpiredAccountExportFile(name(now - 2 * ACCOUNT_EXPORT_MAX_CACHE_AGE_MS, 'invalid_nonce'), now), false);
    assert.equal(isExpiredAccountExportFile('rider-comms-data-0000000000000-abc12345.json', now), false);
    assert.equal(isExpiredAccountExportFile(name(now + 1000), now), false);
    assert.equal(isExpiredAccountExportFile(name(now - 2 * ACCOUNT_EXPORT_MAX_CACHE_AGE_MS), Number.NaN), false);
  });
});
