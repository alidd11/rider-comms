import { describe, it } from 'node:test';
import { expect } from './testUtils.ts';
import { validateScenicRouteInput } from '../src/scenicRoutes.ts';

function validInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'Skyline Ridge Loop',
    description: 'A curvy mountain loop with wide sweepers and light traffic.',
    vehicleSuitability: ['motorcycle_large', 'car'],
    roadType: 'mountain',
    distanceMiles: 42.5,
    estimatedDurationMinutes: 90,
    difficulty: 'moderate',
    surfaceQuality: 'good',
    avoidsTolls: true,
    avoidsMotorways: true,
    scenicRating: 4,
    safetyNotices: ['Loose gravel on the northbound switchback in spring.'],
    startLat: 40.1,
    startLon: -74.2,
    endLat: 40.3,
    endLon: -74.5,
    ...overrides,
  };
}

describe('validateScenicRouteInput', () => {
  it('accepts a fully valid route', () => {
    const result = validateScenicRouteInput(validInput());
    expect(result.ok).toBe(true);
  });

  it('rejects a non-object input', () => {
    expect(validateScenicRouteInput(null).ok).toBe(false);
    expect(validateScenicRouteInput('nope').ok).toBe(false);
  });

  it('rejects an empty name', () => {
    const result = validateScenicRouteInput(validInput({ name: '' }));
    expect(result.ok).toBe(false);
  });

  it('rejects an oversized name', () => {
    const result = validateScenicRouteInput(validInput({ name: 'x'.repeat(81) }));
    expect(result.ok).toBe(false);
  });

  it('rejects an oversized description', () => {
    const result = validateScenicRouteInput(validInput({ description: 'x'.repeat(501) }));
    expect(result.ok).toBe(false);
  });

  it('rejects an invalid vehicleSuitability entry', () => {
    const result = validateScenicRouteInput(validInput({ vehicleSuitability: ['spaceship'] }));
    expect(result.ok).toBe(false);
  });

  it('rejects an empty vehicleSuitability array', () => {
    const result = validateScenicRouteInput(validInput({ vehicleSuitability: [] }));
    expect(result.ok).toBe(false);
  });

  it('rejects an invalid roadType', () => {
    const result = validateScenicRouteInput(validInput({ roadType: 'moon' }));
    expect(result.ok).toBe(false);
  });

  it('rejects an invalid difficulty', () => {
    const result = validateScenicRouteInput(validInput({ difficulty: 'insane' }));
    expect(result.ok).toBe(false);
  });

  it('rejects an invalid surfaceQuality', () => {
    const result = validateScenicRouteInput(validInput({ surfaceQuality: 'glass' }));
    expect(result.ok).toBe(false);
  });

  it('rejects a negative distanceMiles', () => {
    const result = validateScenicRouteInput(validInput({ distanceMiles: -5 }));
    expect(result.ok).toBe(false);
  });

  it('rejects a zero distanceMiles', () => {
    const result = validateScenicRouteInput(validInput({ distanceMiles: 0 }));
    expect(result.ok).toBe(false);
  });

  it('rejects a non-positive estimatedDurationMinutes', () => {
    const result = validateScenicRouteInput(validInput({ estimatedDurationMinutes: 0 }));
    expect(result.ok).toBe(false);
  });

  it('rejects a scenicRating out of the 1-5 range', () => {
    expect(validateScenicRouteInput(validInput({ scenicRating: 0 })).ok).toBe(false);
    expect(validateScenicRouteInput(validInput({ scenicRating: 6 })).ok).toBe(false);
  });

  it('rejects a non-integer scenicRating', () => {
    const result = validateScenicRouteInput(validInput({ scenicRating: 3.5 }));
    expect(result.ok).toBe(false);
  });

  it('rejects an out-of-range startLat/startLon', () => {
    expect(validateScenicRouteInput(validInput({ startLat: 91 })).ok).toBe(false);
    expect(validateScenicRouteInput(validInput({ startLon: -181 })).ok).toBe(false);
  });

  it('rejects an out-of-range endLat/endLon', () => {
    expect(validateScenicRouteInput(validInput({ endLat: -91 })).ok).toBe(false);
    expect(validateScenicRouteInput(validInput({ endLon: 181 })).ok).toBe(false);
  });

  it('rejects an oversized safetyNotices entry', () => {
    const result = validateScenicRouteInput(validInput({ safetyNotices: ['x'.repeat(201)] }));
    expect(result.ok).toBe(false);
  });

  it('rejects a non-array safetyNotices', () => {
    const result = validateScenicRouteInput(validInput({ safetyNotices: 'not an array' }));
    expect(result.ok).toBe(false);
  });

  it('rejects a non-boolean avoidsTolls/avoidsMotorways', () => {
    expect(validateScenicRouteInput(validInput({ avoidsTolls: 'yes' })).ok).toBe(false);
    expect(validateScenicRouteInput(validInput({ avoidsMotorways: 1 })).ok).toBe(false);
  });
});
