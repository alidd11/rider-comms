import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { containsObjectionableText, containsSevereText } from '../src/contentFilter.ts';

describe('content filter', () => {
  it('blocks slurs everywhere, including disguised spellings', () => {
    for (const text of ['you nigger', 'N1GG3R', 'f a g o t', 'xxfaggotxx', 'Heil Hitler', 'p a e d o p h i l e']) {
      assert.equal(containsSevereText(text), true, text);
    }
  });

  it('blocks profanity only in public-facing text', () => {
    for (const text of ['FuckRider', 'shit_biker', '@porn_star', 'onlyfans.link']) {
      assert.equal(containsObjectionableText(text), true, text);
      assert.equal(containsSevereText(text), false, text);
    }
  });

  it('lets ordinary names, places and words through', () => {
    for (const text of [
      'Scunthorpe', 'Penistone', 'Sussex Riders', 'Essex', 'Peacock', 'Dick Turpin', 'Coon', 'Dyke Road',
      'therapist', 'grapes', 'Cockermouth', 'class act', 'Shitterton', 'Rider 1', '@ali_rides', 'Glencoe loop',
    ]) {
      assert.equal(containsObjectionableText(text), false, text);
    }
  });

  it('ignores non-strings and empty text', () => {
    assert.equal(containsObjectionableText(undefined), false);
    assert.equal(containsSevereText(42), false);
    assert.equal(containsObjectionableText('   '), false);
  });
});
