/* global document, window */
import { RIDER_MAPS_RELEASED, DEMO_CAMERA, assertMapDataCompatibility, openMapStyle } from './config.mjs';
import { illustrativeLine } from './open-route.mjs';

const status = document.getElementById('status');
const dayButton = document.getElementById('dayStyle');
const nightButton = document.getElementById('nightStyle');
const resetButton = document.getElementById('resetCamera');
const demoOverlayButton = document.getElementById('demoOverlay');

function updateStatus(message) { status.textContent = message; }
function applyButtonState(theme) {
  dayButton.setAttribute('aria-pressed', String(theme === 'day'));
  nightButton.setAttribute('aria-pressed', String(theme === 'night'));
}

async function startPreview() {
  // A hard stop protects the prototype from accidental future release.
  if (RIDER_MAPS_RELEASED !== false) throw new Error('Map prototype must remain unreleased');
  assertMapDataCompatibility({ surface: 'open', directions: 'none', places: 'none' });
  try {
    const { Map, NavigationControl, ScaleControl } = await import('https://unpkg.com/maplibre-gl@6.3.0/dist/maplibre-gl.mjs');
    let overlayVisible = false;
    let mapHasErrors = false;
    const demoSourceId = 'rider-maps-synthetic-line';
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
      if (!overlayVisible || map.getSource(demoSourceId)) return;
      map.addSource(demoSourceId, { type: 'geojson', data: illustrativeLine() });
      map.addLayer({
        id: demoSourceId,
        type: 'line',
        source: demoSourceId,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#16c3ec', 'line-width': 6, 'line-opacity': 0.92 },
      });
    }
    map.on('error', () => {
      mapHasErrors = true;
      updateStatus('Some map tiles could not load · check your connection');
    });
    map.on('idle', () => {
      if (!mapHasErrors) updateStatus(overlayVisible
        ? 'Basemap loaded · synthetic overlay visible (not a ride route)'
        : 'Basemap loaded · no rider data requested');
    });
    function setTheme(mode) {
      applyButtonState(mode);
      mapHasErrors = false;
      map.setStyle(openMapStyle(mode));
      updateStatus('Loading ' + mode + ' basemap…');
    }
    dayButton.addEventListener('click', () => setTheme('day'));
    nightButton.addEventListener('click', () => setTheme('night'));
    demoOverlayButton.addEventListener('click', () => {
      overlayVisible = !overlayVisible;
      demoOverlayButton.setAttribute('aria-pressed', String(overlayVisible));
      if (overlayVisible) addDemoOverlay();
      else if (map.getLayer(demoSourceId)) {
        map.removeLayer(demoSourceId);
        map.removeSource(demoSourceId);
      }
      updateStatus(overlayVisible
        ? 'Illustrative overlay shown · not real roads, hazards or navigation'
        : 'Illustrative overlay hidden · no live rider data');
    });
    resetButton.addEventListener('click', () => {
      map.easeTo({ center: [DEMO_CAMERA.longitude, DEMO_CAMERA.latitude], zoom: DEMO_CAMERA.zoom, pitch: 0, bearing: 0 });
      updateStatus('Showing the London sample area · not your location');
    });
    map.on('style.load', () => {
      // Switching styles removes custom sources/layers. Restore Rider-owned
      // overlays from their original inputs, without a new API request.
      addDemoOverlay();
    });
    window.addEventListener('resize', () => map.resize(), { passive: true });
  } catch {
    updateStatus('Couldn’t load the prototype map. Check your internet connection.');
    dayButton.disabled = true;
    nightButton.disabled = true;
    resetButton.disabled = true;
    demoOverlayButton.disabled = true;
  }
}

void startPreview();
