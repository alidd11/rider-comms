/* global URL */
import { readFile, writeFile } from 'node:fs/promises';

const indexUrl = new URL('../dist/index.html', import.meta.url);
let html = await readFile(indexUrl, 'utf8');

// iOS Safari Home Screen PWA: without viewport-fit=cover, the web
// viewport stops below the status bar and the app cannot paint there.
const viewportTag = /<meta\s+name=["']viewport["']\s+content=["']([^"']*)["']\s*\/?\s*>/i;
const viewportMatch = html.match(viewportTag);
if (viewportMatch) {
  const content = viewportMatch[1].replace(/(?:^|,)\s*viewport-fit\s*=\s*[^,]*/ig, '').replace(/^\s*,\s*|,\s*$/g, '').trim();
  const withCover = [content, 'viewport-fit=cover'].filter(Boolean).join(', ');
  const withKeyboard = /interactive-widget\s*=/.test(withCover)
    ? withCover : withCover + ', interactive-widget=resizes-content';
  html = html.replace(viewportTag, '<meta name="viewport" content="' + withKeyboard + '" />');
} else {
  html = html.replace('</head>', '  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content" />\n</head>');
}

// Ensure the iOS status-bar background, page and React root have exactly the
// same colour; only the content is inset, never the app's background.
const edgeToEdgeStyle = `<style id="social-edge-to-edge">
  html, body, #root {
    width: 100%;
    height: 100%;
    min-height: 100%;
    margin: 0;
    padding: 0;
    background: #080D13 !important;
  }
  html, body, #root { overflow: hidden; overscroll-behavior: none; }
  /* Eclipse PWA pattern: React's fixed shell tracks the actual visual viewport;
     scrolling is owned by its individual content areas. */
  #root {
    display: flex !important;
    flex-direction: column !important;
    height: var(--app-vh, 100dvh);
    min-height: 0;
    max-height: var(--app-vh, 100dvh);
  }
  #social-screen {
    flex: 1 1 auto !important; min-height: 0 !important;
    width: 100%; display: flex !important; flex-direction: column !important;
  }
  #social-page-scroll, #composer-scroll { overscroll-behavior-y: contain; }
  #social-reels-feed {
    overflow-y: auto;
    overscroll-behavior-y: contain;
    scroll-snap-type: y mandatory;
    scrollbar-width: none;
  }
  #social-reels-feed::-webkit-scrollbar { display: none; }
  [id^="social-reel-panel-"] {
    scroll-snap-align: start;
    scroll-snap-stop: always;
  }
  @supports (height: 100dvh) {
    html, body { height: 100dvh; min-height: 100dvh; }
    #root {
      height: var(--app-vh, 100dvh);
      min-height: 0;
      max-height: var(--app-vh, 100dvh);
    }
  }
  #social-screen {
    box-sizing: border-box;
    padding-top: env(safe-area-inset-top, 0px) !important;
    padding-right: env(safe-area-inset-right, 0px) !important;
    padding-left: env(safe-area-inset-left, 0px) !important;
  }
  #social-bottom-tabs {
    flex-shrink: 0 !important;
    box-sizing: border-box;
    background: #080D13 !important;
    padding-bottom: max(12px, var(--bottom-safe-area, env(safe-area-inset-bottom, 0px))) !important;
  }
  /* Never reset the top safe-area inset in standalone mode: that override
     allowed the header to start behind the iPhone Dynamic Island. */
</style>`;

if (!html.includes('id="social-edge-to-edge"')) {
  html = html.replace('</head>', edgeToEdgeStyle + '\n</head>');
}
const extraHeadTags = [
  ['theme-color', '<meta name="theme-color" content="#080D13" />'],
  ['apple-mobile-web-app-capable', '<meta name="apple-mobile-web-app-capable" content="yes" />'],
  ['apple-mobile-web-app-status-bar-style', '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />']
];
for (const [name, tag] of extraHeadTags) {
  if (!html.includes('name="' + name + '"')) html = html.replace('</head>', tag + '\n</head>');
}
// Match EclipseRBLX's visualViewport and safe-area environment synchronisation.
// Pre-paint setup + launch/resume/resize listeners address intermittent iOS PWA
// viewport shifts. Never transform the app shell or the navigation bar.
const viewportSyncScript = `<script id="social-viewport-sync">
(function () {
  var root = document.documentElement;
  var displayMode = window.matchMedia('(display-mode: standalone)');
  var viewport = window.visualViewport;
  function sync() {
    var height = viewport && viewport.height > 0 ? viewport.height : window.innerHeight;
    if (Number.isFinite(height) && height > 0) {
      root.style.setProperty('--app-vh', Math.round(height) + 'px');
    }
    var standalone = displayMode.matches || window.navigator.standalone === true;
    root.style.setProperty('--bottom-safe-area',
      standalone ? 'env(safe-area-inset-bottom, 0px)' : '0px');
  }
  sync();
  window.addEventListener('resize', sync, { passive: true });
  window.addEventListener('orientationchange', sync);
  window.addEventListener('pageshow', sync);
  document.addEventListener('visibilitychange', sync);
  if (viewport) {
    viewport.addEventListener('resize', sync);
    viewport.addEventListener('scroll', sync);
  }
  if (displayMode.addEventListener) displayMode.addEventListener('change', sync);
  else if (displayMode.addListener) displayMode.addListener(sync);
})();
</script>`;
if (!html.includes('id="social-viewport-sync"')) {
  html = html.replace('</head>', viewportSyncScript + '\n</head>');
}

if (!html.includes('<link rel="manifest"')) {
  html = html.replace('</head>', [
    '<link rel="manifest" href="/manifest.webmanifest" />',
    '<link rel="icon" href="/social-icon.svg" type="image/svg+xml" />',
    '</head>'
  ].join('\n'));
}
await writeFile(indexUrl, html);
