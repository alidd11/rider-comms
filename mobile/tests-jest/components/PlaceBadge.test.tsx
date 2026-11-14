import * as React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import { PLACE_BADGES, PlaceBadge } from '../../src/components/PlaceBadge';
import { colors } from '../../src/theme';

test('each kind of place has its own colour, with a white icon (grey on Recent)', async () => {
  const view = await render(<><PlaceBadge kind="home" /><PlaceBadge kind="recent" size={40} /></>);
  const home = StyleSheet.flatten(view.getByTestId('place-badge-home', { includeHiddenElements: true }).props.style);
  expect(home).toMatchObject({ width: 32, height: 32, borderRadius: 16, backgroundColor: PLACE_BADGES.home.color });
  const recent = StyleSheet.flatten(view.getByTestId('place-badge-recent', { includeHiddenElements: true }).props.style);
  expect(recent).toMatchObject({ width: 40, backgroundColor: colors.surfaceRaised });
  expect(new Set(Object.values(PLACE_BADGES).map((badge) => badge.color)).size).toBe(Object.keys(PLACE_BADGES).length);
});
