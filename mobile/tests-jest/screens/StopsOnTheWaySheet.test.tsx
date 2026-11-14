import * as React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StopsOnTheWaySheet } from '../../src/screens/StopsOnTheWaySheet';

const SAFE_AREA_METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };

const shell = { id: 's', name: 'Shell', address: 'A3, Guildford', lat: 51.2, lon: -0.6, travelSeconds: 1400 };
const bp = { id: 'b', name: 'BP', address: '', lat: 51.3, lon: -0.5 };

function sheet(findStops: jest.Mock, onChoose = jest.fn(), onClose = jest.fn(), visible = true) {
  return (
    <SafeAreaProvider initialMetrics={SAFE_AREA_METRICS}>
      <StopsOnTheWaySheet visible={visible} onClose={onClose} findStops={findStops} onChoose={onChoose} />
    </SafeAreaProvider>
  );
}

test('lists petrol on the way with what each adds, and a tap chooses it', async () => {
  const findStops = jest.fn(async () => [
    { place: shell, text: '+3 min', detourSeconds: 180 },
    { place: bp, text: '', detourSeconds: null },
  ]);
  const onChoose = jest.fn();
  const view = await render(sheet(findStops, onChoose));
  expect(findStops).toHaveBeenCalledWith('petrol station');
  expect(await view.findByText('+3 min')).toBeTruthy();
  expect(view.getByLabelText('Shell, A3, Guildford, +3 min')).toBeTruthy();
  expect(view.getByLabelText('BP')).toBeTruthy();
  await fireEvent.press(view.getByText('Shell'));
  expect(onChoose).toHaveBeenCalledWith(shell);
});

test('switches to cafés, says when nothing is found or the search fails, and closes', async () => {
  const findStops = jest.fn(async (query: string) => {
    if (query === 'cafe') return [];
    throw new Error('no signal');
  });
  const onClose = jest.fn();
  const view = await render(sheet(findStops, jest.fn(), onClose));
  expect(await view.findByText('Couldn’t search along the route. Try again.')).toBeTruthy();
  await fireEvent.press(view.getByRole('radio', { name: 'Cafés' }));
  expect(findStops).toHaveBeenLastCalledWith('cafe');
  expect(await view.findByText('No cafés found along the rest of the route.')).toBeTruthy();
  expect(view.getByRole('radio', { name: 'Cafés' }).props.accessibilityState).toEqual({ selected: true });
  await fireEvent.press(view.getByLabelText('Close'));
  expect(onClose).toHaveBeenCalled();
});

test('a closed sheet doesn\'t search, and a late answer after closing is ignored', async () => {
  let answer: (value: never[]) => void = () => {};
  const findStops = jest.fn(() => new Promise<never[]>((resolve) => { answer = resolve; }));
  const view = await render(sheet(findStops, jest.fn(), jest.fn(), false));
  expect(findStops).not.toHaveBeenCalled();
  await view.rerender(sheet(findStops));
  await view.rerender(sheet(findStops, jest.fn(), jest.fn(), false));
  await act(async () => { answer([]); });
  expect(view.queryByText(/No petrol/)).toBeNull();
});
