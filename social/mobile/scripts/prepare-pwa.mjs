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
  html = html.replace(viewportTag, '<meta name="viewport" content="' + content + ', viewport-fit=cover" />');
} else {
  html = html.replace('</head>', '  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />\n</head>');
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
  /* RN Web flex:1 needs a flex parent; otherwise the tabs can float above
     the bottom with a large unused strip below the app. */
  #root { display: flex !important; flex-direction: column !important; }
  #social-screen {
    flex: 1 1 auto !important; min-height: 0 !important;
    width: 100%; display: flex !important; flex-direction: column !important;
  }
  #social-page-scroll, #composer-scroll { overscroll-behavior-y: contain; }
  @supports (height: 100dvh) {
    html, body, #root { height: 100dvh; min-height: 100dvh; }
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
    padding-bottom: max(12px, env(safe-area-inset-bottom, 0px)) !important;
  }
  /* In normal black standalone mode, iOS reserves status-bar space.
     Avoid double-insetting the top of the app. */
  @media (display-mode: standalone) {
    #social-screen { padding-top: 0 !important; }
  }
</style>`;

if (!html.includes('id="social-edge-to-edge"')) {
  html = html.replace('</head>', edgeToEdgeStyle + '\n</head>');
}
const extraHeadTags = [
  ['theme-color', '<meta name="theme-color" content="#080D13" />'],
  ['apple-mobile-web-app-capable', '<meta name="apple-mobile-web-app-capable" content="yes" />'],
  ['apple-mobile-web-app-status-bar-style', '<meta name="apple-mobile-web-app-status-bar-style" content="black" />']
];
for (const [name, tag] of extraHeadTags) {
  if (!html.includes('name="' + name + '"')) html = html.replace('</head>', tag + '\n</head>');
}
if (!html.includes('<link rel="manifest"')) {
  html = html.replace('</head>', [
    '<link rel="manifest" href="/manifest.webmanifest" />',
    '<link rel="icon" href="/social-icon.svg" type="image/svg+xml" />',
    '</head>'
  ].join('\n'));
}
await writeFile(indexUrl, html);
