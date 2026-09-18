import * as Speech from 'expo-speech';
import { audioEngine } from './audioEngine.ts';
import { NavigationPromptController } from './navigationPromptController.ts';

const controller = new NavigationPromptController(
  {
    speak(text, options) {
      Speech.speak(text, {
        onStart: options.onStart,
        onDone: options.onDone,
        onStopped: options.onStopped,
        onError: options.onError,
      });
    },
    stop() {
      return Speech.stop();
    },
  },
  audioEngine
);

export function speakNavigationPrompt(text: string): void {
  controller.speak(text);
}

export function stopNavigationPrompt(): Promise<void> {
  return controller.stop();
}
