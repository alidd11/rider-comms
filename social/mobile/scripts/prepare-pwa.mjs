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
  /* Standalone authentication is outside #social-screen; give it its own
     Dynamic Island/home-indicator insets. Never center it vertically:
     keyboard resize must leave the username field at its original y-position. */
  #social-account-gate {
    box-sizing: border-box;
    min-height: 0;
    padding-top: env(safe-area-inset-top, 0px) !important;
    padding-bottom: env(safe-area-inset-bottom, 0px) !important;
  }
  #social-auth-scroll {
    overscroll-behavior-y: contain;
    overflow-anchor: none;
  }
  /* iOS Safari enlarges pages when a focused input is below 16px. */
  #social-account-gate input,
  #social-account-gate textarea { font-size: 16px !important; }
  /* No blue, shaded, outlined input blocks on any Social screen. Focus is
     a restrained underline, not a browser-default blue rectangular halo. */
  #social-account-gate input,
  #social-account-gate textarea,
  #social-screen input,
  #social-screen textarea {
    background-color: transparent !important;
    box-shadow: none;
  }
  #social-account-gate input:focus,
  #social-account-gate textarea:focus,
  #social-screen input:focus,
  #social-screen textarea:focus {
    outline: none !important;
    box-shadow: inset 0 -2px 0 0 #5CE4C1 !important;
  }

  /* Reels video paints behind the Dynamic Island; only floating UI is inset.
     The :has selector scopes this exception to Reels (not Home, Create or Shop).
     No translated or artificially extended viewport: media truly starts at y=0. */
  #social-screen:has(#social-reels-viewport) {
    padding-top: 0 !important;
  }
  #social-reels-top-controls {
    padding-top: calc(env(safe-area-inset-top, 0px) + 13px) !important;
  }
  #social-reels-notice {
    top: calc(env(safe-area-inset-top, 0px) + 71px) !important;
  }
  #social-reels-swipe-buttons {
    top: calc(env(safe-area-inset-top, 0px) + 72px) !important;
  }
  #social-create-studio {
    padding-bottom: max(13px, var(--bottom-safe-area, env(safe-area-inset-bottom, 0px))) !important;
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
    // A suspended iOS Home Screen PWA can report a visualViewport height that
    // excludes a stale bottom browser/UI region. That creates a large empty
    // gap *below* the entire tab bar even when the bar reaches #root's bottom.
    // Only honour the smaller visual viewport while an actual editable input
    // has focus and an on-screen keyboard is likely visible.
    var full = Math.max(window.innerHeight || 0, root.clientHeight || 0);
    var focused = document.activeElement;
    var editing = focused && (
      focused.tagName === 'INPUT' || focused.tagName === 'TEXTAREA' ||
      focused.isContentEditable === true
    );
    var visible = viewport && viewport.height > 0 ? viewport.height : full;
    var keyboard = editing && full - visible > 100;
    var height = keyboard ? visible : full;
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
