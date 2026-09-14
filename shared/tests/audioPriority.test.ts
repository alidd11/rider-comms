import { describe, it } from 'node:test';
import { expect } from './testUtils.ts';
import { computeAudioGains } from '../src/audioPriority.ts';

describe('computeAudioGains (nav > chat > music priority)', () => {
  it('is silent on all buses when nothing is active', () => {
    const gains = computeAudioGains({
      navPromptActive: false,
      chatActive: false,
      musicPlaying: false,
    });
    expect(gains).toEqual({ nav: 0, chat: 0, music: 0 });
  });

  it('plays music at full gain when it is the only active source', () => {
    const gains = computeAudioGains({
      navPromptActive: false,
      chatActive: false,
      musicPlaying: true,
    });
    expect(gains.music).toBe(1);
  });

  it('plays chat at full gain when nav is not active, even with music also playing (chat ducks music)', () => {
    const gains = computeAudioGains({
      navPromptActive: false,
      chatActive: true,
      musicPlaying: true,
    });
    expect(gains.chat).toBe(1);
    expect(gains.music).toBeLessThan(1);
    expect(gains.music).toBeGreaterThan(0); // ducked, not muted
  });

  it('always plays nav prompts at full gain, ducking both chat and music', () => {
    const gains = computeAudioGains({
      navPromptActive: true,
      chatActive: true,
      musicPlaying: true,
    });
    expect(gains.nav).toBe(1);
    expect(gains.chat).toBeLessThan(1);
    expect(gains.chat).toBeGreaterThan(0);
    expect(gains.music).toBeLessThan(1);
    expect(gains.music).toBeGreaterThan(0);
  });

  it('never fully mutes a lower-priority active source (duck, not mute)', () => {
    const gains = computeAudioGains({
      navPromptActive: true,
      chatActive: true,
      musicPlaying: true,
    });
    expect(gains.chat).toBeGreaterThan(0);
    expect(gains.music).toBeGreaterThan(0);
  });

  it('does not play a source that is not active, regardless of priority state', () => {
    const gains = computeAudioGains({
      navPromptActive: true,
      chatActive: false,
      musicPlaying: false,
    });
    expect(gains.chat).toBe(0);
    expect(gains.music).toBe(0);
  });
});
