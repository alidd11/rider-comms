import * as React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Alert, type AlertButton } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { VoicePeopleSheet, type VoicePeopleSheetProps } from '../../src/voice/VoicePeopleSheet';

const SAFE_AREA_METRICS = {
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
  frame: { x: 0, y: 0, width: 320, height: 640 },
};

async function renderSheet(overrides: Partial<VoicePeopleSheetProps> = {}) {
  const props: VoicePeopleSheetProps = {
    visible: true,
    onClose: jest.fn(),
    client: { reportRider: jest.fn(async () => ({ received: true as const })), blockRider: jest.fn(async () => ({})) },
    peers: new Map([['rider-2', 'Maya'], ['rider-3', 'Jay']]),
    mutedPeers: new Set(['rider-3']),
    statusOf: (peerId) => (peerId === 'rider-3' ? 'Muted' : 'On voice'),
    onToggleMute: jest.fn(),
    onBlocked: jest.fn(),
    ...overrides,
  };
  await render(<SafeAreaProvider initialMetrics={SAFE_AREA_METRICS}><VoicePeopleSheet {...props} /></SafeAreaProvider>);
  return props;
}

function lastButtons(): AlertButton[] {
  const calls = (Alert.alert as jest.Mock).mock.calls;
  return calls[calls.length - 1][2] as AlertButton[];
}

beforeEach(() => {
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

test('lists the most recent rider first with their voice status', async () => {
  await renderSheet();
  const names = screen.getAllByText(/^(Maya|Jay)$/).map((node) => node.props.children);
  expect(names).toEqual(['Jay', 'Maya']);
  expect(screen.getByText('Muted')).toBeTruthy();
  expect(screen.getByText('On voice')).toBeTruthy();
});

test('mute toggles per rider', async () => {
  const props = await renderSheet();
  await fireEvent.press(screen.getByLabelText('Mute Maya'));
  expect(props.onToggleMute).toHaveBeenCalledWith('rider-2');
  await fireEvent.press(screen.getByLabelText('Unmute Jay'));
  expect(props.onToggleMute).toHaveBeenCalledWith('rider-3');
});

test('report records Nearby Voice as the source', async () => {
  const props = await renderSheet();
  await fireEvent.press(screen.getByLabelText('Report Maya'));
  lastButtons().find((button) => button.text === 'Unsafe behaviour')?.onPress?.();
  expect(props.client.reportRider).toHaveBeenCalledWith('rider-2', 'unsafe', 'Reported from Nearby Voice');
});

test('block confirms, then tells the voice host', async () => {
  const props = await renderSheet();
  await fireEvent.press(screen.getByLabelText('Block Maya'));
  expect(Alert.alert).toHaveBeenLastCalledWith('Block Maya?', expect.any(String), expect.any(Array));
  lastButtons().find((button) => button.text === 'Block')?.onPress?.();
  await new Promise((resolve) => setImmediate(resolve));
  expect(props.client.blockRider).toHaveBeenCalledWith('rider-2');
  expect(props.onBlocked).toHaveBeenCalledWith('rider-2');
});

test('close calls back', async () => {
  const props = await renderSheet();
  await fireEvent.press(screen.getByLabelText('Close'));
  expect(props.onClose).toHaveBeenCalled();
});
