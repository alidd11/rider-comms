import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [appConfigSource, appSource, rideBarSource, proximitySource, voiceActivitySource] = await Promise.all([
  readFile(new URL('../mobile/app.json', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/App.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/src/ride/RideBar.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/src/voice/ProximityVoice.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/src/audio/useVoiceActivity.ts', import.meta.url), 'utf8'),
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

console.log('Native LiveKit bootstrap and safe microphone invariants valid');
