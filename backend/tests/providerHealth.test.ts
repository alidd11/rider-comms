import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { noteContentCheck, noteProviderError, noteProviderOk, providerHealthSnapshot, resetProviderHealth } from '../src/providerHealth.ts';

describe('outside service health', () => {
  afterEach(resetProviderHealth);

  it('starts with nothing seen and counts nothing', () => {
    const snapshot = providerHealthSnapshot();
    assert.deepEqual(snapshot.providers.google_places, { lastOkAt: null, lastErrorAt: null, lastError: null });
    assert.deepEqual(snapshot.contentCheck, { allowed: 0, rejected: 0, unavailable: 0 });
  });

  it('keeps the last answer and the last refusal with its reason', () => {
    noteProviderOk('google_vision', 1_000);
    noteProviderError('google_vision', `403 · ${'x'.repeat(400)}`, 2_000);
    const vision = providerHealthSnapshot().providers.google_vision;
    assert.equal(vision.lastOkAt, 1_000);
    assert.equal(vision.lastErrorAt, 2_000);
    assert.equal(vision.lastError?.length, 300);
    noteContentCheck('allowed');
    noteContentCheck('allowed');
    noteContentCheck('rejected');
    noteContentCheck('unavailable');
    assert.deepEqual(providerHealthSnapshot().contentCheck, { allowed: 2, rejected: 1, unavailable: 1 });
  });
});
