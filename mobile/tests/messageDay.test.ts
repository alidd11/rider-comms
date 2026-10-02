import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatMessageDay, startsNewDay } from '../src/friends/messageDay.ts';

const now = new Date(2026, 9, 2, 18, 8);
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m, d, h).getTime();

describe('formatMessageDay', () => {
  it('names today and yesterday', () => {
    assert.equal(formatMessageDay(at(2026, 9, 2, 0), now), 'Today');
    assert.equal(formatMessageDay(at(2026, 9, 1, 23), now), 'Yesterday');
  });

  it('dates older messages, adding the year only when it differs', () => {
    const older = formatMessageDay(at(2026, 8, 28), now);
    assert.match(older, /28/);
    assert.doesNotMatch(older, /2026/);
    assert.match(formatMessageDay(at(2025, 11, 31), now), /2025/);
  });

  it('returns nothing for an invalid time', () => {
    assert.equal(formatMessageDay(Number.NaN, now), '');
  });
});

describe('startsNewDay', () => {
  it('starts the first message and each change of calendar day', () => {
    assert.equal(startsNewDay(at(2026, 9, 1), undefined), true);
    assert.equal(startsNewDay(at(2026, 9, 1, 23), at(2026, 9, 1, 8)), false);
    assert.equal(startsNewDay(at(2026, 9, 2, 0), at(2026, 9, 1, 23)), true);
  });
});
