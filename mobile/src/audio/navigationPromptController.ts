import type { AudioEngine } from './audioEngine.ts';

export interface NavigationSpeechOptions {
  onStart?: () => void;
  onDone?: () => void;
  onStopped?: () => void;
  onError?: () => void;
}

export interface NavigationSpeechAdapter {
  speak(text: string, options: NavigationSpeechOptions): void;
  stop(): Promise<void> | void;
}

/**
 * Coordinates spoken turn prompts with Rider Comms' logical audio-priority
 * state. A generation token prevents an older cancelled utterance from
 * clearing the nav-active flag for a newer prompt.
 *
 * This only updates the priority model. Applying those gains to LiveKit /
 * music output is still separate native mixer work.
 */
export class NavigationPromptController {
  private generation = 0;
  private readonly speech: NavigationSpeechAdapter;
  private readonly audioEngine: Pick<AudioEngine, 'setNavPromptActive'>;

  constructor(
    speech: NavigationSpeechAdapter,
    audioEngine: Pick<AudioEngine, 'setNavPromptActive'>
  ) {
    this.speech = speech;
    this.audioEngine = audioEngine;
  }

  speak(text: string): void {
    const cleaned = text.replace(/\s+/g, ' ').trim();
    if (!cleaned) return;

    const token = ++this.generation;
    try {
      void Promise.resolve(this.speech.stop()).catch(() => undefined);
    } catch {
      // A failed cancellation must not block the next spoken instruction.
    }
    this.audioEngine.setNavPromptActive(true);

    const finish = () => {
      if (token !== this.generation) return;
      this.audioEngine.setNavPromptActive(false);
    };

    try {
      this.speech.speak(cleaned, {
        onStart: () => {
          if (token === this.generation) this.audioEngine.setNavPromptActive(true);
        },
        onDone: finish,
        onStopped: finish,
        onError: finish,
      });
    } catch {
      finish();
    }
  }

  async stop(): Promise<void> {
    this.generation += 1;
    this.audioEngine.setNavPromptActive(false);
    try {
      await this.speech.stop();
    } catch {
      // A failed stop must never leave the priority model stuck in nav mode.
    }
  }
}
