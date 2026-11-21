/**
 * Read-only research catalogue of UK toll infrastructure, NOT a live toll or
 * routing dataset. Listing reviewed on 21 November 2026 from a DfT answer
 * published 8 July 2026. The list may have changed since that answer.
 *
 * Neither a catalogue match nor a motorcycle category proves a payable toll,
 * road restriction, discount or exemption. Licence approval is separately
 * required before distributing any operator geometry or tariff tables.
 */
export type TollInfrastructureKind =
  | 'motorway' | 'motorway_crossing' | 'bridge' | 'tunnel' | 'combined';
export type TollAssessmentModel =
  | 'journey_zones' | 'per_passage' | 'directional_passage'
  | 'daily_passage_cap' | 'operator_review_required';
export interface UKTollInfrastructure {
  id: string;
  name: string;
  kind: TollInfrastructureKind;
  assessmentModel: TollAssessmentModel;
  operatorUrl?: string;
  /** A category choice is never operator-confirmed toll eligibility. */
  requiresVehicleClassificationReview: true;
  /** A displayed location cannot prove which tolled carriageway was used. */
  requiresRoadEvidenceReview: true;
}
export const PARLIAMENT_TOLL_INVENTORY_SOURCE =
  'https://questions-statements.parliament.uk/written-questions/detail/2026-06-30/hl1520';
export const PARLIAMENT_TOLL_INVENTORY_ANSWER_DATE = '2026-07-08';
export const UK_TOLL_REFERENCE_REVIEW_DATE = '2026-11-21';

const item = (
  id: string, name: string, kind: TollInfrastructureKind,
  assessmentModel: TollAssessmentModel, operatorUrl?: string,
): UKTollInfrastructure => Object.freeze({
  id, name, kind, assessmentModel, ...(operatorUrl ? { operatorUrl } : {}),
  requiresVehicleClassificationReview: true,
  requiresRoadEvidenceReview: true,
});

/**
 * 20 infrastructure groups expressly listed by DfT in July 2026.
 * Some groups contain multiple structures and will require separate road IDs
 * when real authoritative road-level evidence becomes available.
 */
export const UK_TOLL_INFRASTRUCTURE: readonly UKTollInfrastructure[] = Object.freeze([
  item('m6_toll', 'M6 Toll motorway', 'motorway', 'journey_zones',
    'https://www.m6toll.co.uk/pricing/'),
  item('aldwark_bridge', 'Aldwark Bridge', 'bridge', 'operator_review_required'),
  item('batheaston_bridge', 'Batheaston (Bathampton) Bridge', 'bridge', 'operator_review_required'),
  item('blackwall_silvertown', 'Blackwall and Silvertown Tunnels', 'tunnel', 'per_passage',
    'https://tfl.gov.uk/modes/driving/silvertown-blackwall-tunnels-charge'),
  item('cartford_bridge', 'Cartford Bridge', 'bridge', 'operator_review_required'),
  item('clifton_suspension_bridge', 'Clifton Suspension Bridge', 'bridge', 'operator_review_required'),
  item('dartford_crossing', 'Dartford Crossing (M25)', 'motorway_crossing', 'per_passage',
    'https://www.gov.uk/pay-dartford-crossing-charge/charges'),
  item('dunham_bridge', 'Dunham Bridge', 'bridge', 'operator_review_required',
    'https://www.dunhambridge.co.uk/Home'),
  item('eling_bridge', 'Eling Bridge', 'bridge', 'operator_review_required'),
  item('humber_bridge', 'Humber Bridge', 'bridge', 'per_passage',
    'https://www.humberbridge.co.uk/plan-your-trip/tolls-ways-to-pay/'),
  item('itchen_bridge', 'Itchen Bridge', 'bridge', 'operator_review_required'),
  item('kingsland_bridge', 'Kingsland Bridge, Shrewsbury', 'bridge', 'operator_review_required'),
  item('mersey_gateway_silver_jubilee', 'Mersey Gateway and Silver Jubilee Bridges',
    'combined', 'per_passage', 'https://www.merseyflow.co.uk/toll-charges'),
  item('mersey_tunnels', 'Mersey Tunnels (Queensway and Kingsway)', 'combined',
    'operator_review_required'),
  item('rixton_warburton_bridge', 'Rixton and Warburton Bridge',
    'bridge', 'daily_passage_cap', 'https://www.warburtontollbridge.co.uk/'),
  item('swinford_bridge', 'Swinford Bridge', 'bridge', 'operator_review_required'),
  item('tamar_bridge', 'Tamar Bridge', 'bridge', 'directional_passage',
    'https://www.tamarcrossings.org.uk/prices/tamar-bridge-tolls/'),
  item('tyne_tunnels', 'Tyne Tunnels', 'tunnel', 'per_passage',
    'https://www.tt2.co.uk/toll-information/toll-prices/'),
  item('whitchurch_bridge', 'Whitchurch Bridge', 'bridge', 'operator_review_required'),
  item('whitney_on_wye_bridge', 'Whitney-on-Wye Bridge', 'bridge', 'operator_review_required'),
]);

export function findUKTollInfrastructure(id: unknown): UKTollInfrastructure | null {
  return typeof id === 'string'
    ? UK_TOLL_INFRASTRUCTURE.find(road => road.id === id) ?? null
    : null;
}
