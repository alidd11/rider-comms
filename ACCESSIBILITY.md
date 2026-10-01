# Accessibility

The target is WCAG 2.2 level AA for the web app, the staff dashboard and the
iPhone app. This page covers how that is checked, what the October 2026
audit fixed, and what still needs a person.

## Automated checks (run in CI)

| Check | What it covers | Where |
| --- | --- | --- |
| axe-core, web app | Login, Map, Ride, Routes, Friends, Settings and Search, in light (Chromium) and dark (WebKit) | `tests/visual/pwa.spec.js` |
| axe-core, staff dashboard | Overview, Moderation, Riders and System, light and dark | `tests/visual/admin.spec.js` |
| iPhone app controls | Every `Pressable` has an accessibility role; icon-only ones have a label; backdrops opt out with `accessible={false}` | `mobile/tests/pressableAccessibility.test.ts` |

The axe runs use the WCAG 2.0/2.1/2.2 A and AA rules plus axe's best
practices (`tests/visual/axe.js`). A failing run lists every rule and element
that broke.

Automated tools catch roughly a third of real problems. Passing them is the
floor, not the finish line.

## What the audit fixed

- **Contrast (web app and iPhone app):**
  - Muted text was 3.6–4.1:1. It is now darker in light mode (`#58666E`) and lighter in dark mode (`#85919A`), at least 4.5:1 on every surface.
  - The brand blue was 2.6:1 on light backgrounds, so text and small marks now use `accentInk` (`#156E90`) in light mode. This covers the active tab label, codes, links and "load older".
- **Contrast (dashboard):** muted text `#6b6b6b`, and links and accents `#c2410c` in light mode. Chart marks keep the brighter orange.
- **Names for controls:** the search fields now have labels instead of relying on placeholders.
- **iPhone app:**
  - **Labels.** Icon-only buttons now have labels: show/hide password, back, send, clear search, delete hideout, remove rider and collapse ride controls.
  - **Roles.** About 40 controls that had no role now announce themselves as buttons or links.
  - **Sheets.** Sheet backdrops no longer swallow their contents into one VoiceOver element.
- **Landmarks:**
  - The login photo is marked decorative.
  - The Google attribution on search is a footer landmark.

## Deliberate exception: page zoom in the web app

`index.html` sets `user-scalable=no`. The web app is a full-screen map, and
page zoom fights the map's own pinch-to-zoom while riding, so axe's
`meta-viewport` rule is switched off. Text size is the gap this leaves.
Revisit it if riders ask for larger text: honouring the browser's text-size
setting would cover it without page zoom.

## Still needs a person

These can't be automated reliably. Check them before a public launch:

- **VoiceOver on a real iPhone.**
  - Walk through sign-up, joining a ride, voice, Nearby, friends and chat.
  - Check reading order on the map screen and that announcements aren't noisy while riding.
- **Dynamic Type.** Set the largest text sizes in iOS Settings, then check that nothing is clipped, especially the ride bar and navigation banner.
- **Keyboard only in the web app.**
  - Tab through every screen and sheet.
  - Focus must be visible and must not escape an open sheet.
- **Reduce Motion.** Map camera moves and marker glides should respect it. The iPhone app reads the setting; confirm it behaves.
- **Colour-only meaning.** Rider markers use grey for stale. Confirm that stale is also conveyed some other way to VoiceOver users.
