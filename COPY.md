# Copy: how Rider Comms talks

Words in both apps should read as if one rider wrote them for another: plain,
short and specific. `scripts/check-copy-voice.mjs` (part of `npm run lint`)
enforces the mechanical rules on every UI string in `docs/app`,
`docs/index.html` and `mobile/src`.

## Rules the lint checks
- **Contractions, with a curly apostrophe:** Couldn’t, can’t, don’t, isn’t, you’re. Not "Could not", not "don't".
- **Full stops, not dashes:** "Muted. Tap to unmute.", not "Muted — tap to unmute".
- **No "please".** Say what to do: "Check your connection and try again."
- **Name features the same everywhere:** Nearby Voice, Ride Safe, Where to, Your plan.
- **The app doesn't talk about itself:** "Couldn’t send that report", not "Rider Comms couldn’t send that report".

## Rules for people
- Say what happened, then what to do. One idea per sentence.
- No server or engineering words: "not configured", "service", "on the server", "request failed".
- Point to the exact place in the app, using its real labels and arrows:
  Settings → Account and login → Email.
- Sentence case for titles and buttons ("Delete account", not "Delete Account").
- No exclamation marks, emoji, "Oops" or marketing words ("seamless", "unlock", "journey").
- Web and native say the same thing for the same moment; the parity checks compare the important ones.

The editorial route catalogue (`curatedRoutes.ts`, `docs/routes.js`) and the
legal pages keep their own, more formal style.
