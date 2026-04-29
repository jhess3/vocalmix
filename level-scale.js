const DLIVE_DB_POINTS = [
  { db: 10, midi: 127 },
  { db: 5, midi: 117 },
  { db: 0, midi: 107 },
  { db: -5, midi: 97 },
  { db: -10, midi: 87 },
  { db: -15, midi: 77 },
  { db: -20, midi: 67 },
  { db: -25, midi: 57 },
  { db: -30, midi: 47 },
  { db: -35, midi: 37 },
  { db: -40, midi: 27 },
  { db: -45, midi: 17 },
  { db: Number.NEGATIVE_INFINITY, midi: 0 },
];

function clampMidiValue(value) {
  return Math.max(0, Math.min(127, Math.round(Number(value) || 0)));
}

function levelToMidiValue(level) {
  return clampMidiValue((Number(level) || 0) * 127);
}

function midiValueToLevel(midiValue) {
  return clampMidiValue(midiValue) / 127;
}

function midiValueToDb(midiValue) {
  const value = clampMidiValue(midiValue);
  if (value === 0) {
    return Number.NEGATIVE_INFINITY;
  }

  for (let index = 0; index < DLIVE_DB_POINTS.length - 1; index += 1) {
    const current = DLIVE_DB_POINTS[index];
    const next = DLIVE_DB_POINTS[index + 1];

    if (value <= current.midi && value >= next.midi) {
      if (!Number.isFinite(next.db)) {
        const ratio = (value - next.midi) / (current.midi - next.midi);
        return -90 + (ratio * (current.db + 90));
      }

      const ratio = (value - next.midi) / (current.midi - next.midi);
      return next.db + (ratio * (current.db - next.db));
    }
  }

  return Number.NEGATIVE_INFINITY;
}

function dbToMidiValue(db) {
  if (!Number.isFinite(db)) {
    return 0;
  }

  if (db >= DLIVE_DB_POINTS[0].db) {
    return DLIVE_DB_POINTS[0].midi;
  }

  for (let index = 0; index < DLIVE_DB_POINTS.length - 1; index += 1) {
    const current = DLIVE_DB_POINTS[index];
    const next = DLIVE_DB_POINTS[index + 1];
    if (!Number.isFinite(next.db)) {
      continue;
    }

    if (db <= current.db && db >= next.db) {
      const ratio = (db - next.db) / (current.db - next.db);
      return clampMidiValue(next.midi + (ratio * (current.midi - next.midi)));
    }
  }

  return 0;
}

function dbToLevel(db) {
  return midiValueToLevel(dbToMidiValue(db));
}

module.exports = {
  DLIVE_DB_POINTS,
  levelToMidiValue,
  midiValueToLevel,
  midiValueToDb,
  dbToMidiValue,
  dbToLevel,
};
