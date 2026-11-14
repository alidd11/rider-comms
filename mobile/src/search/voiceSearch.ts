import * as React from 'react';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';

export interface VoiceSearch {
  /** False where the phone has no speech recognition: no mic is shown. */
  available: boolean;
  listening: boolean;
  /** Starts listening, or stops if it already is. */
  toggle: () => void;
}

/**
 * Voice search, like the mic in Google Maps and Waze: what the rider says
 * lands in the search box (PWA: startVoiceSearch). The caller hides it while
 * a voice room is connected, so recognition never takes the microphone or the
 * audio session from group or Nearby Voice.
 */
export function useVoiceSearch(onWords: (words: string) => void, onProblem: (message: string) => void): VoiceSearch {
  const [listening, setListening] = React.useState(false);
  const listeningRef = React.useRef(false);
  const available = React.useMemo(() => {
    try {
      return ExpoSpeechRecognitionModule.isRecognitionAvailable();
    } catch {
      return false;
    }
  }, []);

  const setBoth = React.useCallback((next: boolean) => {
    listeningRef.current = next;
    setListening(next);
  }, []);

  useSpeechRecognitionEvent('end', () => setBoth(false));
  useSpeechRecognitionEvent('result', (event) => {
    const words = event.results[0]?.transcript?.trim();
    if (words) onWords(words);
  });
  useSpeechRecognitionEvent('error', (event) => {
    setBoth(false);
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      onProblem('Allow the microphone and speech recognition to search by voice');
    } else if (event.error !== 'no-speech' && event.error !== 'aborted' && event.error !== 'speech-timeout') {
      onProblem('Couldn’t hear that. Try again or type instead.');
    }
  });

  // Stop listening when the search closes.
  React.useEffect(() => () => {
    if (listeningRef.current) ExpoSpeechRecognitionModule.abort();
  }, []);

  const toggle = React.useCallback(() => {
    if (listeningRef.current) {
      ExpoSpeechRecognitionModule.abort();
      setBoth(false);
      return;
    }
    setBoth(true);
    void ExpoSpeechRecognitionModule.requestPermissionsAsync().then((permission) => {
      if (!listeningRef.current) return;
      if (!permission.granted) {
        setBoth(false);
        onProblem('Allow the microphone and speech recognition to search by voice');
        return;
      }
      ExpoSpeechRecognitionModule.start({
        interimResults: true,
        maxAlternatives: 1,
        // Mix with whatever is playing (directions), and hand the session
        // back when done.
        iosCategory: { category: 'playAndRecord', categoryOptions: ['defaultToSpeaker', 'allowBluetooth', 'mixWithOthers'], mode: 'measurement' },
      });
    }, () => {
      setBoth(false);
      onProblem('Couldn’t hear that. Try again or type instead.');
    });
  }, [onProblem, setBoth]);

  return { available, listening, toggle };
}
