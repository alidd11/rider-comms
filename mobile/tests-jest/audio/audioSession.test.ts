const mockCalls: string[] = [];
const mockSetAppleAudioConfiguration = jest.fn(async (config: { audioCategory: string }) => {
  mockCalls.push(`category:${config.audioCategory}`);
});
const mockStartAudioSession = jest.fn(async () => { mockCalls.push('start'); });
const mockStopAudioSession = jest.fn(async () => { mockCalls.push('stop'); });
const mockStartForegroundService = jest.fn(async () => { mockCalls.push('fgs:start'); });
const mockStopForegroundService = jest.fn(async () => { mockCalls.push('fgs:stop'); });

jest.mock('@livekit/react-native', () => ({
  AudioSession: {
    configureAudio: async () => { mockCalls.push('configure'); },
    setAppleAudioConfiguration: (config: { audioCategory: string }) => mockSetAppleAudioConfiguration(config),
    startAudioSession: () => mockStartAudioSession(),
    stopAudioSession: () => mockStopAudioSession(),
  },
}));

jest.mock('../../src/audio/voiceForegroundService', () => ({
  startAndroidVoiceForegroundService: () => mockStartForegroundService(),
  stopAndroidVoiceForegroundService: () => mockStopForegroundService(),
}));

type AudioSessionModule = typeof import('../../src/audio/audioSession');

// A fresh copy per test: the module tracks owners and the session mode.
function loadAudioSession(): AudioSessionModule {
  let loaded!: AudioSessionModule;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    loaded = require('../../src/audio/audioSession');
  });
  return loaded;
}

beforeEach(() => {
  mockCalls.length = 0;
  mockStartForegroundService.mockImplementation(async () => { mockCalls.push('fgs:start'); });
  mockStopForegroundService.mockImplementation(async () => { mockCalls.push('fgs:stop'); });
  mockStartAudioSession.mockImplementation(async () => { mockCalls.push('start'); });
  mockStopAudioSession.mockImplementation(async () => { mockCalls.push('stop'); });
});

test('navigation alone holds a mixing playback session so prompts play when locked', async () => {
  const session = loadAudioSession();

  await session.acquireNavigationAudioSession();
  expect(mockCalls).toEqual(['category:playback', 'start']);
  expect(mockSetAppleAudioConfiguration).toHaveBeenLastCalledWith(expect.objectContaining({
    audioCategory: 'playback',
    audioMode: 'voicePrompt',
    audioCategoryOptions: expect.arrayContaining(['mixWithOthers']),
  }));

  await session.releaseNavigationAudioSession();
  expect(mockCalls).toEqual(['category:playback', 'start', 'stop']);
});

test('voice takes over from navigation and hands the session back', async () => {
  const session = loadAudioSession();
  await session.acquireNavigationAudioSession();
  mockCalls.length = 0;

  await session.acquireVoiceAudioSession('private-ride');
  expect(mockCalls).toEqual(['stop', 'fgs:start', 'configure', 'category:playAndRecord', 'start']);

  mockCalls.length = 0;
  await session.releaseVoiceAudioSession('private-ride');
  expect(mockCalls).toEqual(['stop', 'fgs:stop', 'category:playback', 'start']);
});

test('navigation starting or ending during a call leaves voice alone', async () => {
  const session = loadAudioSession();
  await session.acquireVoiceAudioSession('proximity');
  mockCalls.length = 0;

  await session.acquireNavigationAudioSession();
  await session.releaseNavigationAudioSession();
  expect(mockCalls).toEqual([]);

  await session.releaseVoiceAudioSession('proximity');
  expect(mockCalls).toEqual(['stop', 'fgs:stop']);
});

test('voice stays up until its last owner leaves', async () => {
  const session = loadAudioSession();
  await session.acquireVoiceAudioSession('private-ride');
  await session.acquireVoiceAudioSession('proximity');
  mockCalls.length = 0;

  await session.releaseVoiceAudioSession('private-ride');
  expect(mockCalls).toEqual([]);
  await session.releaseVoiceAudioSession('proximity');
  expect(mockCalls).toEqual(['stop', 'fgs:stop']);
});

test('a failed voice start restores the navigation prompt session', async () => {
  const session = loadAudioSession();
  await session.acquireNavigationAudioSession();
  mockCalls.length = 0;
  mockStartForegroundService.mockRejectedValueOnce(new Error('no microphone permission'));

  await expect(session.acquireVoiceAudioSession('private-ride')).rejects.toThrow('no microphone permission');
  expect(mockCalls).toEqual(['stop', 'category:playback', 'start']);

  // The failed owner was dropped, so a retry starts voice afresh.
  mockCalls.length = 0;
  await session.acquireVoiceAudioSession('private-ride');
  expect(mockCalls).toEqual(['stop', 'fgs:start', 'configure', 'category:playAndRecord', 'start']);
});

test('rejects a blank voice owner', async () => {
  const session = loadAudioSession();
  await expect(session.acquireVoiceAudioSession('  ')).rejects.toThrow('owner is required');
});

test('a voice session that fails to start doesn’t strand the Android voice notification', async () => {
  const session = loadAudioSession();
  mockStartAudioSession.mockRejectedValueOnce(new Error('audio busy'));
  await expect(session.acquireVoiceAudioSession('private-ride')).rejects.toThrow('audio busy');
  expect(mockCalls).toContain('fgs:stop');
});

test('stopping voice still stops the notification when audio teardown fails', async () => {
  const session = loadAudioSession();
  await session.acquireVoiceAudioSession('private-ride');
  mockCalls.length = 0;
  mockStopAudioSession.mockRejectedValueOnce(new Error('teardown failed'));
  mockStopForegroundService.mockRejectedValueOnce(new Error('service gone'));
  await expect(session.releaseVoiceAudioSession('private-ride')).rejects.toThrow('teardown failed');
});

test('a failure to stop the notification is reported when audio stopped cleanly', async () => {
  const session = loadAudioSession();
  await session.acquireVoiceAudioSession('private-ride');
  mockStopForegroundService.mockRejectedValueOnce(new Error('service gone'));
  await expect(session.releaseVoiceAudioSession('private-ride')).rejects.toThrow('service gone');
});

