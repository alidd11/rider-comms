import { describe, it } from 'node:test';
import { expect } from './testUtils.ts';
import { SlidingWindowRateLimiter } from '../src/rateLimiter.ts';

describe('SlidingWindowRateLimiter', () => {
  it('allows up to maxHits attempts within the window', () => {
    const limiter = new SlidingWindowRateLimiter(3, 1000);
    expect(limiter.tryConsume('user-1', 0)).toBe(true);
    expect(limiter.tryConsume('user-1', 10)).toBe(true);
    expect(limiter.tryConsume('user-1', 20)).toBe(true);
  });

  it('blocks the (maxHits + 1)th attempt within the window', () => {
    const limiter = new SlidingWindowRateLimiter(3, 1000);
    limiter.tryConsume('user-1', 0);
    limiter.tryConsume('user-1', 10);
    limiter.tryConsume('user-1', 20);
    expect(limiter.tryConsume('user-1', 30)).toBe(false);
  });

  it('allows attempts again once the window has passed', () => {
    const limiter = new SlidingWindowRateLimiter(2, 1000);
    limiter.tryConsume('user-1', 0);
    limiter.tryConsume('user-1', 10);
    expect(limiter.tryConsume('user-1', 20)).toBe(false);
    // Well past the 1000ms window from the first hits
    expect(limiter.tryConsume('user-1', 1100)).toBe(true);
  });

  it('tracks separate keys independently', () => {
    const limiter = new SlidingWindowRateLimiter(1, 1000);
    expect(limiter.tryConsume('user-1', 0)).toBe(true);
    expect(limiter.tryConsume('user-2', 0)).toBe(true);
    expect(limiter.tryConsume('user-1', 5)).toBe(false);
  });
});
