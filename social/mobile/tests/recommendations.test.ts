import test from 'node:test';
import assert from 'node:assert/strict';
import {
  rankForYou, rankFollowing, rankReels, rankClubs, rankEvents,
  rankMarketplace, selectEligibleAds, explainReason, mayViewContent, noViewer,
} from '../src/recommendations.ts';
import type { Content, Viewer, MarketplaceListing } from '../src/recommendations.ts';

const now = 1794500000;
function viewer(overrides: Partial<Viewer> = {}): Viewer {
  return {
    ...noViewer, userId: 'me', ageFloor: 18,
    followedAuthors: new Set(['alice']), clubMemberIds: new Set(['joined']),
    interests: { cars: 0.9, motorcycles: 0.5 }, selectedRegion: 'London',
    personalisationEnabled: true,
    ...overrides,
  };
}
function content(overrides: Partial<Content> = {}): Content {
  return {
    id: 'a', authorId: 'alice', privacy: 'public', authorPermitsDiscovery: true,
    state: 'published', minAge: 16, createdAt: now - 3600, topics: ['cars'],
    quality: 0.7, likeCount: 10, commentCount: 5, saveCount: 5,
    impressions: 100, negativeFeedbackCount: 0, authorTotalImpressions: 200,
    ...overrides
  };
}

test('public discovery excludes private, approval-only, unconsented and non-published posts', () => {
  const good = content();
  const rejected = [
    content({ id: 'club-private', clubId: 'joined', clubPrivacy: 'private' }),
    content({ id: 'club-approval', clubId: 'joined', clubPrivacy: 'approval' }),
    content({ id: 'members', privacy: 'members', clubId: 'joined', clubPrivacy: 'public' }),
    content({ id: 'no-consent', authorPermitsDiscovery: false }),
    content({ id: 'pending', state: 'pending' }),
    content({ id: 'removed', state: 'removed' }),
    content({ id: 'private', privacy: 'private' }),
  ];
  assert.deepEqual(rankForYou([good, ...rejected], viewer(), now).map((v) => v.item.id), ['a']);
  assert.equal(mayViewContent(rejected[0], viewer(), 'discovery'), false);
});

test('following shows eligible member posts only for authorised members, sorted newest-first', () => {
  const items = [
    content({ id: 'early', createdAt: now - 100, quality: 1 }),
    content({ id: 'late', createdAt: now - 10, quality: 0 }),
    content({ id: 'friends-only', privacy: 'followers', createdAt: now - 5 }),
    content({ id: 'members', privacy: 'members', clubId: 'joined', clubPrivacy: 'private', createdAt: now - 2 }),
    content({ id: 'other-club', privacy: 'members', clubId: 'unjoined', clubPrivacy: 'private' }),
    content({ id: 'stranger', authorId: 'stranger' }),
  ];
  assert.deepEqual(rankFollowing(items, viewer(), now, 'newest').map((v) => v.item.id),
    ['members', 'friends-only', 'late', 'early']);
  assert.equal(rankFollowing(items, viewer({ clubMemberIds: new Set() }), now, 'newest').some((v) => v.item.id === 'members'), false);
});

test('blocked, muted, hidden, and adult-restricted content never appears in For You or Reels', () => {
  const items = [
    content({ id: 'blocked', authorId: 'blocked' }),
    content({ id: 'muted', authorId: 'muted' }),
    content({ id: 'hidden' }),
    content({ id: 'adult', minAge: 18 }),
    content({ id: 'visible', authorId: 'creator' }),
  ];
  const teen = viewer({
    ageFloor: 16, blockedAuthors: new Set(['blocked']),
    mutedAuthors: new Set(['muted']), hiddenContentIds: new Set(['hidden'])
  });
  for (const ranked of [rankForYou(items, teen, now), rankReels(items, teen, now)]) {
    assert.deepEqual(ranked.map((v) => v.item.id), ['visible']);
  }
});

test('Not interested topics and personalisation off are respected', () => {
  const items = [
    content({ id: 'cars', authorId: 'x', topics: ['cars'], createdAt: now - 60 }),
    content({ id: 'cycling', authorId: 'y', topics: ['cycling'], createdAt: now - 60 }),
  ];
  assert.deepEqual(rankForYou(items, viewer({ hiddenTopics: new Set(['cars']) }), now).map((v) => v.item.id), ['cycling']);
  const nonPersonal = rankForYou(items, viewer({ personalisationEnabled: false }), now);
  assert.equal(nonPersonal.length, 2);
  assert.equal(nonPersonal.find((v) => v.item.id === 'cars')?.reason, 'recent');
});

test('future-dated content never receives a freshness bonus', () => {
  const current = content({ id: 'current', authorId: 'normal', createdAt: now, quality: 0,
    likeCount: 0, commentCount: 0, saveCount: 0, authorTotalImpressions: 10000,
    topics: ['other'] });
  const future = { ...current, id: 'future', authorId: 'clock-manipulator', createdAt: now + 86400 };
  const result = rankForYou([future, current], viewer({
    followedAuthors: new Set(), interests: {}, personalisationEnabled: false
  }), now);
  assert.deepEqual(result.map(entry => entry.item.id), ['current', 'future']);
  assert.equal(result.find(entry => entry.item.id === 'future')?.reason, 'discover');
});

test('small authors get a chance and one creator cannot monopolise initial slots', () => {
  const items = [
    content({ id: 'x1', authorId: 'big', quality: 1, authorTotalImpressions: 100000 }),
    content({ id: 'x2', authorId: 'big', quality: 0.9, authorTotalImpressions: 100000 }),
    content({ id: 'x3', authorId: 'big', quality: 0.8, authorTotalImpressions: 100000 }),
    content({ id: 'y1', authorId: 'small', quality: 0.6, authorTotalImpressions: 30 }),
  ];
  const ranked = rankForYou(items, viewer(), now, 3);
  assert.equal(ranked.length, 3);
  assert.equal(ranked.filter(v => v.item.authorId === 'small').length, 1);
  assert.equal(new Set(ranked.slice(0, 2).map(v => v.item.authorId)).size, 2);
});

test('club recommendations omit private or suspended communities; use broad selected region only', () => {
  const club = { id: 'c', name: 'Car Club', topics: ['cars'] as const, privacy: 'public' as const, state: 'active' as const, memberCount: 100, monthlyActiveMembers: 40, region: 'London', sharedConnectionCount: 4, minAge: 16 as const };
  const ranked = rankClubs([club, {...club, id:'private', privacy:'private'}, {...club,id:'suspended',state:'suspended'}],viewer());
  assert.deepEqual(ranked.map(v=>v.item.id), ['c']);
});

test('public upcoming events only, excluding full/private/cancelled/adult-only events', () => {
  const event = { id: 'e', title: 'Car Meet', topics: ['cars'] as const, visibility: 'public' as const, state: 'active' as const, startAt: now + 86400, minAge: 16 as const, region: 'London', interestedCount: 30, organiserId: 'host' };
  const ranked = rankEvents([
    event, {...event,id:'private',visibility:'private'}, {...event,id:'past',startAt:now-1},
    {...event,id:'full',slotsRemaining:0}, {...event,id:'cancelled',state:'cancelled'},
    {...event,id:'adult',minAge:18}
  ], viewer({ageFloor:16}), now);
  assert.deepEqual(ranked.map(v=>v.item.id), ['e']);
});

const merchant = {verified:true,approved:true,payoutsEnabled:true,suspended:false};
function listing(overrides: Partial<MarketplaceListing> = {}): MarketplaceListing {
  return {id:'l',merchantId:'m',title:'Motorcycle touring gloves',topics:['motorcycles'],category:'Accessories',available:true,state:'active',merchant,relevanceTerms:['gloves','touring'],quality:0.9,popularity:200,...overrides};
}
test('marketplace excludes unapproved businesses and unavailable listings, with multi-term search', () => {
  const ranked = rankMarketplace([
    listing(), listing({id:'unverified',merchant:{...merchant,verified:false}}),
    listing({id:'no-payouts',merchant:{...merchant,payoutsEnabled:false}}),
    listing({id:'suspended',merchant:{...merchant,suspended:true}}),
    listing({id:'sold-out',available:false}),
    listing({id:'removed',state:'removed'})
  ],viewer(),'motorcycle gloves');
  assert.deepEqual(ranked.map(v=>v.item.id), ['l']);
  assert.equal(rankMarketplace([listing()],viewer(),'bicycle').length,0);
});

test('advertising stays separate, labelled, approved, funded, age safe and frequency capped', () => {
  const ad = {id:'ad',advertiserId:'brand',state:'approved' as const,businessVerified:true,targetTopics:['cars'] as const,allowedRegions:['London'],minAge:16 as const,bid:2,quality:0.8,remainingBudget:10,impressionsToViewer:0};
  const result = selectEligibleAds([
    ad, {...ad,id:'unapproved',state:'pending'}, {...ad,id:'unfunded',remainingBudget:0},
    {...ad,id:'frequency',impressionsToViewer:3},
    {...ad,id:'minor',minAge:18},
    {...ad,id:'unverified',businessVerified:false}
  ], viewer({ageFloor:16}));
  assert.deepEqual(result.map(x => [x.item.id,x.label]), [['ad','Ad']]);
  assert.equal(selectEligibleAds([ad],viewer({selectedRegion:undefined})).length,0);
  assert.equal(explainReason('interest'),'Matches interests you chose');
});
