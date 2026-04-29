const test = require('node:test');
const assert = require('node:assert/strict');

const { DLiveConnection } = require('../dlive');

test('setAuxSendLevel writes the official dLive SysEx aux send level message', () => {
  const dlive = new DLiveConnection();
  const writes = [];

  dlive._connected = true;
  dlive._socket = {
    write(buffer) {
      writes.push(Buffer.from(buffer));
    },
  };

  const sent = dlive.setAuxSendLevel(1, 1, 0.5);

  assert.equal(sent, true);
  assert.equal(writes.length, 1);
  assert.deepEqual(
    [...writes[0]],
    [0xF0, 0x00, 0x00, 0x1A, 0x50, 0x10, 0x01, 0x00, 0x00, 0x0D, 0x00, 0x02, 0x00, 0x40, 0xF7]
  );
});

test('setAuxMasterLevel writes the official dLive NRPN aux master fader message', () => {
  const dlive = new DLiveConnection();
  const writes = [];

  dlive._connected = true;
  dlive._socket = {
    write(buffer) {
      writes.push(Buffer.from(buffer));
    },
  };

  const sent = dlive.setAuxMasterLevel(1, 0.5);

  assert.equal(sent, true);
  assert.equal(writes.length, 1);
  assert.deepEqual(
    [...writes[0]],
    [0xB2, 0x63, 0x00, 0xB2, 0x62, 0x17, 0xB2, 0x06, 0x40]
  );
});

test('getAuxMasterLevel requests the dLive aux master fader and resolves the returned level', async () => {
  const dlive = new DLiveConnection();
  const writes = [];

  dlive._connected = true;
  dlive._socket = {
    write(buffer) {
      writes.push(Buffer.from(buffer));
      process.nextTick(() => {
        dlive._parseMidiMessage(Buffer.from([0xB2, 0x63, 0x00, 0xB2, 0x62, 0x17, 0xB2, 0x06, 0x40]));
      });
    },
  };

  const result = await dlive.getAuxMasterLevel(1);

  assert.deepEqual(result, { success: true, auxBus: 1, level: 64 / 127 });
  assert.equal(writes.length, 1);
  assert.deepEqual(
    [...writes[0]],
    [0xF0, 0x00, 0x00, 0x1A, 0x50, 0x10, 0x01, 0x00, 0x02, 0x05, 0x0B, 0x17, 0x00, 0xF7]
  );
});
export {};
