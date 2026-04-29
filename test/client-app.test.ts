const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');

async function loadClientAppModule() {
  const moduleUrl = pathToFileURL(path.join(__dirname, '..', 'client', 'app.js')).href;
  const importModule = new Function('modulePath', 'return import(modulePath);') as (modulePath: string) => Promise<unknown>;
  return importModule(moduleUrl) as Promise<any>;
}

test('createInitialState starts with normalized client defaults', async () => {
  const { createInitialState } = await loadClientAppModule();

  assert.deepEqual(createInitialState(), {
    currentProfile: null,
    allowedChannels: [],
    faderLevels: {},
    auxMasterLevel: 0.7,
    mutedChannels: new Set(),
    activeTouches: {},
    savedMixes: [],
    currentLoadedMixId: null,
    currentLoadedMixName: '',
    faderSendTimers: {},
    liveEventSource: null,
    channels: [],
    profiles: [],
    auxBuses: [],
  });
});

test('applyLoginState hydrates the logged-in profile and live levels into one state object', async () => {
  const { createInitialState, applyLoginState } = await loadClientAppModule();
  const state = createInitialState();

  applyLoginState(state, {
    profile: { id: 2, auxBus: 7, color: '#ff0000', slot: 'Lead' },
    allowedChannels: [3, 5],
    savedMixes: [{ id: 'mix-1', name: 'Sunday AM' }],
    liveLevels: { 3: 0.25 },
    liveAuxMasterLevel: 0.55,
  });

  assert.equal(state.currentProfile.id, 2);
  assert.deepEqual(state.allowedChannels, [3, 5]);
  assert.deepEqual(state.savedMixes, [{ id: 'mix-1', name: 'Sunday AM' }]);
  assert.equal(state.currentLoadedMixId, null);
  assert.equal(state.currentLoadedMixName, '');
  assert.equal(state.auxMasterLevel, 0.55);
  assert.deepEqual(state.faderLevels, { 3: 0.25, 5: 0.7 });
  assert.deepEqual([...state.mutedChannels], []);
});

test('applyRecalledMixLevels only updates allowed channels and falls back to zero for missing levels', async () => {
  const { createInitialState, applyRecalledMixLevels } = await loadClientAppModule();
  const state = createInitialState();
  state.allowedChannels = [1, 2, 3];
  state.faderLevels = { 1: 0.8, 2: 0.6, 3: 0.4, 9: 0.9 };

  applyRecalledMixLevels(state, { 1: 0.1, 3: 0.3, 9: 1 });

  assert.deepEqual(state.faderLevels, {
    1: 0.1,
    2: 0,
    3: 0.3,
    9: 0.9,
  });
});
export {};
