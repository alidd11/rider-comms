import { canDropPin, droppedPinPlace } from '../../src/search/droppedPin';

test('a dropped pin is a place named for what it is, at its coordinates', () => {
  expect(droppedPinPlace(51.541234, -0.278911)).toEqual({
    id: 'pin:51.54123, -0.27891', name: 'Dropped pin', address: '51.54123, -0.27891',
    lat: 51.541234, lon: -0.278911, distanceMeters: 0,
  });
});

test('a pin is dropped only on a parked map', () => {
  expect(canDropPin(false, false)).toBe(true);
  expect(canDropPin(true, false)).toBe(false);
  expect(canDropPin(false, true)).toBe(false);
});
