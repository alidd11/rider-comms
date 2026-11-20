import * as React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { NavigationRoadAhead } from '../../src/components/NavigationRoadAhead';
import { NavigationNightContext } from '../../src/navigationTone';
import { darkColors, lightColors } from '../../src/theme';
import { NavigationBanner, NavigationControls, NavigationSpeedBadge, NavigationTripSummary } from '../../src/screens/NavigationOverlay';
jest.mock('../../src/screens/useInAppNavigation', () => ({ ROUTE_UPDATED_NOTICE: 'Route updated.' }));
const ROUTE_UPDATED_NOTICE = 'Route updated.';

const step = (instruction: string, maneuver?: string) => ({
  instruction, maneuver, distanceMeters: 500, durationSeconds: 60, coordinates: [{ lat: 0, lon: 0 }],
}) as never;
const alert = { hazard: { id: 'a', type: 'camera', lat: 0, lon: 0 }, distanceAheadMeters: 965 } as never;

function screen(night: boolean, notice: string | null) {
  return (
    <NavigationNightContext.Provider value={night}>
      <NavigationBanner
        top={0}
        upcomingStep={step('Turn right onto Camden Rd', 'turn-right')}
        followingStep={step('Turn left onto Caledonian Rd', 'turn-left')}
        distanceToStepEnd={965}
        unitSystem="mi"
        roadName={null}
        glanceAction="Turn right"
        guidanceInstruction="Turn right onto Camden Rd"
        roadAlerts={[alert]}
        notice={notice}
        onHeight={() => {}}
      />
      <NavigationSpeedBadge bottom={0} navigationSpeedMps={12} unitSystem="mi" />
      <NavigationTripSummary bottomPadding={0} arrivalLabel="11:08" remainingSeconds={1740} remainingMeters={7400} unitSystem="mi" onHeight={() => {}} onEnd={() => {}} />
    </NavigationNightContext.Provider>
  );
}

const background = (node: { props: Record<string, unknown> }) => StyleSheet.flatten(node.props.style as never)?.backgroundColor;

test('navigation cards take the dark colours over the night map, whatever the phone theme', async () => {
  const view = await render(screen(true, 'GPS signal lost'));
  expect(background(view.getByTestId('navigation-summary'))).toBe(darkColors.surface);
  // The turn banner is the guidance colour day and night, as in Google Maps.
  expect(background(view.getByTestId('navigation-banner'))).toBe(darkColors.guidance);
  expect(StyleSheet.flatten(view.getByText('11:08').props.style).color).toBe(darkColors.success);
  expect(StyleSheet.flatten(view.getByText('Reports ahead').props.style).color).toBe(darkColors.textMuted);
  expect(view.getByText('GPS signal lost')).toBeTruthy();

  const info = await render(screen(true, ROUTE_UPDATED_NOTICE));
  expect(info.getByText(ROUTE_UPDATED_NOTICE)).toBeTruthy();
});

test('by day the cards keep the theme colours', async () => {
  const view = await render(screen(false, ROUTE_UPDATED_NOTICE));
  expect(background(view.getByTestId('navigation-summary'))).not.toBe(darkColors.surface);
  expect(background(view.getByTestId('navigation-banner'))).toBe(lightColors.guidance);
  expect(StyleSheet.flatten(view.getByText('11:08').props.style).color).not.toBe(darkColors.success);
});

test('road ahead outside navigation uses the day look', async () => {
  const view = await render(<NavigationRoadAhead alerts={[alert]} unit="mi" />);
  expect(StyleSheet.flatten(view.getByText('Reports ahead').props.style).color).not.toBe(darkColors.textMuted);
});

test('the trip card offers the other ways there, and says when traffic adds time', async () => {
  const onChooseRoute = jest.fn();
  const choices = [
    { index: 0, label: 'Fastest', text: 'Fastest · 23 min' },
    { index: 1, label: 'Twisty', text: 'Twisty · 29 min · +6 min' },
  ] as const;
  const view = await render(
    <NavigationNightContext.Provider value>
      <NavigationTripSummary
        bottomPadding={0} arrivalLabel="11:08" remainingSeconds={1380} remainingMeters={7400} unitSystem="mi" onHeight={() => {}} onEnd={() => {}}
        routeChoices={[...choices]} chosenRouteIndex={0} onChooseRoute={onChooseRoute} trafficText="+8 min traffic"
      />
    </NavigationNightContext.Provider>,
  );
  expect(view.getByRole('radio', { name: 'Fastest · 23 min' }).props.accessibilityState).toEqual({ selected: true });
  expect(view.getByRole('radio', { name: 'Twisty · 29 min · +6 min' }).props.accessibilityState).toEqual({ selected: false });
  await fireEvent.press(view.getByText('Twisty · 29 min · +6 min'));
  expect(onChooseRoute).toHaveBeenCalledWith(1);
  expect(view.getByTestId('navigation-traffic').props.children).toBe('+8 min traffic');

  // One way, or none offered: no choices and no traffic line.
  await view.rerender(<NavigationTripSummary bottomPadding={0} arrivalLabel="11:08" remainingSeconds={1380} remainingMeters={7400} unitSystem="mi" onHeight={() => {}} routeChoices={[choices[0]]} onChooseRoute={onChooseRoute} onEnd={() => {}} />);
  expect(view.queryByTestId('navigation-route-choices')).toBeNull();
  expect(view.queryByTestId('navigation-traffic')).toBeNull();
});

test('the petrol-on-the-way button shows only where reporting is allowed', async () => {
  const onFindStops = jest.fn();
  const controls = (canReport: boolean) => (
    <NavigationControls bottom={0} canReport={canReport} muted={false} following onReport={() => {}} onToggleMute={() => {}} onOverviewOrFollow={() => {}} onFindStops={onFindStops} />
  );
  const view = await render(controls(true));
  await fireEvent.press(view.getByLabelText('Find petrol and stops on the way'));
  expect(onFindStops).toHaveBeenCalled();
  await view.rerender(controls(false));
  expect(view.queryByLabelText('Find petrol and stops on the way')).toBeNull();
});

test('the trip card opens while parked with the turns left, Add stop, Share ETA and End', async () => {
  const onAddStop = jest.fn();
  const onShareEta = jest.fn();
  const onEnd = jest.fn();
  const details = { upcomingSteps: [step('Turn left onto High Street', 'turn-left')], destinationLabel: 'Home', onAddStop, onShareEta };
  const summary = (tripDetails?: typeof details) => (
    <NavigationTripSummary bottomPadding={0} arrivalLabel="11:08" remainingSeconds={1740} remainingMeters={7400} unitSystem="mi" onHeight={() => {}} onEnd={onEnd} tripDetails={tripDetails} />
  );
  const view = await render(summary(details));
  expect(view.queryByTestId('navigation-trip-details')).toBeNull();
  await fireEvent.press(view.getByLabelText('Show trip details'));
  expect(view.getByText('Turn left onto High Street')).toBeTruthy();
  expect(view.getByText('Arrive at Home')).toBeTruthy();
  await fireEvent.press(view.getByLabelText('Share ETA'));
  expect(onShareEta).toHaveBeenCalledTimes(1);
  await fireEvent.press(view.getByLabelText('End navigation from trip details'));
  expect(onEnd).toHaveBeenCalledTimes(1);
  await fireEvent.press(view.getByLabelText('Add stop'));
  expect(onAddStop).toHaveBeenCalledTimes(1);
  expect(view.queryByTestId('navigation-trip-details')).toBeNull();

  // Ride Safe leaves the details out: the handle is no longer a button and the card folds away.
  await fireEvent.press(view.getByLabelText('Show trip details'));
  expect(view.getByTestId('navigation-trip-details')).toBeTruthy();
  await view.rerender(summary(undefined));
  expect(view.queryByTestId('navigation-trip-details')).toBeNull();
  expect(view.queryByLabelText('Show trip details')).toBeNull();
  await view.rerender(summary({ ...details, upcomingSteps: [], destinationLabel: '' }));
  await fireEvent.press(view.getByLabelText('Show trip details'));
  expect(view.getByText('Arrive at your destination')).toBeTruthy();
});
