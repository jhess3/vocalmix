const test = require('node:test');
const assert = require('node:assert/strict');

const { DLiveConnection } = require('../dlive');

test('incoming dLive send-level SysEx emits an aux-send-level event', async () => {
  const dlive = new DLiveConnection();

  const eventPromise = new Promise((resolve) => {
    dlive.once('aux-send-level', resolve);
  });

  dlive._parseSysExMessage(Buffer.from([
    0xF0, 0x00, 0x00, 0x1A, 0x50, 0x10, 0x01, 0x00,
    0x00, 0x0D, 0x00, 0x02, 0x00, 0x40, 0xF7,
  ]));

  const event = await eventPromise;

  assert.deepEqual(event, {
    auxBus: 1,
    inputChannel: 1,
    level: 64 / 127,
  });
});
export {};
