import * as Haptics from 'expo-haptics';
import { haptics } from '../src/haptics';

test('each kind of feedback uses the matching system haptic, and failures are ignored', async () => {
  haptics.tap();
  haptics.select();
  haptics.success();
  haptics.warning();
  expect(Haptics.impactAsync).toHaveBeenCalledWith('light');
  expect(Haptics.selectionAsync).toHaveBeenCalled();
  expect(Haptics.notificationAsync).toHaveBeenCalledWith('success');
  expect(Haptics.notificationAsync).toHaveBeenCalledWith('warning');
  (Haptics.impactAsync as jest.Mock).mockRejectedValueOnce(new Error('no haptics engine'));
  expect(() => haptics.tap()).not.toThrow();
  await new Promise((resolve) => setImmediate(resolve));
});
