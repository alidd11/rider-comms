import type { FriendRequest } from '@rider-comms/shared';

export function appendUniqueFriendRequest(
  current: readonly FriendRequest[],
  request: FriendRequest,
): FriendRequest[] {
  return current.some((item) => item.id === request.id) ? [...current] : [...current, request];
}
