/* global document, window */
import { RIDER_MAPS_RELEASED, DEMO_CAMERA, assertMapDataCompatibility, openMapStyle } from './config.mjs';
import { illustrativeLine } from './open-route.mjs';
import { RIDER_LANE_GUIDANCE_RELEASED, evaluateSyntheticLaneAccess, syntheticBusLaneScenario } from './lane-access.mjs';

const returnClassic = document.querySelector('.return-classic');
if (returnClassic && window.parent !== window) {
  returnClassic.addEventListener('click', (event) => {
    event.preventDefault();
    // Opaque-origin iframe: send only the fixed close signal (no user data).
    // Parent verifies both the exact frame window and event.origin='null'.
    window.parent.postMessage({ type: 'rider-comms-close-map-beta' }, '*');
  });
}

// Keyboard events do not bubble across sandboxed frame boundaries. Listen
// at window capture (before MapLibre's own keyboard handlers), then forward
// only a fixed close signal; never session data or arbitrary commands.
window.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || window.parent === window) return;
  event.preventDefault();
  event.stopPropagation();
  window.parent.postMessage({ type: 'rider-comms-close-map-beta' }, '*');
}, { capture: true });
// The map markup can become visible before its bundled keyboard handler has
// registered. Mark close-relay readiness only after the handler is live.
document.documentElement.dataset.escapeRelayReady = 'true';

const status = document.getElementById('status');
const dayButton = document.getElementById('dayStyle');
const nightButton = document.getElementById('nightStyle');
const resetButton = document.getElementById('resetCamera');
const demoOverlayButton = document.getElementById('demoOverlay');
const retryButton = document.getElementById('retryMapTiles');
const mapShell = document.querySelector('.map-shell');

// This UI is a fixed, synthetic lane diagram. It is deliberately independent
// from the real map and cannot provide legal permission or navigation advice.
function renderSyntheticLaneExample(time, activeButton) {
  if (RIDER_LANE_GUIDANCE_RELEASED !== false) return;
  const sample = syntheticBusLaneScenario(time);
  const result = evaluateSyntheticLaneAccess(sample);
  const output = document.getElementById('laneAccessStatus');
  const laneMorning = document.getElementById('laneMorning');
  const laneEvening = document.getElementById('laneEvening');
  if (!output || !laneMorning || !laneEvening) return;
  laneMorning.setAttribute('aria-pressed', String(activeButton === 'morning'));
  laneEvening.setAttribute('aria-pressed', String(activeButton === 'evening'));
  output.dataset.exampleAccess = result.status;
  output.textContent = result.status === 'illustrative_permitted'
    ? 'Green example: motorcycle permitted by the synthetic timetable'
    : result.status === 'illustrative_prohibited'
      ? 'Restricted example: this synthetic motorcycle lane is not permitted'
      : 'Uncertain example: cannot confirm lane permission';
}
document.getElementById('laneMorning')?.addEventListener('click', () =>
  renderSyntheticLaneExample('2026-11-23T08:30:00Z', 'morning'));
document.getElementById('laneEvening')?.addEventListener('click', () =>
  renderSyntheticLaneExample('2026-11-23T20:30:00Z', 'evening'));
renderSyntheticLaneExample('2026-11-23T08:30:00Z', 'morning');

function updateStatus(message) { status.textContent = message; }
// Map controls can be used during a style reload or after a tile failure.
// Keep loading/error diagnostics authoritative until the renderer is ready.
function announceReady(message) {
  if (status.dataset.loadState === 'loaded') updateStatus(message);
}
// An opaque-origin iframe requires a compatible Web Worker implementation.
// Report a silent CDN/worker stall instead of leaving the admin beta loading
// indefinitely; the classic map stays active outside this isolated frame.
let loadWatchdog;
function watchForLoading(message) {
  window.clearTimeout(loadWatchdog);
  status.dataset.loadState = 'loading';
  updateStatus(message);
  loadWatchdog = window.setTimeout(() => {
    if (status.dataset.loadState !== 'loading') return;
    status.dataset.loadState = 'stalled';
    updateStatus('Map rendering did not finish. Check the connection or use the classic map.');
  }, 18000);
}
function applyButtonState(theme) {
  dayButton.setAttribute('aria-pressed', String(theme === 'day'));
  nightButton.setAttribute('aria-pressed', String(theme === 'night'));
  // Theme the floating UI in sync with the selected real basemap style.
  mapShell.dataset.theme = theme;
}

async function startPreview() {
  // A hard stop protects the prototype from accidental future release.
  if (RIDER_MAPS_RELEASED !== false) throw new Error('Map prototype must remain unreleased');
  assertMapDataCompatibility({ surface: 'open', directions: 'none', places: 'none' });
  watchForLoading('Loading map…');
  try {
    const { Map, NavigationControl, ScaleControl } = await import('https://unpkg.com/maplibre-gl@6.17.0/dist/maplibre-gl.mjs');
    let overlayVisible = false;
    let mapHasErrors = false;
    let currentTheme = 'day';
    const demoSourceId = 'rider-maps-synthetic-line';
    const demoCasingId = 'rider-maps-synthetic-line-casing';
    const map = new Map({
      container: 'map',
      style: openMapStyle('day'),
      center: [DEMO_CAMERA.longitude, DEMO_CAMERA.latitude],
      zoom: DEMO_CAMERA.zoom,
      attributionControl: true,
      maxPitch: 60,
    });
    map.addControl(new NavigationControl({ showCompass: true }), 'bottom-right');
    map.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left');

    function addDemoOverlay() {
      if (!overlayVisible || !map.isStyleLoaded() || map.getSource(demoSourceId)) return;
      map.addSource(demoSourceId, { type: 'geojson', data: illustrativeLine() });
      // Contrast edge preserves legibility over light roads and dark buildings.
      // This line is synthetic geometry, NOT a road-matched navigation route.
      map.addLayer({
        id: demoCasingId,
        type: 'line',
        source: demoSourceId,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': currentTheme === 'night' ? '#211b3b' : '#ffffff',
          'line-width': 10, 'line-opacity': 0.95 },
      });
      map.addLayer({
        id: demoSourceId,
        type: 'line',
        source: demoSourceId,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#6738ed', 'line-width': 6, 'line-opacity': 0.98 },
      });
    }
    map.on('error', () => {
      mapHasErrors = true;
      window.clearTimeout(loadWatchdog);
      status.dataset.loadState = 'error';
      updateStatus('Some map tiles could not load · check your connection');
    });
    map.on('idle', () => {
      window.clearTimeout(loadWatchdog);
      if (!mapHasErrors) {
        status.dataset.loadState = 'loaded';
        updateStatus(overlayVisible
          ? 'Basemap loaded · synthetic overlay visible (not a ride route)'
          : 'Basemap loaded · no rider data requested');
      }
    });
    function setTheme(mode) {
      currentTheme = mode;
      applyButtonState(mode);
      mapHasErrors = false;
      watchForLoading('Loading ' + mode + ' basemap…');
      map.setStyle(openMapStyle(mode));
    }
    dayButton.addEventListener('click', () => setTheme('day'));
    nightButton.addEventListener('click', () => setTheme('night'));
    // A transient tile/CDN failure can leave the status in error or stalled.
    // Retrying the selected style is explicit and never requests rider data.
    retryButton.addEventListener('click', () => setTheme(currentTheme));
    demoOverlayButton.addEventListener('click', () => {
      overlayVisible = !overlayVisible;
      demoOverlayButton.setAttribute('aria-pressed', String(overlayVisible));
      if (overlayVisible) addDemoOverlay();
      else if (map.getSource(demoSourceId)) {
        if (map.getLayer(demoSourceId)) map.removeLayer(demoSourceId);
        if (map.getLayer(demoCasingId)) map.removeLayer(demoCasingId);
        map.removeSource(demoSourceId);
      }
      announceReady(overlayVisible
        ? 'Illustrative overlay shown · not real roads, hazards or navigation'
        : 'Illustrative overlay hidden · no live rider data');
    });
    resetButton.addEventListener('click', () => {
      map.easeTo({ center: [DEMO_CAMERA.longitude, DEMO_CAMERA.latitude], zoom: DEMO_CAMERA.zoom, pitch: 0, bearing: 0 });
      announceReady('Showing the London sample area · not your location');
    });
    map.on('style.load', () => {
      // Switching styles removes custom sources/layers. Restore Rider-owned
      // overlays from their original inputs, without a new API request.
      addDemoOverlay();
    });
    window.addEventListener('resize', () => map.resize(), { passive: true });
  } catch {
    window.clearTimeout(loadWatchdog);
    status.dataset.loadState = 'error';
    updateStatus('Couldn’t load the prototype map. Check your internet connection.');
    dayButton.disabled = true;
    nightButton.disabled = true;
    resetButton.disabled = true;
    demoOverlayButton.disabled = true;
    retryButton.disabled = true;
  }
}

void startPreview();
