import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

test('native discards GPS subscriptions that resolve after resume or unmount', async () => {
  const effects: Array<() => () => void> = [];
  const pending: Array<(value: { remove(): void }) => void> = [];
  let onAppState: (state: string) => void = () => {};
  let defaultLocked: boolean | undefined;
  const react = {
    createContext(value: { lockedForSafety: boolean }) {
      defaultLocked = value.lockedForSafety;
      return { Provider: 'provider' };
    },
    useRef: (current: unknown) => ({ current }),
    useState: (initial: unknown) => [initial, () => {}],
    useEffect: (effect: () => () => void) => effects.push(effect),
    useMemo: (factory: () => unknown) => factory(),
    createElement: () => null,
  };
  const source = readFileSync(new URL('../src/safety/MovementSafetyContext.tsx', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
  }).outputText;
  const exports: { MovementSafetyProvider?: (props: { children: null }) => unknown } = {};
  vm.runInNewContext(compiled, {
    exports, setInterval: () => 1, clearInterval() {},
    require(name: string) {
      if (name === 'react') return react;
      if (name === 'react-native') return {
        AppState: { addEventListener: (_: string, callback: typeof onAppState) => {
          onAppState = callback;
          return { remove() {} };
        } }, Linking: {},
      };
      if (name === 'expo-location') return {
        Accuracy: { Balanced: 3 },
        hasServicesEnabledAsync: async () => true,
        getForegroundPermissionsAsync: async () => ({ granted: true }),
        watchPositionAsync: () => new Promise(resolve => pending.push(resolve)),
      };
      if (name === '@rider-comms/shared') return {
        MovementStateTracker: class { markUnavailable() { return 'unknown'; } },
        isLockedForSafety: () => false,
      };
      if (name === './movementAdapter') return {};
      throw new Error(`Unexpected import ${name}`);
    },
  });
  exports.MovementSafetyProvider!({ children: null });
  assert.equal(defaultLocked, false, 'unknown initial state must not lock controls');
  const cleanup = effects[0]();
  const flush = () => new Promise(resolve => setImmediate(resolve));
  await flush();
  onAppState('background');
  onAppState('active');
  await flush();
  assert.equal(pending.length, 2);
  let oldRemoved = 0;
  let activeRemoved = 0;
  pending[1]({ remove() { activeRemoved++; } });
  await flush();
  pending[0]({ remove() { oldRemoved++; } });
  await flush();
  assert.equal(oldRemoved, 1, 'late obsolete subscription must be removed');
  assert.equal(activeRemoved, 0, 'current subscription must remain active');
  onAppState('active');
  await flush();
  cleanup();
  let unmountedRemoved = 0;
  pending[2]({ remove() { unmountedRemoved++; } });
  await flush();
  assert.equal(activeRemoved, 1);
  assert.equal(unmountedRemoved, 1, 'subscription returned after unmount must be removed');
});
