import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

test('native restores ride membership and consent from the server and ignores late responses after logout', async () => {
  const effects: Array<() => () => void> = [];
  const values = new Map<number, unknown>();
  let stateIndex = 0;
  let response: (ride: unknown) => void = () => {};
  const client = {
    getCurrentRide: () => new Promise(resolve => { response = (ride) => resolve({ ride }); }),
  };
  const react = {
    createContext: () => ({ Provider: 'provider' }),
    useContext: () => null,
    useRef: (value: unknown) => ({ current: value }),
    useState: (initial: unknown) => {
      const index = stateIndex++;
      values.set(index, initial);
      return [initial, (next: unknown) => values.set(index, next)];
    },
    useEffect: (effect: () => () => void) => effects.push(effect),
    useCallback: (fn: unknown) => fn,
    useMemo: (fn: () => unknown) => fn(),
    createElement: () => null,
  };
  const source = readFileSync(new URL('../src/ride/RideContext.tsx', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
  }).outputText;
  const exports: { RideProvider?: (props: { children: null }) => unknown } = {};
  vm.runInNewContext(compiled, {
    exports, setInterval: () => 1, clearInterval() {},
    require(name: string) {
      if (name === 'react') return react;
      if (name === 'expo-location') return {};
      if (name === 'react-native') return { AppState: {
        currentState: 'active', addEventListener: () => ({ remove() {} }),
      } };
      if (name === '../auth/AuthContext') return { useAuth: () => ({ client, riderId: 'rider-a' }) };
      if (name === '../api/client') return { ApiError: class {} };
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  exports.RideProvider!({ children: null });
  const cleanup = effects[0]();
  response({ rideId: 'server-ride', code: 'ABCDEF', createdBy: 'rider-a', memberIds: ['rider-a'], shareRideLocation: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual({ ...(values.get(0) as Record<string, unknown>) }, {
    rideId: 'server-ride', code: 'ABCDEF', isHost: true, shareRideLocation: true,
  });
  assert.deepEqual(values.get(1), ['rider-a']);
  cleanup();

  // A late result from the old authenticated rider must never restore a ride
  // into the next account's session.
  const next = effects[0]();
  next();
  response({ rideId: 'stale-ride', createdBy: 'rider-a', memberIds: ['rider-a'], shareRideLocation: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(values.get(0), null);
});


test('native stops polling after an authoritative no-ride restore and retries only failures', async () => {
  const source = readFileSync(new URL('../src/ride/RideContext.tsx', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
  }).outputText;

  const runRestore = async (result: 'empty' | 'error') => {
    const effects: Array<() => () => void> = [];
    let stateIndex = 0;
    let currentRideCalls = 0;
    let retryCount = 0;
    const client = {
      getCurrentRide: async () => {
        currentRideCalls += 1;
        if (result === 'error') throw new Error('temporary outage');
        return { ride: null };
      },
    };
    const react = {
      createContext: () => ({ Provider: 'provider' }),
      useContext: () => null,
      useRef: (value: unknown) => ({ current: value }),
      useState: (initial: unknown) => {
        stateIndex += 1;
        return [initial, () => {}];
      },
      useEffect: (effect: () => () => void) => effects.push(effect),
      useCallback: (fn: unknown) => fn,
      useMemo: (fn: () => unknown) => fn(),
      createElement: () => null,
    };
    const exports: { RideProvider?: (props: { children: null }) => unknown } = {};
    vm.runInNewContext(compiled, {
      exports,
      setInterval: () => { throw new Error('idle restore must not use an interval'); },
      clearInterval() {},
      setTimeout: () => { retryCount += 1; return 1; },
      clearTimeout() {},
      require(name: string) {
        if (name === 'react') return react;
        if (name === 'expo-location') return {};
        if (name === 'react-native') return { AppState: {
          currentState: 'active', addEventListener: () => ({ remove() {} }),
        } };
        if (name === '../auth/AuthContext') return { useAuth: () => ({ client, riderId: 'rider-a' }) };
        if (name === '../api/client') return { ApiError: class {} };
        throw new Error(`Unexpected import: ${name}`);
      },
    });

    exports.RideProvider!({ children: null });
    const cleanup = effects[0]!();
    await new Promise(resolve => setImmediate(resolve));
    cleanup();
    return { currentRideCalls, retryCount };
  };

  assert.deepEqual(await runRestore('empty'), { currentRideCalls: 1, retryCount: 0 });
  assert.deepEqual(await runRestore('error'), { currentRideCalls: 1, retryCount: 1 });
});
