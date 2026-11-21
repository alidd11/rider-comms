/* global document, window */
import { RIDER_MAPS_RELEASED, DEMO_CAMERA, assertMapDataCompatibility, openMapStyle } from './config.mjs';

const status = document.getElementById('status');
const dayButton = document.getElementById('dayStyle');
const nightButton = document.getElementById('nightStyle');
const resetButton = document.getElementById('resetCamera');

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

    map.on('load', () => updateStatus('Open-source basemap ready · no rider data loaded'));
    map.on('error', () => updateStatus('Map tiles unavailable. Check network access and retry.'));
    function setTheme(mode) {
      applyButtonState(mode);
      map.setStyle(openMapStyle(mode));
      updateStatus('Loading ' + mode + ' basemap…');
    }
    dayButton.addEventListener('click', () => setTheme('day'));
    nightButton.addEventListener('click', () => setTheme('night'));
    resetButton.addEventListener('click', () => {
      map.easeTo({ center: [DEMO_CAMERA.longitude, DEMO_CAMERA.latitude], zoom: DEMO_CAMERA.zoom, pitch: 0, bearing: 0 });
      updateStatus('Showing the London sample area · not your location');
    });
    map.on('style.load', () => updateStatus('Open-source basemap ready · no rider data loaded'));
    window.addEventListener('resize', () => map.resize(), { passive: true });
  } catch {
    updateStatus('Couldn’t load the prototype map. Check your internet connection.');
    dayButton.disabled = true;
    nightButton.disabled = true;
    resetButton.disabled = true;
  }
}

void startPreview();
