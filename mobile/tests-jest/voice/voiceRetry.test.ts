import { voiceRetryDelayMs } from '../../src/voice/voiceRetry';

describe('voiceRetryDelayMs', () => {
  it('doubles from two seconds and stops at a minute', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 20].map(voiceRetryDelayMs))
      .toEqual([2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000, 60_000]);
  });

  it('treats a bad attempt count as the first try', () => {
    expect(voiceRetryDelayMs(-3)).toBe(2_000);
    expect(voiceRetryDelayMs(1.7)).toBe(4_000);
  });
});
