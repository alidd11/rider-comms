# PWA viewport ownership

This document records the coordinate system for every PWA surface. It is a
regression contract, not a visual design specification.

| Class | Owner | Surfaces | Rule |
| --- | --- | --- | --- |
| A. Physical app canvas | stable standalone viewport | `html`, `body`, `.app-shell` | Installed mode uses `100vh`; JavaScript must not replace it with a cold-start `innerHeight`. |
| B. Screen content | app shell | `.app-main`, `.screen`, `.map-canvas` | Screens inherit the shell height. The map ends at the persistent navigation boundary. |
| C. Persistent navigation | app shell | `.bottom-nav`, `.ride-pill`, navigation summary | The 58px tab rail stays above the full environment safe inset. Safe area is padding inside chrome, exactly once. |
| D. Temporary overlay | stable app canvas | auth, search, sheet backdrop, route detail, toast and app banners | Full-screen overlays explicitly use `--app-vh` in standalone mode. Sheets protect their content with the safe inset. |
| E. Keyboard UI | VisualViewport while open | chat screen and composer | Chat alone switches to `--visual-vh`/`--visual-viewport-top`; closing the keyboard restores `--app-vh`. |
| F. Decorative | no geometry ownership | HUD grids, gradients and top safe-area shield | Decorative viewport units may size paint only. They must not establish a bottom edge or cover a geometry gap. |

## Invariants

- `viewport-fit=cover` appears once in the viewport meta tag.
- Installed mode has one stable physical canvas and does not require rotation.
- Persistent navigation reaches the app bottom; buttons never enter the
  home-indicator inset.
- The bottom inset is never capped to a model-specific number.
- Sheets replace persistent chrome while open and reach the same app bottom.
- Browser-tab and Android zero-inset layouts do not gain artificial padding.
- No negative bottom offsets, translated tab buttons, or bottom-filling pseudo
  elements are used to conceal a gap.
- Keyboard simulation and physical-device testing remain separate claims:
  Playwright validates the geometry contract, not iOS installed-PWA internals.
