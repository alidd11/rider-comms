import * as React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { RidingHud } from '../../src/screens/RidingHud';
import { NavigationBanner, NavigationControls, NavigationSpeedBadge, NavigationTripSummary } from '../../src/screens/NavigationOverlay';
import { ArrivalCard, DestinationCard } from '../../src/screens/MapPlaceCards';
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

test('the banner shows the road large, the next road, and notices; End closes it', async () => {
  const onEnd = jest.fn();
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
      onEnd={onEnd}
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
  await fireEvent.press(view.getByRole('button', { name: 'End navigation' }));
  expect(onEnd).toHaveBeenCalled();

  await view.rerender(
    <NavigationBanner
      top={0} upcomingStep={null} followingStep={null} distanceToStepEnd={20} unitSystem="km"
      roadName={null} glanceAction="Arrive" guidanceInstruction="Destination will be on the left"
      roadAlerts={[]} notice="GPS signal lost" onHeight={onHeight} onEnd={onEnd}
    />,
  );
  expect(view.getByText('Arrive')).toBeTruthy();
  expect(view.getByText('Destination will be on the left')).toBeTruthy();
});

test('speed badge, trip summary and the control dock', async () => {
  const onHeight = jest.fn();
  const handlers = { onReport: jest.fn(), onToggleMute: jest.fn(), onOverviewOrFollow: jest.fn() };
  const view = await render(
    <>
      <NavigationSpeedBadge top={0} navigationSpeedMps={null} unitSystem="mi" />
      <NavigationTripSummary bottomPadding={8} arrivalLabel="14:32" remainingSeconds={1080} remainingMeters={11_900} unitSystem="mi" onHeight={onHeight} />
      <NavigationControls bottom={0} canReport muted following {...handlers} />
    </>,
  );
  expect(view.getByLabelText('Current speed unavailable')).toBeTruthy();
  expect(view.getByText('14:32')).toBeTruthy();
  expect(view.getByText('18 min')).toBeTruthy();
  await fireEvent(view.getByTestId('navigation-summary'), 'layout', { nativeEvent: { layout: { height: 104 } } });
  expect(onHeight).toHaveBeenCalled();
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
