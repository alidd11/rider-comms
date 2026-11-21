import * as React from 'react';
import { StyleSheet } from 'react-native';
import type { HazardType } from '@rider-comms/shared';
import { act, fireEvent, render } from '@testing-library/react-native';
import { RidingHud } from '../../src/screens/RidingHud';
import { NavigationBanner, NavigationControls, NavigationRecentreButton, NavigationSpeedBadge, NavigationTripSummary } from '../../src/screens/NavigationOverlay';
import { ArrivalCard, DestinationCard, RoutePreviewSheet, RoutePreviewTopBar } from '../../src/screens/MapPlaceCards';
import { ROUTE_UPDATED_NOTICE } from '../../src/screens/useInAppNavigation';

jest.mock('../../src/screens/useInAppNavigation', () => ({ ROUTE_UPDATED_NOTICE: 'Route updated.' }));

const step = (instruction: string, maneuver = 'turn-right') => ({
  instruction, maneuver, distanceMeters: 100, durationSeconds: 10, start: { lat: 0, lon: 0 }, end: { lat: 0, lon: 0 }, coordinates: [],
}) as never;

test('the riding HUD shows speed, the group and glove-sized Mute and Hazard', async () => {
  const onToggleMute = jest.fn();
  const onReport = jest.fn();
  const view = await render(
    <RidingHud top={0} bottom={0} inRide rosterCount={3} speed={42} unitSystem="mi" voiceConnected voiceMuted={false} onToggleMute={onToggleMute} onReport={onReport} />,
  );
  expect(view.getByText('3 in ride')).toBeTruthy();
  expect(view.getByLabelText('Current speed 42 miles per hour')).toBeTruthy();
  await fireEvent.press(view.getByRole('button', { name: 'Mute your microphone' }));
  await fireEvent.press(view.getByRole('button', { name: 'Report on the road' }));
  expect(onToggleMute).toHaveBeenCalled();
  expect(onReport).toHaveBeenCalled();

  await view.rerender(
    <RidingHud top={0} bottom={0} inRide rosterCount={0} speed={null} unitSystem="km" voiceConnected={false} voiceMuted onToggleMute={onToggleMute} onReport={onReport} />,
  );
  expect(view.getByText('Group ride')).toBeTruthy();
  expect(view.getByLabelText('Current speed unavailable')).toBeTruthy();
  expect(view.queryByRole('button', { name: /microphone/ })).toBeNull();
});

test('the banner shows the road large, the next road, and notices', async () => {
  const onHeight = jest.fn();
  const view = await render(
    <NavigationBanner
      top={0}
      upcomingStep={step('Turn right onto Camden Rd/A503')}
      followingStep={step('Turn left onto Caledonian Rd/A5203', 'turn-left')}
      distanceToStepEnd={965}
      unitSystem="mi"
      roadName="Camden Rd / A503"
      glanceAction="Turn right"
      guidanceInstruction="Turn right onto Camden Rd/A503"
      roadAlerts={[]}
      notice={ROUTE_UPDATED_NOTICE}
      onHeight={onHeight}
    />,
  );
  expect(view.getByText('Camden Rd / A503')).toBeTruthy();
  expect(view.getByText('Caledonian Rd / A5203')).toBeTruthy();
  expect(view.getByLabelText('Route updated.')).toBeTruthy();
  // The banner reports its height, ignoring sub-pixel jitter.
  await fireEvent(view.getByTestId('navigation-banner'), 'layout', { nativeEvent: { layout: { height: 180.4 } } });
  const update = onHeight.mock.calls[0][0] as (current: number) => number;
  expect(update(0)).toBe(181);
  expect(update(180.5)).toBe(180.5);
  await view.rerender(
    <NavigationBanner
      top={0} upcomingStep={null} followingStep={null} distanceToStepEnd={20} unitSystem="km"
      roadName={null} glanceAction="Arrive" guidanceInstruction="Destination will be on the left"
      roadAlerts={[]} notice="GPS signal lost" onHeight={onHeight}
    />,
  );
  expect(view.getByText('Arrive')).toBeTruthy();
  expect(view.getByText('Destination will be on the left')).toBeTruthy();
});

test('speed badge, trip summary and the control dock', async () => {
  const onHeight = jest.fn();
  const onEnd = jest.fn();
  const onRecentre = jest.fn();
  const handlers = { onReport: jest.fn(), onToggleMute: jest.fn(), onOverviewOrFollow: jest.fn() };
  const view = await render(
    <>
      <NavigationSpeedBadge bottom={0} navigationSpeedMps={null} unitSystem="mi" />
      <NavigationTripSummary bottomPadding={8} arrivalLabel="14:32" remainingSeconds={1080} remainingMeters={11_900} unitSystem="mi" onHeight={onHeight} onEnd={onEnd} />
      <NavigationRecentreButton bottom={0} onPress={onRecentre} />
      <NavigationControls bottom={0} canReport muted following {...handlers} />
    </>,
  );
  expect(view.getByLabelText('Current speed unavailable')).toBeTruthy();
  expect(view.getByText('14:32')).toBeTruthy();
  expect(view.getByText('18 min')).toBeTruthy();
  await fireEvent(view.getByTestId('navigation-summary'), 'layout', { nativeEvent: { layout: { height: 104 } } });
  expect(onHeight).toHaveBeenCalled();
  await fireEvent.press(view.getByRole('button', { name: 'End navigation' }));
  expect(onEnd).toHaveBeenCalled();
  await fireEvent.press(view.getByRole('button', { name: 'Re-centre' }));
  expect(onRecentre).toHaveBeenCalled();
  await fireEvent.press(view.getByRole('button', { name: 'Report on the road' }));
  await fireEvent.press(view.getByRole('button', { name: 'Unmute navigation guidance' }));
  await fireEvent.press(view.getByRole('button', { name: 'Show route overview' }));
  expect(handlers.onReport).toHaveBeenCalled();
  expect(handlers.onToggleMute).toHaveBeenCalled();
  expect(handlers.onOverviewOrFollow).toHaveBeenCalled();

  await view.rerender(<NavigationControls bottom={0} canReport={false} muted={false} following={false} {...handlers} />);
  expect(view.queryByRole('button', { name: 'Report on the road' })).toBeNull();
  expect(view.getByRole('button', { name: 'Resume navigation follow mode' })).toBeTruthy();
});

test('the voice button while navigating: tap to mute, hold for Leave Nearby Voice', async () => {
  const voice = { muted: false, onToggleMute: jest.fn(), onMore: jest.fn() };
  const handlers = { onReport: jest.fn(), onToggleMute: jest.fn(), onOverviewOrFollow: jest.fn() };
  const view = await render(<NavigationControls bottom={0} canReport={false} muted={false} following {...handlers} voice={voice} />);
  // Shown on the move too (canReport false): it only makes the rider less exposed.
  const button = view.getByTestId('navigation-voice');
  expect(button.props.accessibilityLabel).toBe('Mute your microphone');
  await fireEvent.press(button);
  expect(voice.onToggleMute).toHaveBeenCalledTimes(1);
  await fireEvent(button, 'longPress');
  expect(voice.onMore).toHaveBeenCalledTimes(1);
  await fireEvent(button, 'accessibilityAction', { nativeEvent: { actionName: 'longpress' } });
  expect(voice.onMore).toHaveBeenCalledTimes(2);
  await fireEvent(button, 'accessibilityAction', { nativeEvent: { actionName: 'activate' } });
  expect(voice.onMore).toHaveBeenCalledTimes(2);
  await view.rerender(<NavigationControls bottom={0} canReport={false} muted={false} following {...handlers} voice={{ ...voice, muted: true }} />);
  expect(view.getByTestId('navigation-voice').props.accessibilityLabel).toBe('Unmute your microphone');
  // No voice on: no button.
  await view.rerender(<NavigationControls bottom={0} canReport={false} muted={false} following {...handlers} voice={null} />);
  expect(view.queryByTestId('navigation-voice')).toBeNull();
});

test('place cards: arrival, and a destination with the host’s regroup action', async () => {
  const onDone = jest.fn();
  const arrival = await render(<ArrivalCard bottom={0} arrival={{ label: 'Cafe', seconds: 1440, distanceMeters: 13_360 }} unitSystem="mi" onDone={onDone} />);
  expect(arrival.getByText('24 min · 8.3 mi')).toBeTruthy();
  await fireEvent.press(arrival.getByRole('button', { name: 'Done' }));
  expect(onDone).toHaveBeenCalled();

  const handlers = { onDismiss: jest.fn(), onStartRoute: jest.fn(), onToggleRegroup: jest.fn() };
  const props = {
    bottom: 0, destination: { lat: 51.5, lon: -0.1, label: 'Esso' }, subtitle: 'Holloway Rd', isRegroup: false,
    eta: { distanceMeters: 3200, durationSeconds: 420 }, unitSystem: 'mi' as const, providerLabel: 'In Rider Comms',
    loading: false, isHost: true, regroupSaving: false, regroupError: true, ...handlers,
  };
  const card = await render(<DestinationCard {...props} />);
  expect(card.getByText('2.0 mi · 7 min')).toBeTruthy();
  expect(card.getByText('Couldn’t reach Rider Comms. Check your connection and try again.')).toBeTruthy();
  await fireEvent.press(card.getByRole('button', { name: 'Start route to Esso' }));
  await fireEvent.press(card.getByRole('button', { name: 'Ask the group to regroup at Esso' }));
  await fireEvent.press(card.getByRole('button', { name: 'Dismiss destination' }));
  expect(handlers.onStartRoute).toHaveBeenCalled();
  expect(handlers.onToggleRegroup).toHaveBeenCalled();
  expect(handlers.onDismiss).toHaveBeenCalled();

  await card.rerender(<DestinationCard {...props} destination={{ lat: 51.5, lon: -0.1 }} isRegroup eta={null} loading isHost regroupError={false} />);
  expect(card.getByText('Calculating route…')).toBeTruthy();
  expect(card.getByRole('button', { name: 'Starting route to selected place' })).toBeTruthy();
  expect(card.getByRole('button', { name: 'Clear the regroup point' })).toBeTruthy();

  await card.rerender(<DestinationCard {...props} isHost={false} />);
  expect(card.queryByText('Regroup here')).toBeNull();
});

const previewRoute = (durationSeconds: number, distanceMeters: number, summary?: string, typicalDurationSeconds?: number) => ({
  coordinates: [],
  steps: [
    { instruction: 'Head north on Mill Lane', distanceMeters: 640, durationSeconds: 60, start: { lat: 0, lon: 0 }, end: { lat: 0, lon: 0 }, coordinates: [] },
    { instruction: 'Turn right onto A41', distanceMeters: 13_200, durationSeconds: 600, start: { lat: 0, lon: 0 }, end: { lat: 0, lon: 0 }, coordinates: [] },
  ],
  durationSeconds,
  distanceMeters,
  ...(summary ? { summary } : {}),
  ...(typicalDurationSeconds ? { typicalDurationSeconds } : {}),
});

const PREVIEW = {
  target: { lat: 51.5, lon: -0.1, label: 'Home' },
  style: 'fastest' as const,
  routes: [previewRoute(23 * 60, 17_700, 'A41', 15 * 60), previewRoute(29 * 60, 24_100, undefined, 29 * 60)],
  choices: [
    { index: 0, label: 'Fastest' as const, text: 'Fastest · 23 min', time: '23 min', tag: 'Fastest' },
    { index: 1, label: 'Twisty' as const, text: 'Twisty · 29 min · +6 min', time: '29 min', tag: 'Twisty · +6 min' },
  ],
  index: 0,
};

test('the route preview card: the chosen way, Start, Share, the other ways, and three sizes', async () => {
  const onChoose = jest.fn();
  const onStart = jest.fn();
  const onShare = jest.fn();
  const sheet = (extra: Partial<React.ComponentProps<typeof RoutePreviewSheet>> = {}) => (
    <RoutePreviewSheet bottom={0} preview={PREVIEW} unitSystem="mi" onChoose={onChoose} onStart={onStart} onShare={onShare} {...extra} />
  );
  const view = await render(sheet());
  expect(view.getByText('23 min')).toBeTruthy();
  expect(view.getByText('11 mi')).toBeTruthy();
  expect(view.getByText('Fastest')).toBeTruthy();
  expect(view.getByText(/^Arrive .+ · via A41$/)).toBeTruthy();
  expect(view.getByText('Fastest despite +8 min of traffic')).toBeTruthy();
  expect(view.getByText('1 other route')).toBeTruthy();
  expect(view.queryByTestId('route-preview-ride')).toBeNull();
  // No turn list before Start: the other ways open on demand.
  expect(view.queryByRole('button', { name: 'Steps' })).toBeNull();
  expect(view.queryByText('Turn right onto A41')).toBeNull();
  expect(view.queryByTestId('route-preview-details')).toBeNull();

  await fireEvent.press(view.getByRole('button', { name: 'Start route to Home' }));
  expect(onStart).toHaveBeenCalled();
  await fireEvent.press(view.getByRole('button', { name: 'Share route' }));
  expect(onShare).toHaveBeenCalledTimes(1);

  await fireEvent.press(view.getByTestId('route-preview-more'));
  expect(view.getByTestId('route-preview-details')).toBeTruthy();
  expect(view.getByText('Hide other routes')).toBeTruthy();
  const fastest = view.getByTestId('route-preview-row-0');
  expect(fastest.props.accessibilityState).toEqual({ selected: true });
  expect(fastest.props.accessibilityLabel).toMatch(/^Fastest · 23 min, arrive .+, 11 mi, via A41, \+8 min traffic$/);
  expect(view.getByText('TWISTY · +6 MIN')).toBeTruthy();
  // The chosen one again does nothing; another one is chosen.
  await fireEvent.press(fastest);
  expect(onChoose).not.toHaveBeenCalled();
  await fireEvent.press(view.getByTestId('route-preview-row-1'));
  expect(onChoose).toHaveBeenCalledWith(1);
  await fireEvent.press(view.getByTestId('route-preview-more'));
  expect(view.queryByTestId('route-preview-details')).toBeNull();

  // The handle: the chosen way → every way → the chosen way.
  const handle = () => view.getByTestId('route-preview-handle');
  expect(handle().props.accessibilityLabel).toBe('Show the other routes');
  await fireEvent.press(handle());
  expect(view.getByTestId('route-preview-details')).toBeTruthy();
  expect(handle().props.accessibilityLabel).toBe('Hide the other routes');
  await fireEvent.press(handle());
  expect(view.queryByTestId('route-preview-details')).toBeNull();

});

test('the route preview card: swipe sizes, the small card, twisty and group rides', async () => {
  const onShare = jest.fn();
  const pans: Array<{ onMoveShouldSetPanResponder: (e: unknown, g: { dx: number; dy: number }) => boolean; onPanResponderRelease: (e: unknown, g: { dx: number; dy: number }) => void }> = [];
  const { PanResponder } = jest.requireActual<typeof import('react-native')>('react-native');
  const create = jest.spyOn(PanResponder, 'create').mockImplementation((config) => {
    pans.push(config as (typeof pans)[number]);
    return { panHandlers: {} } as ReturnType<typeof PanResponder.create>;
  });
  const sheet = (extra: Partial<React.ComponentProps<typeof RoutePreviewSheet>> = {}) => (
    <RoutePreviewSheet bottom={0} preview={PREVIEW} unitSystem="mi" onChoose={jest.fn()} onStart={jest.fn()} onShare={onShare} {...extra} />
  );
  const view = await render(sheet());
  const pan = () => pans[pans.length - 1]!;
  expect(pan().onMoveShouldSetPanResponder(null, { dx: 0, dy: 5 })).toBe(false);
  expect(pan().onMoveShouldSetPanResponder(null, { dx: 40, dy: 20 })).toBe(false);
  expect(pan().onMoveShouldSetPanResponder(null, { dx: 2, dy: 30 })).toBe(true);

  // A short drag does nothing; down to the small card: time and Start only.
  await act(() => pan().onPanResponderRelease(null, { dx: 0, dy: 20 }));
  expect(view.getByText('1 other route')).toBeTruthy();
  await act(() => pan().onPanResponderRelease(null, { dx: 0, dy: 80 }));
  expect(view.getByText('23 min')).toBeTruthy();
  expect(view.getByTestId('route-preview-start')).toBeTruthy();
  expect(view.queryByText(/^Arrive /)).toBeNull();
  expect(view.queryByText('Fastest despite +8 min of traffic')).toBeNull();
  expect(view.queryByRole('button', { name: 'Share route' })).toBeNull();
  expect(view.queryByTestId('route-preview-more')).toBeNull();
  expect(view.getByTestId('route-preview-handle').props.accessibilityLabel).toBe('Show the route details');
  // Already as small as it goes.
  await act(() => pan().onPanResponderRelease(null, { dx: 0, dy: 80 }));
  expect(view.queryByTestId('route-preview-more')).toBeNull();
  // Up: the chosen way, then every way, then no further.
  await act(() => pan().onPanResponderRelease(null, { dx: 0, dy: -80 }));
  expect(view.getByText('1 other route')).toBeTruthy();
  await act(() => pan().onPanResponderRelease(null, { dx: 0, dy: -80 }));
  expect(view.getByTestId('route-preview-details')).toBeTruthy();
  await act(() => pan().onPanResponderRelease(null, { dx: 0, dy: -80 }));
  expect(view.getByTestId('route-preview-details')).toBeTruthy();
  // The handle from the small card goes back to the chosen way.
  await act(() => pan().onPanResponderRelease(null, { dx: 0, dy: 80 }));
  await act(() => pan().onPanResponderRelease(null, { dx: 0, dy: 80 }));
  await fireEvent.press(view.getByTestId('route-preview-handle'));
  expect(view.getByText('1 other route')).toBeTruthy();

  // The twisty way chosen: usual traffic.
  await view.rerender(sheet({ preview: { ...PREVIEW, index: 1 } }));
  expect(view.getByText('Usual traffic')).toBeTruthy();
  // Twisty asked for, but nothing bendier than the fastest way.
  await view.rerender(sheet({ preview: { ...PREVIEW, style: 'twisty' } }));
  expect(view.getByText('Also the twistiest way Google found')).toBeTruthy();
  expect(view.queryByText('Fastest despite +8 min of traffic')).toBeNull();

  // While Google is asked again, Start can't be pressed.
  await view.rerender(sheet({ replanning: true }));
  expect(view.getByTestId('route-preview-start').props.accessibilityState).toEqual({ disabled: true });

  // In a group ride: who's in it, and Share route.
  await view.rerender(sheet({ ride: { count: 3, avatars: [] } }));
  expect(view.getByText('Group ride · 3 riders')).toBeTruthy();
  await fireEvent.press(view.getByRole('button', { name: 'Share route with the group' }));
  expect(onShare).toHaveBeenCalledTimes(1);
  await view.rerender(sheet({ ride: { count: 1, avatars: [] } }));
  expect(view.getByText('Group ride · 1 rider')).toBeTruthy();

  // A place with no name, one way, no traffic figure: the handle makes the
  // card smaller and back, as there are no other ways to show.
  await view.rerender(sheet({ preview: { ...PREVIEW, target: { lat: 51.5, lon: -0.1 }, routes: [previewRoute(600, 900)], choices: [{ ...PREVIEW.choices[0]!, time: '10 min' }] } }));
  expect(view.getByRole('button', { name: 'Start route to Selected place' })).toBeTruthy();
  expect(view.getByText('Fastest route')).toBeTruthy();
  expect(view.queryByTestId('route-preview-more')).toBeNull();
  expect(view.getByText(/^Arrive \S+/)).toBeTruthy();
  expect(view.getByTestId('route-preview-handle').props.accessibilityLabel).toBe('Make the card smaller');
  await fireEvent.press(view.getByTestId('route-preview-handle'));
  expect(view.queryByText(/^Arrive /)).toBeNull();
  await act(() => pan().onPanResponderRelease(null, { dx: 0, dy: -80 }));
  await act(() => pan().onPanResponderRelease(null, { dx: 0, dy: -80 }));
  expect(view.getByText(/^Arrive \S+/)).toBeTruthy();
  expect(view.queryByTestId('route-preview-details')).toBeNull();
  create.mockRestore();
});

test('the route preview card: what riders reported, along a line from you to the destination', async () => {
  const report = (id: string, type: HazardType, lat: number) => ({
    id, type, lat, lon: -0.1, reportedBy: 'rider', createdAt: 1, expiresAt: Number.MAX_SAFE_INTEGER, confirmations: 0, denials: 0,
  });
  const line = [{ lat: 51.5, lon: -0.1 }, { lat: 51.51, lon: -0.1 }];
  const preview = {
    ...PREVIEW,
    routes: [{ ...PREVIEW.routes[0]!, coordinates: line }, PREVIEW.routes[1]!],
  };
  const sheet = (hazards: ReturnType<typeof report>[]) => (
    <RoutePreviewSheet bottom={0} preview={preview} unitSystem="mi" hazards={hazards} onChoose={jest.fn()} onStart={jest.fn()} onShare={jest.fn()} />
  );
  const view = await render(sheet([report('p', 'police', 51.5025)]));
  // On the line where it is, a quarter of the way; read out as one sentence.
  const strip = () => view.getByTestId('route-preview-hazards');
  expect(strip().props.accessibilityLabel).toBe('Reported on the way: police');
  const at = (type: string) => StyleSheet.flatten(view.getByTestId(`route-hazard-marker-${type}`).props.style);
  expect(at('police').left).toBe('25%');
  await fireEvent.press(view.getByTestId('route-preview-more'));
  expect(view.getByTestId('route-preview-row-0').props.accessibilityLabel).toMatch(/, reported on the way: police$/);
  expect(view.getByTestId('route-preview-row-1').props.accessibilityLabel).not.toMatch(/reported/);
  expect(view.getByTestId('route-hazard-police', { includeHiddenElements: true })).toBeTruthy();

  // Two close together share an icon, the most serious, with a count; one
  // further on has its own; closures are ringed red.
  await view.rerender(sheet([report('p', 'police', 51.5025), report('c', 'road_closure', 51.503), report('k', 'camera', 51.509)]));
  expect(strip().props.accessibilityLabel).toBe('Reported on the way: road closure, speed camera, police');
  expect(view.queryByTestId('route-hazard-marker-police')).toBeNull();
  expect(at('road_closure').left).toBe('27.5%');
  expect(at('camera').left).toBe('90%');
  expect(at('road_closure').borderColor).not.toBe(at('camera').borderColor);
  expect(view.getAllByText('2').length).toBeGreaterThan(0);
  // In the list, small icons, one per kind; five kinds show four, then +1.
  await view.rerender(sheet([
    report('p', 'police', 51.501), report('c', 'road_closure', 51.502), report('a', 'accident', 51.503),
    report('k', 'camera', 51.504), report('h', 'hidden_police', 51.506), report('h2', 'hidden_police', 51.5095),
  ]));
  expect(view.getAllByText('+1', { includeHiddenElements: true }).length).toBeGreaterThan(0);
  expect(view.queryByTestId('route-hazard-hidden_police', { includeHiddenElements: true })).toBeNull();
  expect(view.getByTestId('route-hazard-road_closure', { includeHiddenElements: true })).toBeTruthy();
  await view.rerender(sheet([]));
  expect(view.queryByTestId('route-preview-hazards')).toBeNull();
});

test('the route preview card: a stop added before Start, and taking it out again', async () => {
  const onRemoveStop = jest.fn();
  const shell = { lat: 51.5, lon: -0.1, label: 'Shell' };
  const sheet = (extra: Partial<React.ComponentProps<typeof RoutePreviewSheet>> = {}) => (
    <RoutePreviewSheet bottom={0} preview={{ ...PREVIEW, stop: shell }} unitSystem="mi" onChoose={jest.fn()} onStart={jest.fn()} onShare={jest.fn()} onRemoveStop={onRemoveStop} {...extra} />
  );
  const view = await render(sheet());
  expect(view.getByText('Stop: Shell')).toBeTruthy();
  await fireEvent.press(view.getByRole('button', { name: 'Remove the stop at Shell' }));
  expect(onRemoveStop).toHaveBeenCalledTimes(1);
  // While Google is asked again, it waits.
  await view.rerender(sheet({ replanning: true }));
  expect(view.getByRole('button', { name: 'Remove the stop at Shell' }).props.accessibilityState).toEqual({ disabled: true });
  // Without the handler (nothing to take out), no button; no stop, no row.
  await view.rerender(sheet({ onRemoveStop: undefined }));
  expect(view.queryByRole('button', { name: /Remove the stop/ })).toBeNull();
  await view.rerender(sheet({ preview: PREVIEW }));
  expect(view.queryByTestId('route-preview-stop')).toBeNull();
});

test('the route preview bar: back, another destination, and Route options', async () => {
  const onBack = jest.fn();
  const onChangeDestination = jest.fn();
  const onStyle = jest.fn();
  const onToggleAvoid = jest.fn();
  const bar = (extra: Partial<React.ComponentProps<typeof RoutePreviewTopBar>> = {}) => (
    <RoutePreviewTopBar
      top={0} preview={PREVIEW} avoidance={{ highways: false, tolls: true, ferries: false }}
      onBack={onBack} onChangeDestination={onChangeDestination} onStyle={onStyle} onToggleAvoid={onToggleAvoid} {...extra}
    />
  );
  const view = await render(bar());
  expect(view.getByText('Your location')).toBeTruthy();
  await fireEvent.press(view.getByRole('button', { name: 'Back to the place' }));
  expect(onBack).toHaveBeenCalled();
  await fireEvent.press(view.getByRole('button', { name: 'Change destination, now Home' }));
  expect(onChangeDestination).toHaveBeenCalled();

  // Riding style and Avoid live behind the options button.
  const options = () => view.getByTestId('route-preview-options');
  expect(options().props.accessibilityLabel).toBe('Route options, Fastest, avoiding tolls or ferries');
  expect(view.getByText('1')).toBeTruthy();
  expect(view.queryByTestId('route-preview-style-fastest')).toBeNull();
  await fireEvent.press(options());
  expect(view.getByText('How to get there')).toBeTruthy();
  expect(view.getByTestId('route-preview-style-fastest').props.accessibilityState).toEqual({ selected: true, disabled: false });
  await fireEvent.press(view.getByTestId('route-preview-style-fastest'));
  expect(onStyle).not.toHaveBeenCalled();
  expect(view.getByRole('switch', { name: 'Avoid tolls' }).props.accessibilityState).toEqual({ checked: true, disabled: false });
  expect(view.getByText('✓ Tolls')).toBeTruthy();
  // Avoid changes keep the menu open; a style closes it.
  await fireEvent.press(view.getByRole('switch', { name: 'Avoid ferries' }));
  expect(onToggleAvoid).toHaveBeenCalledWith('ferries');
  expect(view.getByText('How to get there')).toBeTruthy();
  await fireEvent.press(view.getByTestId('route-preview-style-twisty'));
  expect(onStyle).toHaveBeenCalledWith('twisty');
  expect(view.queryByText('How to get there')).toBeNull();

  // A style other than Fastest counts too.
  await view.rerender(bar({ preview: { ...PREVIEW, style: 'no_motorways' } }));
  expect(options().props.accessibilityLabel).toBe('Route options, No motorways, avoiding tolls or ferries');
  expect(view.getByText('2')).toBeTruthy();

  // Add a stop sits above Route options; once there's a stop, it goes.
  expect(view.queryByRole('button', { name: 'Add a stop' })).toBeNull();
  const onAddStop = jest.fn();
  await view.rerender(bar({ onAddStop }));
  await fireEvent.press(view.getByRole('button', { name: 'Add a stop' }));
  expect(onAddStop).toHaveBeenCalledTimes(1);
  await view.rerender(bar({ onAddStop, replanning: true }));
  expect(view.getByTestId('route-preview-add-stop').props.accessibilityState).toEqual({ disabled: true });
  await view.rerender(bar({ onAddStop, preview: { ...PREVIEW, stop: { lat: 51.5, lon: -0.1, label: 'Shell' } } }));
  expect(view.queryByRole('button', { name: 'Add a stop' })).toBeNull();

  // While Google is asked again, the options wait; nothing changed reads plainly.
  await view.rerender(bar({ replanning: true, avoidance: { highways: false, tolls: false, ferries: false }, preview: { ...PREVIEW, target: { lat: 0, lon: 0 } } }));
  expect(options().props.accessibilityLabel).toBe('Route options, Fastest');
  expect(view.queryByText('1')).toBeNull();
  expect(view.getByText('Selected place')).toBeTruthy();
  await fireEvent.press(options());
  expect(view.getByTestId('route-preview-style-twisty').props.accessibilityState).toEqual({ selected: false, disabled: true });
  await fireEvent.press(options());
  expect(view.queryByTestId('route-preview-style-twisty')).toBeNull();
});
