import * as React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import { NavigationRoadAhead } from '../../src/components/NavigationRoadAhead';
import { NavigationNightContext } from '../../src/navigationTone';
import { darkColors } from '../../src/theme';
import { NavigationBanner, NavigationSpeedBadge, NavigationTripSummary } from '../../src/screens/NavigationOverlay';
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
        onEnd={() => {}}
      />
      <NavigationSpeedBadge top={0} navigationSpeedMps={12} unitSystem="mi" />
      <NavigationTripSummary bottomPadding={0} arrivalLabel="11:08" remainingSeconds={1740} remainingMeters={7400} unitSystem="mi" onHeight={() => {}} />
    </NavigationNightContext.Provider>
  );
}

const background = (node: { props: { style: unknown } }) => StyleSheet.flatten(node.props.style as never)?.backgroundColor;

test('navigation cards take the dark colours over the night map, whatever the phone theme', async () => {
  const view = await render(screen(true, 'GPS signal lost'));
  expect(background(view.getByTestId('navigation-summary'))).toBe(darkColors.surface);
  expect(background(view.getByTestId('navigation-banner'))).toBe(darkColors.surface);
  expect(StyleSheet.flatten(view.getByText('11:08').props.style).color).toBe(darkColors.success);
  expect(StyleSheet.flatten(view.getByText('Reports ahead').props.style).color).toBe(darkColors.textMuted);
  expect(view.getByText('GPS signal lost')).toBeTruthy();

  const info = await render(screen(true, ROUTE_UPDATED_NOTICE));
  expect(info.getByText(ROUTE_UPDATED_NOTICE)).toBeTruthy();
});

test('by day the cards keep the theme colours', async () => {
  const view = await render(screen(false, ROUTE_UPDATED_NOTICE));
  expect(background(view.getByTestId('navigation-summary'))).not.toBe(darkColors.surface);
  expect(StyleSheet.flatten(view.getByText('11:08').props.style).color).not.toBe(darkColors.success);
});

test('road ahead outside navigation uses the day look', async () => {
  const view = await render(<NavigationRoadAhead alerts={[alert]} unit="mi" />);
  expect(StyleSheet.flatten(view.getByText('Reports ahead').props.style).color).not.toBe(darkColors.textMuted);
});
