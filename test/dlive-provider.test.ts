const test = require('node:test');
const assert = require('node:assert/strict');

const { createDLiveProvider } = require('../dlive-provider');

test('createDLiveProvider forwards live send operations to the dLive connection', async () => {
  const calls = [];
  const fakeDLive = {
    isConnected: () => true,
    getIP: () => '10.0.0.5',
    getChannels: () => [{ ch: 1, name: 'Lead Vox' }],
    getAuxBuses: () => [{ id: 7, name: 'Vox Wedge' }],
    refreshChannelNames: async () => ({ success: true }),
    getAuxSendLevels: async (channels, auxBus) => ({ success: true, channels, auxBus }),
    getAuxMasterLevel: async (auxBus) => ({ success: true, auxBus, level: 0.61 }),
    applyAuxSendLevels: async (auxBus, levels) => {
      calls.push({ type: 'apply', auxBus, levels });
      return { success: true };
    },
    setAuxSendLevel: (inputChannel, auxBus, level) => {
      calls.push({ type: 'set', inputChannel, auxBus, level });
      return true;
    },
    setAuxMasterLevel: (auxBus, level) => {
      calls.push({ type: 'set-master', auxBus, level });
      return true;
    },
    connect: async (ip) => ({ success: true, ip }),
    disconnect: () => undefined,
  };

  const provider = createDLiveProvider(fakeDLive);

  assert.equal(provider.getStatus().connected, true);
  assert.deepEqual(await provider.getAuxMasterLevel(7), { success: true, auxBus: 7, level: 0.61 });
  assert.deepEqual(await provider.applyAuxSendLevels(7, { 1: 0.42 }), { success: true });
  assert.equal(provider.setAuxSendLevel(12, 7, 0.84), true);
  assert.equal(provider.setAuxMasterLevel(7, 0.52), true);
  assert.deepEqual(calls, [
    { type: 'apply', auxBus: 7, levels: { 1: 0.42 } },
    { type: 'set', inputChannel: 12, auxBus: 7, level: 0.84 },
    { type: 'set-master', auxBus: 7, level: 0.52 },
  ]);
});
export {};
