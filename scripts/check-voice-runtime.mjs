import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [appConfigSource, appSource, rideBarSource, proximitySource, voiceActivitySource, activeSpeakerSource, mapScreenSource, pwaSource] = await Promise.all([
  readFile(new URL('../mobile/app.json', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/App.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/src/ride/RideBar.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/src/voice/ProximityVoice.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/src/audio/useVoiceActivity.ts', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/src/voice/ActiveSpeakerBridge.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/src/screens/MapScreen.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../docs/app.js', import.meta.url), 'utf8'),
]);

const appConfig = JSON.parse(appConfigSource);
const plugins = new Set(appConfig?.expo?.plugins ?? []);
for (const plugin of ['@livekit/react-native-expo-plugin', '@config-plugins/react-native-webrtc']) {
  assert.ok(plugins.has(plugin), `Native voice requires Expo config plugin: ${plugin}`);
}

assert.match(
  appSource,
  /registerGlobals\(\{\s*autoConfigureAudioSession:\s*false\s*\}\)/,
  'Rider Comms must disable LiveKit automatic iOS audio management because audioSession.ts owns AVAudioSession',
);

for (const [label, source] of [['private ride', rideBarSource], ['proximity', proximitySource]]) {
  assert.doesNotMatch(
    source,
    /<LiveKitRoom[^>]*\baudio(?:\s|=|>)/s,
    `${label} voice must not auto-publish an open microphone from LiveKitRoom`,
  );
}

const muteIndex = voiceActivitySource.indexOf('await createdTrack.mute();');
const publishIndex = voiceActivitySource.indexOf('await localParticipant.publishTrack(createdTrack);');
assert.ok(muteIndex >= 0 && publishIndex > muteIndex, 'Native microphone track must be muted before publication');

assert.match(
  rideBarSource,
  /voice\.token\s*&&\s*voice\.url\s*&&\s*audioSession\.ready/,
  'Private ride voice must wait for native audio-session readiness before connecting',
);
assert.match(
  proximitySource,
  /connect=\{audioSessionReady\}/,
  'Proximity voice must wait for native audio-session readiness before connecting',
);
assert.match(
  activeSpeakerSource,
  /RoomEvent\.ActiveSpeakersChanged/,
  'Native voice must use LiveKit active-speaker events rather than infer remote speaking from mute state',
);
assert.match(
  proximitySource,
  /<ActiveSpeakerBridge[\s\S]*speakerIds\.includes\(connection\.peerId\)/,
  'Native proximity voice must surface which authorised nearby peer is actively speaking',
);
assert.match(
  rideBarSource,
  /<ActiveSpeakerBridge[\s\S]*activeSpeakerLabel/,
  'Native private rides must surface the active speaker in persistent ride UI',
);

const profileWrite = mapScreenSource.indexOf("await client.updateProfile(riderId, { shareLocation: true });");
const localGoLive = mapScreenSource.indexOf('setShareLocation(true);');
assert.ok(
  profileWrite >= 0 && localGoLive > profileWrite,
  'Nearby Voice must confirm backend location-sharing consent before enabling local presence',
);
assert.match(
  mapScreenSource,
  /requestCurrentLocation\(false, Location\.Accuracy\.High, false\)/,
  'Nearby Voice presence must request a high-accuracy fix compatible with backend presence validation',
);
assert.match(
  mapScreenSource,
  /<ProximityVoice enabled=\{shareLocation\} peerIds=\{ridersInZone\} \/>/,
  'Nearby Voice transport must remain mounted for the live session while the peer roster changes',
);
assert.match(
  pwaSource,
  /events\.TrackSubscribed[\s\S]*track\.attach\(\)/,
  'PWA voice must attach subscribed remote audio tracks for playback',
);
assert.match(
  pwaSource,
  /events\.TrackUnsubscribed[\s\S]*track\.detach\(\)/,
  'PWA voice must detach remote audio tracks during teardown',
);
assert.match(
  pwaSource,
  /events\.ActiveSpeakersChanged[\s\S]*voiceRemoteSpeakersByRoom/,
  'PWA voice must track LiveKit remote active speakers',
);
assert.match(
  pwaSource,
  /voiceSpeakerChip[\s\S]*remoteSpeakerSummary/,
  'PWA public voice must render a visible active-speaker indicator',
);
assert.match(
  pwaSource,
  /ridePillVoiceLabel[\s\S]*remoteSpeakerSummary[\s\S]*You speaking/,
  'PWA private-ride speaker identity must remain visible in the global ride pill across tabs',
);

console.log('Native/PWA LiveKit bootstrap, safe microphone, and active-speaker invariants valid');
