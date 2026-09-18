export interface NavigationSpeechCallbacks {
  onStart?: () => void;
  onDone?: () => void;
  onStopped?: () => void;
  onError?: () => void;
}

export interface NavigationSpeechAdapter {
  speak(text: string, callbacks: NavigationSpeechCallbacks): void;
  stop(): void | Promise<void>;
}

export interface NavigationPromptAudio {
  setNavPromptActive(active: boolean): void;
}

/**
 * Coordinates best-effort native turn speech with the shared audio-priority
 * state. It deliberately owns only prompt lifecycle/deduplication; platform
 * TTS and real output gain application stay behind injected adapters.
 */
export class NavigationSpeechController {
  private lastStepKey: string | null = null;
  private generation = 0;

  constructor(
    private readonly speech: NavigationSpeechAdapter,
    private readonly audio: NavigationPromptAudio
  ) {}

  speakStep(stepIndex: number, instruction: string): boolean {
    const text = instruction.trim();
    if (!text) return false;
    const key = `${stepIndex}:${text}`;
    if (key === this.lastStepKey) return false;
    this.lastStepKey = key;
    this.speak(text);
    return true;
  }

  speakStatus(text: string): boolean {
    const message = text.trim();
    if (!message) return false;
    this.speak(message);
    return true;
  }

  resetRoute(): void {
    this.lastStepKey = null;
  }

  stop(): void {
    this.generation += 1;
    this.audio.setNavPromptActive(false);
    void Promise.resolve(this.speech.stop()).catch(() => {});
  }

  private speak(text: string): void {
    const generation = ++this.generation;
    this.audio.setNavPromptActive(false);
    void Promise.resolve(this.speech.stop()).catch(() => {});

    const finish = () => {
      if (generation !== this.generation) return;
      this.audio.setNavPromptActive(false);
    };

    try {
      this.audio.setNavPromptActive(true);
      this.speech.speak(text, {
        onStart: () => {
          if (generation === this.generation) this.audio.setNavPromptActive(true);
        },
        onDone: finish,
        onStopped: finish,
        onError: finish,
      });
    } catch {
      finish();
    }
  }
}
