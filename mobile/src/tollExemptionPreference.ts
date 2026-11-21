/** User declarations, not verified exemption or routing eligibility. */
/** Disabled until charging rules, route detection and safety testing are complete. */
export const TOLLS_EXEMPTIONS_RELEASED = false;
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

// Prevent an in-flight local read from resurrecting a preference after reset,
// sign-in changes or a subsequent user edit. Serialize writes to keep resets
// ordered after any pending saves, including when storage errors occur.
export class TollExemptionsStorageGuard {
  private generation = 0;
  private writes: Promise<void> = Promise.resolve();
  beginLoad(): number { return ++this.generation; }
  isCurrent(token: number): boolean { return token === this.generation; }
  invalidate(): void { this.generation += 1; }
  enqueue(write: () => Promise<void>): void {
    this.writes = this.writes.then(write).catch(() => {});
  }
  async idle(): Promise<void> { await this.writes; }
}
