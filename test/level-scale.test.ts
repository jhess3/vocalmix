const test = require('node:test');
const assert = require('node:assert/strict');

const {
  levelToMidiValue,
  midiValueToDb,
  dbToLevel,
} = require('../shared/level-scale');

test('dLive unity maps to 0 dB', () => {
  assert.equal(midiValueToDb(107), 0);
  assert.equal(levelToMidiValue(dbToLevel(0)), 107);
});

test('dLive minimum and top-of-scale map to documented values', () => {
  assert.equal(midiValueToDb(0), Number.NEGATIVE_INFINITY);
  assert.equal(midiValueToDb(127), 10);
});
export {};
