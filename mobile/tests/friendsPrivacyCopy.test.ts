import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const friendsSource = await readFile(new URL('../src/screens/FriendsScreen.tsx', import.meta.url), 'utf8');

describe('Friend profile privacy copy', () => {
  it('makes group-ride location sharing explicit', () => {
    assert.match(friendsSource, />Share to Ride<\/Text>/);
    assert.match(
      friendsSource,
      /Shares your location with everyone in your current group ride, not just this rider\./,
    );
    assert.doesNotMatch(friendsSource, />Share Location<\/Text>/);
  });
});
