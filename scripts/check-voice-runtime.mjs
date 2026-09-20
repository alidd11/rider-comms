import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [appConfigSource, appSource, rideBarSource, proximitySource, proximityStateSource, voiceActivitySource, audioSessionSource, activeSpeakerSource, mapScreenSource, pwaSource, serverSource] = await Promise.all([
  readFile(new URL('../mobile/app.json', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/App.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/src/ride/RideBar.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/src/voice/ProximityVoice.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/src/voice/proximityVoiceState.ts', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/src/audio/useVoiceActivity.ts', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/src/audio/audioSession.ts', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/src/voice/ActiveSpeakerBridge.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/src/screens/MapScreen.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../docs/app.js', import.meta.url), 'utf8'),
  readFile(new URL('../backend/src/server.ts', import.meta.url), 'utf8'),
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
  voiceActivitySource,
  /SPEAKING_ATTACK_THRESHOLD\s*=\s*0\.035[\s\S]*SPEAKING_RELEASE_THRESHOLD\s*=\s*0\.02[\s\S]*SPEAKING_ATTACK_HOLD_MS\s*=\s*70[\s\S]*RELEASE_HANGTIME_MS\s*=\s*650/,
  'Native VOX must keep the tuned sensitive gate, hysteresis and anti-spike attack hold',
);
assert.match(
  pwaSource,
  /VOICE_SPEAKING_ATTACK_THRESHOLD\s*=\s*0\.035[\s\S]*VOICE_SPEAKING_RELEASE_THRESHOLD\s*=\s*0\.02[\s\S]*VOICE_ATTACK_HOLD_MS\s*=\s*70[\s\S]*VOICE_RELEASE_HANGTIME_MS\s*=\s*650/,
  'PWA VOX must stay aligned with the tuned native sensitivity envelope',
);
assert.match(
  audioSessionSource,
  /audioCategory:\s*'playAndRecord'[\s\S]*audioCategoryOptions:\s*\[[^\]]*'mixWithOthers'[^\]]*'allowBluetoothA2DP'/,
  'iOS voice must preserve external music mixing and A2DP output where the selected route supports it',
);
assert.match(
  audioSessionSource,
  /manageAudioFocus:\s*true[\s\S]*audioFocusMode:\s*'gainTransientMayDuck'/,
  'Android voice must request ducking focus instead of stopping external music',
);

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
  rideBarSource,
  /voice\.error[\s\S]*voice\.retryable[\s\S]*scheduleVoiceRetry\(\)/,
  'Private ride voice must retry transient token failures that happen before LiveKitRoom exists',
);
assert.match(
  rideBarSource,
  /function useVoiceAudioSession\(active: boolean, retryKey: number\)[\s\S]*\[active, retryKey\]/,
  'Native private-ride audio routing must support an explicit rider-initiated retry without requiring the ride to change',
);
assert.match(
  rideBarSource,
  /const retryVoiceManually = React\.useCallback[\s\S]*if \(audioSessionError\) setAudioSessionRetryVersion[\s\S]*setVoiceRetryVersion/,
  'Native voice manual retry must re-acquire failed audio routing without churning a healthy session, and refresh voice credentials',
);
assert.match(
  rideBarSource,
  /voiceFailure\)[\s\S]*retryVoiceManually\(\)[\s\S]*Retry voice/,
  'Native voice failure UI must expose a rider-initiated retry action',
);
assert.match(
  pwaSource,
  /shouldRetryVoiceConnection\(error\)[\s\S]*scheduleVoiceReconnect\(requestedTarget\)/,
  'PWA voice must retry transient token/connect failures that happen before a room exists',
);
assert.match(
  pwaSource,
  /shouldRetryVoiceConnection\(error\)[\s\S]*NotAllowedError[\s\S]*SecurityError[\s\S]*NotFoundError[\s\S]*return false/,
  'PWA voice must not timer-retry microphone permission/security/no-device failures',
);
assert.match(
  pwaSource,
  /async function resumeVoiceMeterContext\(\)[\s\S]*context\.resume\(\)[\s\S]*context\.state === 'running'/,
  'PWA voice must explicitly resume a suspended Web Audio VOX context',
);
assert.match(
  pwaSource,
  /context\.onstatechange = \(\) => \{[\s\S]*context\.state !== 'running'\) setVoiceSpeaking\(false\)[\s\S]*renderVoiceStatus\(\)/,
  'PWA voice must fail closed when Web Audio stops running instead of leaving transmission latched on',
);
assert.match(
  pwaSource,
  /meterNeedsResume[\s\S]*Resume voice[\s\S]*resumeVoiceMeterContext\(\)/,
  'PWA voice must expose rider-initiated recovery when its VOX analyser is suspended',
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
  serverSource,
  /PROXIMITY_VOICE_AUTHORIZATION_LEASE_MS[\s\S]*authorizationLeaseMs:\s*PROXIMITY_VOICE_AUTHORIZATION_LEASE_MS/,
  'Backend public voice must publish an explicit renewable authorization lease',
);
assert.match(
  proximitySource,
  /const expireAuthorizationLease[\s\S]*setConnections\(\[\]\)[\s\S]*setAuthorizationExpired\(true\)/,
  'Native public voice must fail closed when its proximity authorization lease expires',
);
assert.match(
  proximitySource,
  /renewAuthorizationLease\(timing\.authorizationLeaseMs\)/,
  'Native public voice must renew its authorization lease only after a successful server response',
);
assert.match(
  proximitySource,
  /setConnectedPeers\(\(current\) => prunePeerSet[\s\S]*setSpeakingPeers\(\(current\) => prunePeerSet[\s\S]*setLocalSpeakingPeers\(\(current\) => prunePeerSet/,
  'Native public voice must immediately prune stale connected, remote-speaking and local-speaking peer state',
);
assert.match(
  proximityStateSource,
  /localSpeaking[\s\S]*Nearby Voice · You speaking/,
  'Native Nearby Voice status must expose when the local rider is transmitting',
);
assert.match(
  pwaSource,
  /function expirePublicVoiceAuthorizationLease\(\)[\s\S]*setVoiceSpeaking\(false\)[\s\S]*proximityVoiceRooms\.clear\(\)[\s\S]*scheduleVoiceReconnect\('channel'\)/,
  'PWA public voice must mute and disconnect stale pair rooms when authorization cannot be renewed',
);
assert.match(
  pwaSource,
  /renewPublicVoiceAuthorizationLease\(response\.authorizationLeaseMs\)/,
  'PWA public voice must renew its authorization lease only after a successful server response',
);
assert.match(
  pwaSource,
  /publicVoiceConnectInFlight[\s\S]*publicVoiceRefreshPending[\s\S]*queueMicrotask\(\(\) => syncVoiceConnection\(\)\)/,
  'PWA public voice must serialize overlapping authorization/connect refreshes and replay one pending refresh',
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
