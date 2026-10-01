import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_DATABASE_POOL_MAX, databasePoolMax, databaseSslOptions } from '../src/db.ts';

describe('database TLS configuration', () => {
  it('keeps private/plain connections disabled when sslmode is absent', () => {
    assert.equal(databaseSslOptions('postgres://user:pass@db.internal/app'), undefined);
  });

  it('verifies external TLS certificates and accepts an explicit CA chain', () => {
    assert.deepEqual(
      databaseSslOptions('postgres://user:pass@db.example/app?sslmode=require', 'first\\nsecond'),
      { rejectUnauthorized: true, ca: 'first\nsecond' },
    );
  });

  it('rejects ambiguous or insecure sslmode values', () => {
    assert.throws(
      () => databaseSslOptions('postgres://user:pass@db.example/app?sslmode=prefer'),
      /Unsupported database sslmode/,
    );
  });
});

describe('database pool size', () => {
  it('defaults when DATABASE_POOL_MAX is unset or blank', () => {
    assert.equal(databasePoolMax(undefined), DEFAULT_DATABASE_POOL_MAX);
    assert.equal(databasePoolMax('  '), DEFAULT_DATABASE_POOL_MAX);
  });

  it('accepts an integer from 1 to 200 and rejects anything else', () => {
    assert.equal(databasePoolMax('35'), 35);
    for (const raw of ['0', '201', '2.5', 'many']) {
      assert.throws(() => databasePoolMax(raw), /DATABASE_POOL_MAX/);
    }
  });
});
