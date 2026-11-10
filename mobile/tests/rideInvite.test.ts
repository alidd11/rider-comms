import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildRideInviteLink,
  isCompleteRideCode,
  normalizeRideCodeInput,
  parseRideInviteLink,
} from '../src/ride/rideInvite.ts';

describe('ride invite codes', () => {
  it('cleans up typed input character by character', () => {
    assert.equal(normalizeRideCodeInput('a'), 'A');
    assert.equal(normalizeRideCodeInput('ab'), 'AB');
    assert.equal(normalizeRideCodeInput('abc23'), 'ABC23');
    assert.equal(normalizeRideCodeInput('ab#c'), 'ABC');
  });

  it('accepts a pasted code with a space or dash', () => {
    assert.equal(normalizeRideCodeInput('ABC 234'), 'ABC234');
    assert.equal(normalizeRideCodeInput('abc-234'), 'ABC234');
    assert.equal(normalizeRideCodeInput('  xk7 p2q  '), 'XK7P2Q');
  });

  it('finds the code in a pasted share message', () => {
    assert.equal(normalizeRideCodeInput('Join my Rider Comms group ride with code XK7P2Q'), 'XK7P2Q');
  });

  it('prefers the invite link when one is pasted', () => {
    const message = `Join my Rider Comms group ride with code XK7P2Q\n${buildRideInviteLink('XK7P2Q')}`;
    assert.equal(normalizeRideCodeInput(message), 'XK7P2Q');
    assert.equal(normalizeRideCodeInput(buildRideInviteLink('ABC234')), 'ABC234');
  });

  it('round-trips invite links and rejects anything else', () => {
    assert.equal(buildRideInviteLink('XK7P2Q'), 'ridercomms://join?code=XK7P2Q');
    assert.equal(parseRideInviteLink('ridercomms://join?code=xk7p2q'), 'XK7P2Q');
    assert.equal(parseRideInviteLink('ridercomms:///join?code=XK7P2Q'), 'XK7P2Q');
    assert.equal(parseRideInviteLink('ridercomms://navigate?lat=1&lon=2'), null);
    assert.equal(parseRideInviteLink('https://example.com/join?code=XK7P2Q'), null);
    assert.equal(parseRideInviteLink('ridercomms://join?code=SHORT'), null);
    assert.equal(parseRideInviteLink('ridercomms://join'), null);
    assert.equal(parseRideInviteLink('not a url'), null);
    assert.equal(parseRideInviteLink(null), null);
  });

  it('knows when a code is complete', () => {
    assert.equal(isCompleteRideCode('XK7P2Q'), true);
    assert.equal(isCompleteRideCode('XK7P2'), false);
    assert.equal(isCompleteRideCode('XK7P20'), false);
    // Repeated calls must agree (no stateful regex).
    assert.equal(isCompleteRideCode('ABC234'), true);
    assert.equal(isCompleteRideCode('ABC234'), true);
  });
});
