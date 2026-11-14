import * as React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import type { HazardReport } from '@rider-comms/shared';
import { HazardDetailCard, hazardAgeLabel } from '../../src/components/HazardDetailCard';

const hazard: HazardReport = {
  id: 'h1', type: 'accident', lat: 51.5, lon: -0.1, reportedBy: 'r1',
  createdAt: Date.now() - 5 * 60_000, expiresAt: Date.now() + 60_000, confirmations: 2, denials: 1,
};

test('shows the report, its age and votes, and the rider\'s own confirmation', async () => {
  const onVote = jest.fn();
  const onDismiss = jest.fn();
  const view = await render(<HazardDetailCard hazard={hazard} bottomInset={0} onDismiss={onDismiss} onVote={onVote} notice="Accident reported." />);
  expect(view.getByText('Accident')).toBeTruthy();
  expect(view.getByText('Reported 5m ago')).toBeTruthy();
  expect(view.getByText('Accident reported.')).toBeTruthy();
  await fireEvent.press(view.getByLabelText('Still there, 2 confirmations'));
  await fireEvent.press(view.getByLabelText('Gone, 1 reports'));
  await fireEvent.press(view.getByLabelText('Dismiss road report'));
  expect(onVote).toHaveBeenNthCalledWith(1, 'h1', 'confirm');
  expect(onVote).toHaveBeenNthCalledWith(2, 'h1', 'deny');
  expect(onDismiss).toHaveBeenCalled();

  const plain = await render(<HazardDetailCard hazard={hazard} bottomInset={0} onDismiss={onDismiss} onVote={onVote} />);
  expect(plain.queryByText('Accident reported.')).toBeNull();
});

test('ages read just now, in minutes, then in hours', () => {
  expect(hazardAgeLabel(1_000_000, 1_000_000 + 20_000)).toBe('just now');
  expect(hazardAgeLabel(0, 12 * 60_000)).toBe('12m ago');
  expect(hazardAgeLabel(0, 3 * 3_600_000)).toBe('3h ago');
});
