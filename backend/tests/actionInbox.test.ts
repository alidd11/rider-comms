import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildActionInbox } from '../src/actionInbox.ts';

describe('action inbox view model', () => {
  const reports = [
    { id: 'r-new', reportedRiderId: 'rider_a', reason: 'spam' as const, createdAt: 3_000,
      claimedBy: 'rider_staff', reportsAgainstRider: 2, details: 'Private report details' },
    { id: 'r-old', reportedRiderId: 'rider_b', reason: 'harassment' as const, createdAt: 1_000,
      claimedBy: null, reportsAgainstRider: 1, details: 'Confidential conversation' },
  ];
  const social = [
    { post: { id: 'post1', authorId: 'rider_c', kind: 'reel' as const, caption: 'Private text' },
      hiddenAt: 2_000, reports: 3, reasons: ['unsafe'], },
  ];

  it('combines genuine sources in waiting order with original IDs and claim status', () => {
    const result = buildActionInbox(reports, social, { now: 4_000 });
    assert.deepEqual(result.items.map((item) => item.id),
      ['rider_report:r-old', 'social_post:post1', 'rider_report:r-new']);
    assert.equal(result.generatedAt, 4_000);
    assert.equal(result.mayHaveMore, false);
    const report = result.items[2];
    assert.equal(report?.type, 'rider_report');
    if (report?.type === 'rider_report') assert.equal(report.claimedBy, 'rider_staff');
    const post = result.items[1];
    assert.equal(post?.type, 'social_post');
    if (post?.type === 'social_post') assert.equal(post.reportCount, 3);
  });

  it('does not leak report text or social captions into inbox summaries', () => {
    const json = JSON.stringify(buildActionInbox(reports, social));
    assert.equal(json.includes('Private report details'), false);
    assert.equal(json.includes('Confidential conversation'), false);
    assert.equal(json.includes('Private text'), false);
  });

  it('respects type filters, bounds results and makes source truncation explicit', () => {
    const filtered = buildActionInbox(reports, social, { filter: 'social_post', limit: 1 });
    assert.deepEqual(filtered.items.map((item) => item.type), ['social_post']);
    const page = buildActionInbox(reports, social, { limit: 1 });
    assert.equal(page.items.length, 1);
    assert.equal(page.mayHaveMore, true);
    const saturated = buildActionInbox(reports, [], { filter: 'rider_report', sampleLimit: 2, limit: 5 });
    assert.equal(saturated.mayHaveMore, true);
  });


  it('reports sampling saturation rather than claiming complete case counts', () => {
    const saturated = buildActionInbox(reports, social, { sampleLimit: 2, limit: 20 });
    assert.equal(saturated.items.length, 3);
    assert.equal(saturated.mayHaveMore, true);
    assert.equal(saturated.sourceSampleLimit, 2);
  });

  it('sorts same-time items by stable ID without relying on input order', () => {
    const same = reports.map((r) => ({ ...r, createdAt: 1_000 })).reverse();
    assert.deepEqual(buildActionInbox(same, [], { filter: 'rider_report' }).items.map((i) => i.id),
      ['rider_report:r-new', 'rider_report:r-old']);
  });
});
