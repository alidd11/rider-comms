import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AudioEngine } from '../src/audio/audioEngine.ts';
import {
  NavigationPromptController,
  type NavigationSpeechAdapter,
  type NavigationSpeechOptions,
} from '../src/audio/navigationPromptController.ts';

class FakeSpeech implements NavigationSpeechAdapter {
  options: NavigationSpeechOptions[] = [];
  spoken: string[] = [];
  stopCalls = 0;

  speak(text: string, options: NavigationSpeechOptions): void {
    this.spoken.push(text);
    this.options.push(options);
  }

  stop(): void {
    this.stopCalls += 1;
  }
}

describe('native navigation prompt controller', () => {
  it('marks navigation active while a prompt is playing and clears it on completion', () => {
    const speech = new FakeSpeech();
    const engine = new AudioEngine();
    const controller = new NavigationPromptController(speech, engine);

    controller.speak(' Turn left   onto A1 ');
    assert.deepEqual(speech.spoken, ['Turn left onto A1']);
    assert.equal(engine.getGains().nav, 1);

    speech.options[0]?.onDone?.();
    assert.equal(engine.getGains().nav, 0);
  });

  it('does not let a cancelled older prompt clear a newer prompt', () => {
    const speech = new FakeSpeech();
    const engine = new AudioEngine();
    const controller = new NavigationPromptController(speech, engine);

    controller.speak('First turn');
    controller.speak('Second turn');
    assert.equal(engine.getGains().nav, 1);

    speech.options[0]?.onStopped?.();
    assert.equal(engine.getGains().nav, 1);

    speech.options[1]?.onDone?.();
    assert.equal(engine.getGains().nav, 0);
    assert.equal(speech.stopCalls, 2);
  });

  it('clears navigation priority when explicitly stopped or speech fails', async () => {
    const speech = new FakeSpeech();
    const engine = new AudioEngine();
    const controller = new NavigationPromptController(speech, engine);

    controller.speak('Continue straight');
    speech.options[0]?.onError?.();
    assert.equal(engine.getGains().nav, 0);

    controller.speak('Next turn');
    await controller.stop();
    assert.equal(engine.getGains().nav, 0);
  });
});
