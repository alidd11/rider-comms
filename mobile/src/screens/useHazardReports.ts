import * as React from 'react';
import { Alert } from 'react-native';
import type { HazardReport, HazardType } from '@rider-comms/shared';
import { ApiError } from '../api/client';
import type { RiderCommsClient } from '../api/client';

// Navigation updates GPS frequently; keep the hazard network refresh on a
// one-minute cadence while recomputing route-relative distance locally.
const HAZARD_REFRESH_INTERVAL_MS = 60_000;

function apiErrorCode(error: unknown): string {
  return error instanceof ApiError
    && typeof error.body === 'object'
    && error.body
    && 'error' in (error.body as Record<string, unknown>)
    ? String((error.body as Record<string, unknown>).error)
    : '';
}

export interface HazardReports {
  hazards: HazardReport[];
  selectedHazardId: string | null;
  setSelectedHazardId: React.Dispatch<React.SetStateAction<string | null>>;
  selectedHazard: HazardReport | null;
  reportSheetOpen: boolean;
  openReportSheet: () => Promise<void>;
  closeReportSheet: () => void;
  handleReport: (hazardType: HazardType) => Promise<void>;
  handleVote: (hazardId: string, direction: 'confirm' | 'deny') => Promise<void>;
}

/**
 * Owns the nearby-hazard network layer (fetch/report/vote) and the report
 * sheet's own open/close state. Takes the rider's current location as a
 * ref (so a GPS tick doesn't tear this down and refetch) plus a getter for
 * an on-demand fresh fix, mirroring how MapScreen itself sources location.
 */
export function useHazardReports(
  client: RiderCommsClient,
  hasCurrentLocation: boolean,
  currentLocationRef: React.RefObject<{ lat: number; lon: number } | null>,
  requestCurrentLocation: () => Promise<{ lat: number; lon: number } | null>,
): HazardReports {
  const [hazards, setHazards] = React.useState<HazardReport[]>([]);
  const [selectedHazardId, setSelectedHazardId] = React.useState<string | null>(null);
  const pendingHazardReportLocation = React.useRef<{ lat: number; lon: number } | null>(null);
  const [reportSheetOpen, setReportSheetOpen] = React.useState(false);

  React.useEffect(() => {
    if (!hasCurrentLocation) { setHazards([]); return; }
    let cancelled = false;
    async function fetchHazards() {
      const location = currentLocationRef.current;
      if (!location) return;
      try {
        const { hazards: fetched } = await client.getNearbyHazards(location.lat, location.lon);
        if (!cancelled) setHazards(fetched);
      } catch {
        // Nearby hazards are a secondary layer on top of the core map.
      }
    }
    void fetchHazards();
    const interval = setInterval(() => void fetchHazards(), HAZARD_REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // currentLocationRef is a stable ref object; its .current mutating
    // doesn't need to retrigger this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, hasCurrentLocation]);

  const selectedHazard = hazards.find((h) => h.id === selectedHazardId) ?? null;

  const openReportSheet = React.useCallback(async (): Promise<void> => {
    const location = currentLocationRef.current ?? await requestCurrentLocation();
    if (!location) {
      Alert.alert('Location needed', 'Allow location while using Rider Comms before reporting a road hazard.');
      return;
    }
    // Snapshot the authoritative device fix when reporting starts. Keep the
    // incident where the rider observed it even if they move while choosing
    // a category; do not infer or road-snap the coordinate.
    pendingHazardReportLocation.current = { lat: location.lat, lon: location.lon };
    setReportSheetOpen(true);
  }, [currentLocationRef, requestCurrentLocation]);

  const closeReportSheet = React.useCallback(() => {
    pendingHazardReportLocation.current = null;
    setReportSheetOpen(false);
  }, []);

  const handleReport = React.useCallback(async (hazardType: HazardType): Promise<void> => {
    const reportLocation = pendingHazardReportLocation.current ?? currentLocationRef.current;
    pendingHazardReportLocation.current = null;
    setReportSheetOpen(false);
    if (!reportLocation) return;
    try {
      const created = await client.createHazard(hazardType, reportLocation.lat, reportLocation.lon);
      setHazards((current) => [created, ...current.filter((hazard) => hazard.id !== created.id)]);
      setSelectedHazardId(created.id);
    } catch (error) {
      const code = apiErrorCode(error);
      Alert.alert(
        code === 'email_verification_required' ? 'Verify your email' : 'Couldn’t report hazard',
        code === 'email_verification_required'
          ? 'Verify your email in Settings → Account → Edit profile to report or confirm road hazards.'
          : 'Rider Comms could not send that road report. Check your connection and try again.',
      );
    }
  }, [client, currentLocationRef]);

  const handleVote = React.useCallback(async (hazardId: string, direction: 'confirm' | 'deny'): Promise<void> => {
    try {
      if (direction === 'confirm') await client.confirmHazard(hazardId);
      else await client.denyHazard(hazardId);
      setHazards((current) =>
        current.map((h) =>
          h.id === hazardId
            ? { ...h, confirmations: h.confirmations + (direction === 'confirm' ? 1 : 0), denials: h.denials + (direction === 'deny' ? 1 : 0) }
            : h
        )
      );
    } catch (error) {
      const code = apiErrorCode(error);
      Alert.alert(
        code === 'email_verification_required' ? 'Verify your email' : 'Couldn’t update road report',
        code === 'email_verification_required'
          ? 'Verify your email in Settings → Account → Edit profile to report or confirm road hazards.'
          : 'Rider Comms could not update that road report. Check your connection and try again.',
      );
    }
    setSelectedHazardId(null);
  }, [client]);

  return {
    hazards,
    selectedHazardId,
    setSelectedHazardId,
    selectedHazard,
    reportSheetOpen,
    openReportSheet,
    closeReportSheet,
    handleReport,
    handleVote,
  };
}
