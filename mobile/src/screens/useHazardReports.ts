import * as React from 'react';
import { AccessibilityInfo, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { HazardReport, HazardType } from '@rider-comms/shared';
import { ApiError } from '../api/client';
import type { RiderCommsClient } from '../api/client';
import { HAZARD_TYPE_META } from './HazardReportSheet';

// Navigation updates GPS frequently; keep the hazard network refresh on a
// one-minute cadence while recomputing route-relative distance locally.
const HAZARD_REFRESH_INTERVAL_MS = 60_000;
// A report made with no signal is kept and retried, because riders lose
// signal on exactly the roads worth reporting. After half an hour the
// hazard may be gone, so an unsent report is dropped.
export const QUEUED_REPORT_RETRY_MS = 15_000;
export const QUEUED_REPORT_MAX_AGE_MS = 30 * 60_000;

interface QueuedReport { hazardType: HazardType; lat: number; lon: number; queuedAt: number }

/** Waiting reports are kept on the device per rider (PWA: the same key in
 * localStorage), so closing the app doesn't lose them, and a report is
 * never sent from a different account after a sign-out. */
export function queuedReportsStorageKey(riderId: string): string {
  return `riderComms.queuedHazardReports.${riderId}`;
}

/** Reads saved reports, dropping anything malformed. Expired ones are kept
 * so the retry can say they couldn't be sent. */
export function parseQueuedReports(raw: string | null): QueuedReport[] {
  try {
    const value: unknown = JSON.parse(raw ?? '[]');
    if (!Array.isArray(value)) return [];
    return value.filter((entry): entry is QueuedReport => Boolean(entry)
      && typeof entry === 'object'
      && Object.hasOwn(HAZARD_TYPE_META, entry.hazardType)
      && Number.isFinite(entry.lat) && Math.abs(entry.lat) <= 90
      && Number.isFinite(entry.lon) && Math.abs(entry.lon) <= 180
      && Number.isFinite(entry.queuedAt))
      .slice(0, 20)
      .map(({ hazardType, lat, lon, queuedAt }) => ({ hazardType, lat, lon, queuedAt }));
  } catch {
    return [];
  }
}

/** Shown on the map while reports wait for signal (PWA: the same toast). */
export function queuedReportsText(count: number): string {
  return count === 1 ? 'Road report waiting for signal.' : `${count} road reports waiting for signal.`;
}

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
  /** Confirms the rider's own report on its card (PWA: the report toast). */
  reportNotice: { hazardId: string; text: string } | null;
  /** Reports made with no signal, still waiting to be sent. */
  queuedReportCount: number;
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
  announce: (text: string) => void = (text) => AccessibilityInfo.announceForAccessibility(text),
  riderId: string | null = null,
): HazardReports {
  const [hazards, setHazards] = React.useState<HazardReport[]>([]);
  const [selectedHazardId, setSelectedHazardId] = React.useState<string | null>(null);
  const pendingHazardReportLocation = React.useRef<{ lat: number; lon: number } | null>(null);
  const [reportSheetOpen, setReportSheetOpen] = React.useState(false);
  const [reportNotice, setReportNotice] = React.useState<{ hazardId: string; text: string } | null>(null);
  const hazardsRef = React.useRef(hazards);
  hazardsRef.current = hazards;
  const [queuedReports, setQueuedReports] = React.useState<QueuedReport[]>([]);
  const queuedReportsRef = React.useRef(queuedReports);
  queuedReportsRef.current = queuedReports;
  // The saved queue is read once per rider before anything is written back,
  // so an empty queue at start-up never wipes reports saved last time.
  const [queueLoadedFor, setQueueLoadedFor] = React.useState<string | null>(null);
  React.useEffect(() => {
    setQueuedReports([]);
    setQueueLoadedFor(null);
    if (!riderId) return;
    let cancelled = false;
    AsyncStorage.getItem(queuedReportsStorageKey(riderId))
      .then((raw) => {
        if (cancelled) return;
        const saved = parseQueuedReports(raw);
        setQueuedReports((current) => [...saved, ...current]);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setQueueLoadedFor(riderId); });
    return () => { cancelled = true; };
  }, [riderId]);
  React.useEffect(() => {
    if (!riderId || queueLoadedFor !== riderId) return;
    const key = queuedReportsStorageKey(riderId);
    (queuedReports.length ? AsyncStorage.setItem(key, JSON.stringify(queuedReports)) : AsyncStorage.removeItem(key)).catch(() => {});
  }, [queuedReports, queueLoadedFor, riderId]);
  const announceRef = React.useRef(announce);
  announceRef.current = announce;

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
    const label = HAZARD_TYPE_META[hazardType].label;
    try {
      const created = await client.createHazard(hazardType, reportLocation.lat, reportLocation.lon);
      // The server folds a report of the same hazard close by into the
      // existing one, counting this rider's sighting as a confirmation.
      const alreadyReported = hazardsRef.current.some((hazard) => hazard.id === created.id);
      const text = alreadyReported ? `${label} already reported here. Thanks for confirming it.` : `${label} reported.`;
      setReportNotice({ hazardId: created.id, text });
      announceRef.current(text);
      setHazards((current) => [created, ...current.filter((hazard) => hazard.id !== created.id)]);
      setSelectedHazardId(created.id);
    } catch (error) {
      if (!(error instanceof ApiError)) {
        // No answer from the server: keep the report and send it once
        // there's signal, rather than stopping the rider with an alert.
        setQueuedReports((current) => [...current, { hazardType, lat: reportLocation.lat, lon: reportLocation.lon, queuedAt: Date.now() }]);
        announceRef.current(`No signal. Your ${label.toLowerCase()} report will send when you’re back in signal.`);
        return;
      }
      const code = apiErrorCode(error);
      Alert.alert(
        code === 'email_verification_required' ? 'Verify your email' : 'Couldn’t report hazard',
        code === 'email_verification_required'
          ? 'Verify your email to report road hazards: Settings → Account and login → Email.'
          : 'Couldn’t send that road report. Try again.',
      );
    }
  }, [client, currentLocationRef]);

  // Retry reports made with no signal. Each is sent once; one that the
  // server turns down, or that has waited too long, is dropped.
  const hasQueuedReports = queuedReports.length > 0;
  React.useEffect(() => {
    if (!hasQueuedReports) return;
    let sending = false;
    const interval = setInterval(() => {
      if (sending) return;
      sending = true;
      void (async () => {
        try {
          for (const report of queuedReportsRef.current) {
            const label = HAZARD_TYPE_META[report.hazardType].label;
            if (Date.now() - report.queuedAt > QUEUED_REPORT_MAX_AGE_MS) {
              announceRef.current(`Couldn’t send your earlier ${label.toLowerCase()} report. There was no signal for too long.`);
            } else {
              try {
                const created = await client.createHazard(report.hazardType, report.lat, report.lon);
                setHazards((current) => [created, ...current.filter((hazard) => hazard.id !== created.id)]);
                announceRef.current(`${label} report sent.`);
              } catch (error) {
                // Still no signal: try again on the next tick.
                if (!(error instanceof ApiError)) break;
              }
            }
            setQueuedReports((current) => current.filter((entry) => entry !== report));
          }
        } finally {
          sending = false;
        }
      })();
    }, QUEUED_REPORT_RETRY_MS);
    return () => clearInterval(interval);
  }, [client, hasQueuedReports]);

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
          ? 'Verify your email to report road hazards: Settings → Account and login → Email.'
          : 'Couldn’t update that road report. Check your connection and try again.',
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
    reportNotice: reportNotice && reportNotice.hazardId === selectedHazardId ? reportNotice : null,
    queuedReportCount: queuedReports.length,
  };
}
