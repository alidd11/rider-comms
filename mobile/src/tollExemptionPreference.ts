/** User declarations, not verified exemption or routing eligibility. */
export const TOLL_EXEMPTION_OPTIONS = [
  { id: 'london_congestion', label: 'London Congestion Charge' },
  { id: 'london_ulez', label: 'London ULEZ' },
  { id: 'blackwall_silvertown', label: 'Blackwall & Silvertown tunnels' },
  { id: 'dart_charge', label: 'Dartford Crossing' },
] as const;
export type TollExemptionId = typeof TOLL_EXEMPTION_OPTIONS[number]['id'];
export function tollExemptionsStorageKey(riderId: string): string {
  return `@rider-comms/settings/toll-exemptions/${riderId}`;
}
export function parseTollExemptions(value: string | null): TollExemptionId[] {
  try {
    const raw: unknown = value ? JSON.parse(value) : null;
    if (!Array.isArray(raw)) return [];
    return TOLL_EXEMPTION_OPTIONS.filter(({ id }) => raw.includes(id)).map(({ id }) => id);
  } catch {
    return [];
  }
}
