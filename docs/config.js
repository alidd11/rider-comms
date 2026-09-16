// Runtime configuration. The deployment workflow replaces this file
// wholesale using repository secrets (see .github/workflows/pages.yml) --
// anything else defined here would be silently deleted on every real
// deploy, which is exactly what happened to the routes.js/routes.css
// loader that used to live here (see index.html for where that now
// lives as static tags instead). Keep this file to only the config
// assignment.
window.RIDER_COMMS_CONFIG = window.RIDER_COMMS_CONFIG || {
  googleMapsApiKey: '',
};
