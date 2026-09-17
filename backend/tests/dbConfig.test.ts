import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { databaseSslOptions } from '../src/db.ts';

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
