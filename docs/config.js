// Runtime configuration. The deployment workflow replaces this file using
// repository secrets; the committed fallback intentionally contains no key.
window.RIDER_COMMS_CONFIG = window.RIDER_COMMS_CONFIG || {
  googleMapsApiKey: '',
};

// The curated catalogue is deliberately isolated from account/session state.
// Loading it here keeps the mobile PWA feature independently deployable while
// the authenticated app shell continues to evolve.
const routesScript = document.createElement('script');
routesScript.src = 'routes.js?v=31';
routesScript.defer = true;
document.head.append(routesScript);

const routesStyles = document.createElement('link');
routesStyles.rel = 'stylesheet';
routesStyles.href = 'routes.css?v=31';
document.head.append(routesStyles);
