import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { reviewM6TollJourney, reviewM6TollRoute } from '../src/m6TollJourney.ts';

const trip = {
  journeyId: 'm6-first-trip', direction: 'northbound' as const,
  entry: 'T3' as const, exit: 'T7' as const,
  enteredAt: '2026-11-21T11:00:00Z', exitedAt: '2026-11-21T11:30:00Z',
  riderVehicle: 'motorcycle_small', observedZones: 3 as const,
};
describe('offline M6 Toll: count a reviewed candidate trip, NOT its toll plazas', () => {
  it('recognises a possible motorway trip without inferring a motorcycle waiver or price', () => {
    const review = reviewM6TollJourney(trip);
    assert.deepEqual(review, {
      status: 'possible_toll_journey', reason: 'candidate_only',
      journeyId: 'm6-first-trip', observedZones: 3, coarseVehicleClass: 'motorcycle',
      requiresOperatorRoadReview: true, requiresOperatorVehicleClassReview: true,
      requiresOperatorTariffReview: true, routeCoverageComplete: false,
    });
    assert.equal('pricePence' in review, false);
    assert.equal('verifiedExemption' in review, false);
  });
  it('accepts southbound candidates and keeps unknown zone counts unpriced', () => {
    const south = reviewM6TollJourney({
      ...trip, direction: 'southbound', entry: 'T8', exit: 'T4',
      riderVehicle: 'car', observedZones: undefined,
    });
    assert.equal(south.status, 'possible_toll_journey');
    assert.equal(south.coarseVehicleClass, 'car');
    assert.equal(south.observedZones, null);
    assert.equal(south.requiresOperatorTariffReview, true);
  });
  it('rejects wrong-direction, exit-only and impossible junction pairs', () => {
    const candidates = [
      { ...trip, entry: 'T2' as const },
      { ...trip, direction: 'southbound' as const, entry: 'T5' as const },
      { ...trip, direction: 'southbound' as const, entry: 'T7' as const, exit: 'T8' as const },
      { ...trip, direction: 'northbound' as const, entry: 'T8' as const },
      { ...trip, entry: 'T7' as const, exit: 'T3' as const },
      { ...trip, entry: 'T3' as const, exit: 'T3' as const },
      { ...trip, entry: 'INVALID' as typeof trip.entry },
    ];
    for (const candidate of candidates) {
      assert.equal(reviewM6TollJourney(candidate).reason, 'invalid_entry_or_exit');
    }
  });
  it('rejects unknown rider selection, bad zones, malformed times and unrealistic journeys', () => {
    assert.equal(reviewM6TollJourney({ ...trip, riderVehicle: 'vehicle-unknown' }).reason, 'unknown_vehicle');
    assert.equal(reviewM6TollJourney({ ...trip, riderVehicle: '__proto__' }).reason, 'unknown_vehicle');
    assert.equal(reviewM6TollJourney({ ...trip, observedZones: 0 as 1 }).reason, 'invalid_observed_zones');
    assert.equal(reviewM6TollJourney({ ...trip, observedZones: 4 as 1 }).reason, 'invalid_observed_zones');
    assert.equal(reviewM6TollJourney({ ...trip, enteredAt: '2026-02-30T11:00:00Z' }).reason, 'invalid_journey');
    assert.equal(reviewM6TollJourney({ ...trip, enteredAt: 'not-a-date' }).reason, 'invalid_journey');
    assert.equal(reviewM6TollJourney({ ...trip, enteredAt: trip.exitedAt }).reason, 'invalid_journey');
    assert.equal(reviewM6TollJourney({ ...trip, enteredAt: '2026-11-18T11:00:00Z' }).reason, 'invalid_journey');
    assert.equal(reviewM6TollJourney({ ...trip, journeyId: '' }).reason, 'invalid_journey');
    assert.equal(reviewM6TollJourney(null as unknown as typeof trip).reason, 'invalid_journey');
  });
  it('rejects clock rollover, bad UTC offsets and malformed motorway passage times', () => {
    // Native Date.parse silently normalises 24:00, so these cases used to
    // change a journey's calendar day without rejecting untrusted evidence.
    for (const bad of [
      { enteredAt: '2026-11-20T24:00:00Z' },
      { exitedAt: '2026-11-21T24:00:00Z' },
      { enteredAt: '2026-11-21T10:00:00+14:30' },
      { enteredAt: '2026-11-21T10:00:00+15:00' },
      { exitedAt: '2026-11-21T11:60:00Z' },
      { enteredAt: '2026-11-21T11:00:00' },
      { exitedAt: '2026-11-21T11:30:00.1234Z' },
    ]) {
      assert.equal(reviewM6TollJourney({ ...trip, ...bad }).reason, 'invalid_journey',
        JSON.stringify(bad));
    }
  });
  it('preserves valid BST, leap-day and cross-midnight motorway journeys', () => {
    assert.equal(reviewM6TollJourney({
      ...trip, enteredAt: '2026-07-01T12:00:00+01:00',
      exitedAt: '2026-07-01T11:30:00Z',
    }).status, 'possible_toll_journey');
    assert.equal(reviewM6TollJourney({
      ...trip, enteredAt: '2028-02-29T23:30:00Z',
      exitedAt: '2028-03-01T00:00:00Z',
    }).status, 'possible_toll_journey');
    assert.equal(reviewM6TollJourney({
      ...trip, enteredAt: '2026-11-21T23:45:00Z',
      exitedAt: '2026-11-22T00:15:00Z',
    }).status, 'possible_toll_journey');
    // Same instant in different offsets is not a completed journey.
    assert.equal(reviewM6TollJourney({
      ...trip, enteredAt: '2026-07-01T12:00:00+01:00',
      exitedAt: '2026-07-01T11:00:00Z',
    }).reason, 'invalid_journey');
  });
  it('treats two actual journeys as two candidates, never counting an observed plaza twice', () => {
    const second = { ...trip, journeyId: 'm6-second-trip',
      enteredAt: '2026-11-21T15:00:00Z', exitedAt: '2026-11-21T15:45:00Z' };
    const result = reviewM6TollRoute([trip, second]);
    assert.equal(result.possibleMotorwayTollJourneys, 2);
    assert.equal(result.needsVerification, true);
    assert.equal(result.journeyReviews.length, 2);
    assert.equal(reviewM6TollRoute([trip, trip]).reason, 'duplicate_journey');
    assert.equal(reviewM6TollRoute(new Array(65).fill(trip)).reason, 'invalid_journeys');
  });
  it('keeps missing/incomplete route evidence uncertain', () => {
    assert.deepEqual(reviewM6TollRoute([]), {
      possibleMotorwayTollJourneys: 0, needsVerification: true,
      reason: 'no_observations', journeyReviews: [],
    });
    assert.equal(reviewM6TollRoute([{ ...trip, journeyId: '  ' }]).reason, 'invalid_journeys');
    const review = reviewM6TollRoute([{ ...trip, riderVehicle: 'invalid' }]);
    assert.equal(review.possibleMotorwayTollJourneys, 0);
    assert.equal(review.journeyReviews[0]?.status, 'unknown');
    assert.equal(review.needsVerification, true);
  });
});
