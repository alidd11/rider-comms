import * as React from 'react';
import { AccessibilityInfo, LayoutAnimation, Text } from 'react-native';
import { act, render } from '@testing-library/react-native';
import { listSignature, useListLayoutAnimation } from '../../src/components/useListLayoutAnimation';

function List({ ids }: { ids: string[] }) {
  useListLayoutAnimation(listSignature(ids));
  return <Text>{ids.join(',')}</Text>;
}

afterEach(() => jest.restoreAllMocks());

test('rows animate into place when the list changes, not on first render', async () => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
  const configure = jest.spyOn(LayoutAnimation, 'configureNext').mockImplementation(() => undefined);
  const view = await render(<List ids={['a', 'b']} />);
  expect(configure).not.toHaveBeenCalled();
  await view.rerender(<List ids={['a', 'b']} />);
  expect(configure).not.toHaveBeenCalled();
  await view.rerender(<List ids={['c', 'a', 'b']} />);
  expect(configure).toHaveBeenCalledTimes(1);
});

test('Reduce Motion keeps the list still', async () => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  const configure = jest.spyOn(LayoutAnimation, 'configureNext').mockImplementation(() => undefined);
  const view = await render(<List ids={['a']} />);
  await act(async () => { await Promise.resolve(); });
  await view.rerender(<List ids={['a', 'b']} />);
  expect(configure).not.toHaveBeenCalled();
});

test('a failed Reduce Motion check still animates', async () => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockRejectedValue(new Error('unavailable'));
  const configure = jest.spyOn(LayoutAnimation, 'configureNext').mockImplementation(() => undefined);
  const view = await render(<List ids={['a']} />);
  await act(async () => { await Promise.resolve(); });
  await view.rerender(<List ids={['b']} />);
  expect(configure).toHaveBeenCalledTimes(1);
});
