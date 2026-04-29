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
