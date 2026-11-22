/**
 * Future-only, read-only local road charging / traffic restriction research.
 *
 * Do NOT confuse a historic congestion charge with a currently chargeable
 * road, or assume that a permit-only traffic filter can be paid at a toll
 * booth. This catalogue is NOT used by live navigation or the exemption
 * evaluator and does not infer road access, road matches or amounts payable.
 */
export type LocalRoadControlId =
  | 'oxford_temporary_congestion'
  | 'oxford_traffic_filters'
  | 'oxford_zez'
  | 'durham_road_user_charge';

export type LocalRoadControlKind =
  | 'ended_charge'
  | 'permit_based_traffic_restriction'
  | 'charge_requires_operator_check';

export interface LocalRoadControlResearch {
  id: LocalRoadControlId;
  title: string;
  authority: string;
  kind: LocalRoadControlKind;
  /** Sources reviewed by a person, not a redistribution licence. */
  officialSourceUrl: string;
  /** Exact scope must still be checked with the authority before routing. */
  reviewScope: string;
  effectiveFrom?: string;
  endedAfter?: string;
  checkedOn: string;
  requiresOperatorReview: true;
  routeAccessVerified: false;
  chargeEligibilityVerified: false;
}

export const LOCAL_ROAD_CONTROL_REVIEWED_ON = '2026-11-22';
const isDay = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const when = new Date(value + 'T00:00:00Z');
  return Number.isFinite(when.getTime()) && when.toISOString().slice(0, 10) === value;
};

export const LOCAL_ROAD_CONTROL_RESEARCH: readonly LocalRoadControlResearch[] =
  Object.freeze([
    Object.freeze({
      id: 'oxford_temporary_congestion',
      title: 'Oxford temporary congestion charge (ended)',
      authority: 'Oxfordshire County Council',
      kind: 'ended_charge',
      officialSourceUrl: 'https://www.oxfordshire.gov.uk/transport-and-travel/oxford-traffic-filters/about-traffic-filters',
      reviewScope: 'Former six locations; ceased 27 September 2026, replaced by traffic filters 28 September.',
      endedAfter: '2026-09-27',
      checkedOn: LOCAL_ROAD_CONTROL_REVIEWED_ON,
      requiresOperatorReview: true,
      routeAccessVerified: false,
      chargeEligibilityVerified: false,
    }),
    Object.freeze({
      id: 'oxford_traffic_filters',
      title: 'Oxford traffic filters trial (not a payable toll)',
      authority: 'Oxfordshire County Council',
      kind: 'permit_based_traffic_restriction',
      officialSourceUrl: 'https://www.oxfordshire.gov.uk/transport-and-travel/oxford-traffic-filters/about-traffic-filters',
      reviewScope: 'Six permit-based traffic restrictions replacing the temporary congestion charge.',
      effectiveFrom: '2026-09-28',
      checkedOn: LOCAL_ROAD_CONTROL_REVIEWED_ON,
      requiresOperatorReview: true,
      routeAccessVerified: false,
      chargeEligibilityVerified: false,
    }),
    Object.freeze({
      id: 'oxford_zez',
      title: 'Oxford Zero Emission Zone (separate charge)',
      authority: 'Oxfordshire County Council',
      kind: 'charge_requires_operator_check',
      officialSourceUrl: 'https://www.oxfordshire.gov.uk/transport-and-travel/oxford-zero-emission-zone-zez/check-your-vehicle-and-pay',
      reviewScope: 'ZEZ remains separate from the ended temporary congestion charge and traffic filters.',
      checkedOn: LOCAL_ROAD_CONTROL_REVIEWED_ON,
      requiresOperatorReview: true,
      routeAccessVerified: false,
      chargeEligibilityVerified: false,
    }),
    Object.freeze({
      id: 'durham_road_user_charge',
      title: 'Durham city peninsula Road User Charge Zone',
      authority: 'Durham County Council',
      kind: 'charge_requires_operator_check',
      officialSourceUrl: 'https://www.gov.uk/uk-toll-roads',
      reviewScope: 'Distinct local road-user charge for access to the city peninsula, not a national Clean Air Zone.',
      checkedOn: LOCAL_ROAD_CONTROL_REVIEWED_ON,
      requiresOperatorReview: true,
      routeAccessVerified: false,
      chargeEligibilityVerified: false,
    }),
  ]);

/** A stale, invalid or pre-effective lookup never produces a charging conclusion. */
export type LocalRoadControlResult =
  | { status: 'reference_unknown'; requiresOperatorReview: true }
  | { status: 'reference_stale'; requiresOperatorReview: true }
  | { status: 'date_not_reviewed'; requiresOperatorReview: true }
  | { status: 'advisory'; research: LocalRoadControlResearch; requiresOperatorReview: true };

export function lookupLocalRoadControl(
  controlId: unknown,
  asOfLocalDate: string,
): LocalRoadControlResult {
  const uncertain = (status: 'reference_unknown' | 'reference_stale' | 'date_not_reviewed'): LocalRoadControlResult =>
    ({ status, requiresOperatorReview: true });
  if (typeof controlId !== 'string' || !isDay(asOfLocalDate))
    return uncertain('reference_unknown');
  const entry = LOCAL_ROAD_CONTROL_RESEARCH.find(item => item.id === controlId);
  if (!entry) return uncertain('reference_unknown');
  const checked = Date.parse(entry.checkedOn + 'T00:00:00Z');
  const when = Date.parse(asOfLocalDate + 'T00:00:00Z');
  if (when > checked + 30 * 86400000) return uncertain('reference_stale');
  if (entry.kind === 'ended_charge'
    && (!entry.endedAfter || asOfLocalDate <= entry.endedAfter))
    return uncertain('date_not_reviewed');
  if (entry.effectiveFrom && asOfLocalDate < entry.effectiveFrom)
    return uncertain('date_not_reviewed');
  if (when < checked) return uncertain('date_not_reviewed');
  return { status: 'advisory', research: entry, requiresOperatorReview: true };
}
