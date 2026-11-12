import test from 'node:test';
import assert from 'node:assert/strict';
import { canEnterPublicDiscovery, canSell, selectDemoFeed } from '../src/domain.ts';
import type { SocialPost } from '../src/domain.ts';

const common = {
  author: 'Creator', handle: '@creator', heading: 'Post', body: 'Test content',
  category: 'Cars', icon: 'car-sport' as const, accent: '#3868A0'
};
const posts: SocialPost[] = [
  { ...common, id: 'recent', authorId: 'followed', publishedAt: 30, discoveryScore: 1, audience: 'public' },
  { ...common, id: 'popular', authorId: 'followed', publishedAt: 20, discoveryScore: 99, audience: 'public' },
  { ...common, id: 'stranger', authorId: 'other', publishedAt: 40, discoveryScore: 88, audience: 'public' },
  { ...common, id: 'private', authorId: 'followed', publishedAt: 99, discoveryScore: 100, audience: 'members', clubAccess: 'private' },
  { ...common, id: 'approval', authorId: 'other', publishedAt: 99, discoveryScore: 100, audience: 'public', clubAccess: 'approval' }
];

test('private and approval-only club content cannot enter public discovery', () => {
  assert.equal(canEnterPublicDiscovery({ audience: 'members', clubAccess: 'private' }), false);
  assert.equal(canEnterPublicDiscovery({ audience: 'public', clubAccess: 'approval' }), false);
  assert.equal(canEnterPublicDiscovery({ audience: 'public', clubAccess: 'public' }), true);
  assert.deepEqual(selectDemoFeed(posts, 'forYou', new Set(), 'relevant').map(p => p.id),
    ['popular', 'stranger', 'recent']);
});

test('following chronological sort is genuinely newest-first and friend-scoped', () => {
  assert.deepEqual(selectDemoFeed(posts, 'following', new Set(['followed']), 'newest').map(p => p.id),
    ['recent', 'popular']);
  assert.deepEqual(selectDemoFeed(posts, 'following', new Set(['followed']), 'relevant').map(p => p.id),
    ['popular', 'recent']);
});

test('only fully approved, active merchants may transact', () => {
  const valid = {businessVerified:true,commerceApproved:true,payoutsEnabled:true,suspended:false};
  assert.equal(canSell(valid),true);
  assert.equal(canSell({...valid,businessVerified:false}),false);
  assert.equal(canSell({...valid,commerceApproved:false}),false);
  assert.equal(canSell({...valid,payoutsEnabled:false}),false);
  assert.equal(canSell({...valid,suspended:true}),false);
});
