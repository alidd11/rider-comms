import { Alert, type AlertButton } from 'react-native';
import { confirmBlock, openReportFlow, openRiderSafetyMenu } from '../../src/safety/riderSafetyActions';

function client() {
  return {
    reportRider: jest.fn(async () => undefined),
    blockRider: jest.fn(async () => undefined),
  };
}

function lastButtons(): AlertButton[] {
  const calls = (Alert.alert as jest.Mock).mock.calls;
  return calls[calls.length - 1][2] as AlertButton[];
}

function press(label: string) {
  const button = lastButtons().find((entry) => entry.text === label);
  if (!button?.onPress) throw new Error(`No "${label}" button in the last alert`);
  button.onPress();
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

test('reporting sends the chosen reason with where it came from', async () => {
  const api = client();
  openReportFlow(api as never, { riderId: 'rider-2', name: 'Maya', source: 'the ride roster' });
  expect(lastButtons().map((button) => button.text)).toEqual([
    'Harassment or threats', 'Sexual or explicit content', 'Unsafe behaviour', 'Spam or scam', 'Something else', 'Cancel',
  ]);
  press('Sexual or explicit content');
  await flush();
  expect(api.reportRider).toHaveBeenCalledWith('rider-2', 'sexual', 'Reported from the ride roster');
  expect(Alert.alert).toHaveBeenLastCalledWith('Report received', expect.stringContaining('24 hours'));
});

test('a failed report tells the rider to try again', async () => {
  const api = client();
  api.reportRider.mockRejectedValueOnce(new Error('offline'));
  openReportFlow(api as never, { riderId: 'rider-2', source: 'Nearby Voice' });
  press('Spam or scam');
  await flush();
  expect(Alert.alert).toHaveBeenLastCalledWith('Couldn’t send report', expect.any(String));
});

test('blocking needs confirmation, then calls back', async () => {
  const api = client();
  const onBlocked = jest.fn();
  confirmBlock(api as never, { riderId: 'rider-2', name: 'Maya', source: 'chat' }, onBlocked);
  expect(Alert.alert).toHaveBeenLastCalledWith('Block Maya?', expect.any(String), expect.any(Array));
  expect(api.blockRider).not.toHaveBeenCalled();
  press('Block');
  await flush();
  expect(api.blockRider).toHaveBeenCalledWith('rider-2');
  expect(onBlocked).toHaveBeenCalledTimes(1);
});

test('cancelling a block does nothing and a failed block is reported', async () => {
  const api = client();
  const onBlocked = jest.fn();
  confirmBlock(api as never, { riderId: 'rider-2', source: 'chat' }, onBlocked);
  expect(Alert.alert).toHaveBeenLastCalledWith('Block this rider?', expect.any(String), expect.any(Array));
  expect(lastButtons().find((button) => button.text === 'Cancel')?.onPress).toBeUndefined();

  api.blockRider.mockRejectedValueOnce(new Error('offline'));
  press('Block');
  await flush();
  expect(onBlocked).not.toHaveBeenCalled();
  expect(Alert.alert).toHaveBeenLastCalledWith('Couldn’t block rider', expect.any(String));
});

test('the combined menu leads to report and block', () => {
  const api = client();
  openRiderSafetyMenu(api as never, { riderId: 'rider-2', name: 'Maya', source: 'a friend request' });
  expect(Alert.alert).toHaveBeenLastCalledWith('Maya', undefined, expect.any(Array));
  press('Report rider');
  expect(Alert.alert).toHaveBeenLastCalledWith('Report rider', expect.any(String), expect.any(Array));
  openRiderSafetyMenu(api as never, { riderId: 'rider-2', source: 'a friend request' });
  expect(Alert.alert).toHaveBeenLastCalledWith('Rider', undefined, expect.any(Array));
  press('Block rider');
  expect(Alert.alert).toHaveBeenLastCalledWith('Block this rider?', expect.any(String), expect.any(Array));
});
