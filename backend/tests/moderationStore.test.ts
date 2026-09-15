import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ModerationStore } from '../src/moderationStore.ts';

describe('ModerationStore', () => {
  it('treats a one-sided block as mutual communication isolation', () => {
    const store = new ModerationStore();
    store.block('alice', 'bob');
    assert.equal(store.isBlockedBetween('alice', 'bob'), true);
    assert.equal(store.isBlockedBetween('bob', 'alice'), true);
    assert.deepEqual(store.getBlocked('alice'), ['bob']);
    store.unblock('alice', 'bob');
    assert.equal(store.isBlockedBetween('alice', 'bob'), false);
  });

  it('accepts a validated safety report', () => {
    const report = new ModerationStore().report('alice', 'bob', 'unsafe', 'Dangerous riding');
    assert.equal(report.reporterId, 'alice');
    assert.equal(report.reportedRiderId, 'bob');
    assert.equal(report.reason, 'unsafe');
    assert.ok(report.id);
  });
});
