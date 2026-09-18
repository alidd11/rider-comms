import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { NavigationSpeechController, type NavigationSpeechCallbacks } from '../src/navigationSpeech.ts';

class FakeSpeech {
  spoken: string[] = [];
  callbacks: NavigationSpeechCallbacks[] = [];
  stopCalls = 0;

  speak(text: string, callbacks: NavigationSpeechCallbacks): void {
    this.spoken.push(text);
    this.callbacks.push(callbacks);
  }

  stop(): void {
    this.stopCalls += 1;
  }
}

class FakeAudio {
  states: boolean[] = [];

  setNavPromptActive(active: boolean): void {
    this.states.push(active);
  }
}

describe('NavigationSpeechController', () => {
  it('announces each navigation step once and resets for a new route', () => {
    const speech = new FakeSpeech();
    const audio = new FakeAudio();
    const controller = new NavigationSpeechController(speech, audio);

    assert.equal(controller.speakStep(0, 'Turn left onto High Street'), true);
    assert.equal(controller.speakStep(0, 'Turn left onto High Street'), false);
    assert.deepEqual(speech.spoken, ['Turn left onto High Street']);

    controller.resetRoute();
    assert.equal(controller.speakStep(0, 'Turn left onto High Street'), true);
    assert.deepEqual(speech.spoken, ['Turn left onto High Street', 'Turn left onto High Street']);
  });

  it('marks navigation audio active only for the current prompt lifecycle', () => {
    const speech = new FakeSpeech();
    const audio = new FakeAudio();
    const controller = new NavigationSpeechController(speech, audio);

    controller.speakStatus('Rerouting.');
    assert.equal(audio.states.at(-1), true);

    speech.callbacks[0]?.onDone?.();
    assert.equal(audio.states.at(-1), false);

    controller.speakStatus('You have arrived at your destination.');
    const staleDone = speech.callbacks[0]?.onDone;
    staleDone?.();
    assert.equal(audio.states.at(-1), true);

    speech.callbacks[1]?.onError?.();
    assert.equal(audio.states.at(-1), false);
  });

  it('stops speech and clears navigation priority when navigation ends', () => {
    const speech = new FakeSpeech();
    const audio = new FakeAudio();
    const controller = new NavigationSpeechController(speech, audio);

    controller.speakStep(1, 'Continue straight');
    controller.stop();

    assert.ok(speech.stopCalls >= 2);
    assert.equal(audio.states.at(-1), false);
  });

  it('ignores empty prompt text', () => {
    const speech = new FakeSpeech();
    const audio = new FakeAudio();
    const controller = new NavigationSpeechController(speech, audio);

    assert.equal(controller.speakStep(0, '   '), false);
    assert.equal(controller.speakStatus(''), false);
    assert.deepEqual(speech.spoken, []);
  });
});
