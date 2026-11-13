import * as React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { RegroupChip, RegroupMarker, isRegroupSpot, regroupTitle } from '../../src/screens/RegroupPoint';

jest.mock('react-native-maps', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  const { Pressable } = jest.requireActual<typeof import('react-native')>('react-native');
  const Marker = (props: Record<string, unknown>) => ReactActual.createElement(Pressable, { ...props, accessibilityLabel: props.title as string });
  return { __esModule: true, default: Pressable, Marker };
});

const POINT = { lat: 51.6, lon: -0.2, label: 'Esso, A1', setAt: 1 };

test('the chip says where and how far, and opens the regroup point', async () => {
  const onPress = jest.fn();
  const view = await render(
    <RegroupChip point={POINT} from={{ lat: 51.59, lon: -0.2 }} unitSystem="mi" top={100} onPress={onPress} />,
  );
  const chip = view.getByRole('button', { name: 'Regroup at Esso, A1, 0.7 mi away' });
  expect(view.getByText(/Esso, A1 · 0.7 mi/)).toBeTruthy();
  fireEvent.press(chip);
  expect(onPress).toHaveBeenCalledTimes(1);
});

test('without a fix the chip leaves the distance out; a dropped pin has a plain name', async () => {
  const view = await render(
    <RegroupChip point={{ ...POINT, label: '' }} from={null} unitSystem="km" top={100} onPress={() => {}} />,
  );
  expect(view.getByRole('button', { name: 'Regroup at Regroup point' })).toBeTruthy();
});

test('the map flag opens the regroup point', async () => {
  const onPress = jest.fn();
  const view = await render(<RegroupMarker point={POINT} onPress={onPress} />);
  fireEvent.press(view.getByLabelText('Regroup: Esso, A1'));
  expect(onPress).toHaveBeenCalledTimes(1);
});

test('a place within 10 m is the regroup point itself', () => {
  expect(regroupTitle({ ...POINT, label: '' })).toBe('Regroup point');
  expect(isRegroupSpot(POINT, { lat: 51.60005, lon: -0.2 })).toBe(true);
  expect(isRegroupSpot(POINT, { lat: 51.601, lon: -0.2 })).toBe(false);
  expect(isRegroupSpot(null, { lat: 51.6, lon: -0.2 })).toBe(false);
  expect(isRegroupSpot(POINT, null)).toBe(false);
});
