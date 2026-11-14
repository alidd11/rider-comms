/**
 * Demo-only garage and social profile domain.
 * Never derives a user's legal identity, shared @username, precise location or
 * Rider Comms ride state. Saving here does not create an account or public post.
 */
export type GarageKind = 'Car' | 'Motorcycle' | 'Bicycle';
export type ProfileVisibility = 'public' | 'private';

export type GarageEntry = {
  id: string;
  kind: GarageKind;
  make: string;
  model: string;
  year?: number;
  notes: string;
  visibility: ProfileVisibility;
};

export type GarageDraft = {
  kind: GarageKind;
  make: string;
  model: string;
  year: string;
  notes: string;
  visibility: ProfileVisibility;
};

export type SocialProfileDraft = {
  displayName: string;
  bio: string;
  visibility: ProfileVisibility;
};

export type PreviewState = {
  profile: SocialProfileDraft;
  garage: GarageEntry[];
};

export const DEFAULT_PROFILE: SocialProfileDraft = {
  displayName: 'Your social profile',
  bio: 'Cars, motorcycles, cycling and the community.',
  visibility: 'private',
};

export const EMPTY_GARAGE_DRAFT: GarageDraft = {
  kind: 'Motorcycle',
  make: '',
  model: '',
  year: '',
  notes: '',
  visibility: 'private',
};

const MAX_GARAGE = 12;
const KINDS: readonly GarageKind[] = ['Car', 'Motorcycle', 'Bicycle'];
const VISIBILITIES: readonly ProfileVisibility[] = ['public', 'private'];
type Valid<T> = { ok: true; value: T };
type Invalid = { ok: false; error: string };
export type Validation<T> = Valid<T> | Invalid;

export function validateProfile(draft: SocialProfileDraft): Validation<SocialProfileDraft> {
  const displayName = draft.displayName.trim();
  const bio = draft.bio.trim();
  if (displayName.length < 2 || displayName.length > 40) return { ok: false, error: 'Display name must be 2–40 characters.' };
  if (bio.length > 160) return { ok: false, error: 'Bio must be 160 characters or fewer.' };
  if (!VISIBILITIES.includes(draft.visibility)) return { ok: false, error: 'Choose a valid profile visibility.' };
  return { ok: true, value: { displayName, bio, visibility: draft.visibility } };
}

export function createGarageEntry(
  draft: GarageDraft, id: string, currentYear: number
): Validation<GarageEntry> {
  const make = draft.make.trim();
  const model = draft.model.trim();
  const notes = draft.notes.trim();
  if (!id || id.length > 80) return { ok: false, error: 'Invalid garage entry identifier.' };
  if (!KINDS.includes(draft.kind)) return { ok: false, error: 'Choose a valid vehicle type.' };
  if (!VISIBILITIES.includes(draft.visibility)) return { ok: false, error: 'Choose a valid garage visibility.' };
  if (!make || make.length > 50 || !model || model.length > 60) {
    return { ok: false, error: 'Make and model are required (max 50 / 60 characters).' };
  }
  if (notes.length > 240) return { ok: false, error: 'Notes must be 240 characters or fewer.' };
  const yearText = draft.year.trim();
  let year: number | undefined;
  if (yearText) {
    if (!/^[0-9]{4}$/.test(yearText)) return { ok: false, error: 'Enter a four-digit year.' };
    year = Number(yearText);
    if (!Number.isInteger(year) || year < 1900 || year > currentYear + 1) {
      return { ok: false, error: 'Year must be between 1900 and next year.' };
    }
  }
  return { ok: true, value: { id, kind: draft.kind, make, model, ...(year === undefined ? {} : { year }), notes, visibility: draft.visibility } };
}

export function addGarageEntry(entries: readonly GarageEntry[], entry: GarageEntry): Validation<GarageEntry[]> {
  if (entries.length >= MAX_GARAGE) return { ok: false, error: 'Preview garage supports up to 12 vehicles.' };
  if (entries.some((existing) => existing.id === entry.id)) return { ok: false, error: 'This vehicle entry already exists.' };
  return { ok: true, value: [entry, ...entries] };
}

export function updateGarageVisibility(
  entries: readonly GarageEntry[], id: string, visibility: ProfileVisibility
): GarageEntry[] {
  if (!VISIBILITIES.includes(visibility)) return [...entries];
  return entries.map((entry) => entry.id === id ? { ...entry, visibility } : entry);
}

export function removeGarageEntry(entries: readonly GarageEntry[], id: string): GarageEntry[] {
  return entries.filter((entry) => entry.id !== id);
}

/** Untrusted device storage is validated and bounded before it reaches the UI. */
export function parsePreviewState(value: unknown, currentYear: number): PreviewState {
  if (!value || typeof value !== 'object') return { profile: DEFAULT_PROFILE, garage: [] };
  const obj = value as Record<string, unknown>;
  let profile = DEFAULT_PROFILE;
  if (obj.profile && typeof obj.profile === 'object') {
    const p = obj.profile as Record<string, unknown>;
    if (typeof p.displayName === 'string' && typeof p.bio === 'string'
        && (p.visibility === 'public' || p.visibility === 'private')) {
      const parsed = validateProfile({ displayName: p.displayName, bio: p.bio, visibility: p.visibility });
      if (parsed.ok) profile = parsed.value;
    }
  }

  const garage: GarageEntry[] = [];
  const ids = new Set<string>();
  if (Array.isArray(obj.garage)) {
    for (const item of obj.garage.slice(0, 60)) {
      if (garage.length >= MAX_GARAGE) break;
      if (!item || typeof item !== 'object') continue;
      const record = item as Record<string, unknown>;
      if (typeof record.id !== 'string' || ids.has(record.id)
          || typeof record.make !== 'string' || typeof record.model !== 'string'
          || typeof record.notes !== 'string'
          || !KINDS.includes(record.kind as GarageKind)
          || !VISIBILITIES.includes(record.visibility as ProfileVisibility)) continue;
      const parsed = createGarageEntry({
        kind: record.kind as GarageKind,
        make: record.make,
        model: record.model,
        year: record.year === undefined ? '' : String(record.year),
        notes: record.notes,
        visibility: record.visibility as ProfileVisibility,
      }, record.id, currentYear);
      if (parsed.ok) {
        ids.add(parsed.value.id);
        garage.push(parsed.value);
      }
    }
  }
  return { profile, garage };
}
