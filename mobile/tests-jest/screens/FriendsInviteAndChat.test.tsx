import * as React from 'react';
import { Share } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { FriendInviteCard } from '../../src/components/FriendInviteCard';
import { messageFollows } from '../../src/chat/messageGrouping';

test('the invite card shares the rider handle and opens Add a rider', async () => {
  const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as never);
  const onAdd = jest.fn();
  const view = await render(<FriendInviteCard handle="@ali" onAdd={onAdd} />);
  expect(view.getByText('@ali')).toBeTruthy();
  await fireEvent.press(view.getByRole('button', { name: 'Share handle' }));
  expect(share).toHaveBeenCalledWith({ message: 'Add me on Rider Comms: @ali' });
  await fireEvent.press(view.getByRole('button', { name: 'Add a rider' }));
  expect(onAdd).toHaveBeenCalled();
  share.mockRejectedValueOnce(new Error('dismissed'));
  await fireEvent.press(view.getByRole('button', { name: 'Share handle' }));
  share.mockRestore();
});

test('a message follows the one before only from the same rider, the same day, within five minutes', () => {
  const a = { fromRiderId: 'a', createdAt: 0 };
  expect(messageFollows(undefined, a, false)).toBe(false);
  expect(messageFollows(a, { fromRiderId: 'a', createdAt: 60_000 }, false)).toBe(true);
  expect(messageFollows(a, { fromRiderId: 'a', createdAt: 60_000 }, true)).toBe(false);
  expect(messageFollows(a, { fromRiderId: 'b', createdAt: 60_000 }, false)).toBe(false);
  expect(messageFollows(a, { fromRiderId: 'a', createdAt: 6 * 60_000 }, false)).toBe(false);
});

test('typing is sent at most every three seconds and shown until the friend sends a message', () => {
  const { peerIsTyping, shouldSendTyping } = jest.requireActual('../../src/chat/typing') as typeof import('../../src/chat/typing');
  expect(shouldSendTyping(0, 10_000)).toBe(true);
  expect(shouldSendTyping(10_000, 12_000)).toBe(false);
  expect(shouldSendTyping(10_000, 13_000)).toBe(true);
  expect(peerIsTyping(0, 1_000)).toBe(false);
  expect(peerIsTyping(10_000, 12_000)).toBe(true);
  expect(peerIsTyping(10_000, 16_500)).toBe(false);
  expect(peerIsTyping(10_000, 12_000, 11_000)).toBe(false);
});
