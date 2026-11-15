import test from 'node:test';
import assert from 'node:assert/strict';
import { demoCreators, publicGallery } from '../src/demoCreators.ts';
import { demoPosts } from '../src/sampleData.ts';

test('eligible demo photos include a swipeable second photo without duplicates', () => {
  const p1 = demoPosts.find(item => item.id === 'p1');
  assert.ok(p1);
  const gallery = publicGallery(p1);
  assert.equal(gallery.length, 2);
  assert.notEqual(gallery[0].uri, gallery[1].uri);
  assert.equal(gallery[0].alt, p1.imageAlt);
});

test('private club photography never enters public gallery results', () => {
  const privatePost = demoPosts.find(item => item.id === 'p4');
  assert.ok(privatePost);
  assert.deepEqual(publicGallery(privatePost), []);
});

test('every eligible sample author has a separate social creator garage', () => {
  for (const post of demoPosts.filter(p => p.audience === 'public')) {
    assert.ok(demoCreators[post.authorId]);
    assert.ok(demoCreators[post.authorId].gallery.length);
  }
});
