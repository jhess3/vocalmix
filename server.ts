/**
 * VocalMix HTTP Server
 * 
 * Serves the iPad mixing interface and admin API.
 * Advertises via Bonjour so iPads can find it automatically.
 */

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

let app = null;
let httpServer = null;
let bonjour = null;
let serverState = {
  port: 3000,
  running: false,
  connectedClients: [],
};
const eventStreams = new Set<any>();
let dliveProvider: any = {
  getStatus: () => ({
    connected: false,
    ip: null,
    channels: [],
    auxBuses: [],
  }),
  resync: async () => ({ success: false, error: 'dLive not configured' }),
  getAuxSendLevels: async () => ({ success: false, error: 'dLive not configured', levels: {} }),
  getAuxMasterLevel: async () => ({ success: false, error: 'dLive not configured' }),
  applyAuxSendLevels: async () => ({ success: false, error: 'dLive not configured' }),
  setAuxSendLevel: () => false,
  setAuxMasterLevel: () => false,
};

// Simple JSON file storage for profiles
const DATA_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE,
  '.vocalmix'
);
const PROFILES_FILE = path.join(DATA_DIR, 'profiles.json');
const SAVED_MIXES_FILE = path.join(DATA_DIR, 'saved-mixes.json');
const MATRIX_FILE = path.join(DATA_DIR, 'matrix.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

function getDefaultSettings() {
  return {
    dliveIP: '',
    serverName: 'VocalMix',
    autoConnect: true,
    faderMin: -60,
    faderMax: 6,
  };
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadJSON(filepath, defaultValue) {
  try {
    if (fs.existsSync(filepath)) {
      return JSON.parse(fs.readFileSync(filepath, 'utf8'));
    }
  } catch (e) {
    console.error(`Error loading ${filepath}:`, e.message);
  }
  return defaultValue;
}

function saveJSON(filepath, data) {
  ensureDataDir();
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
}

function loadSettings() {
  const settings = loadJSON(SETTINGS_FILE, getDefaultSettings());

  // Normalize legacy bootstrap defaults so the app does not auto-connect
  // to a placeholder MixRack address before the user has configured one.
  if (settings.dliveIP === '192.168.1.70' && settings.autoConnect === true) {
    return {
      ...settings,
      dliveIP: '',
      autoConnect: false,
    };
  }

  return settings;
}

function saveSettings(settings) {
  const updated = { ...getDefaultSettings(), ...settings };
  saveJSON(SETTINGS_FILE, updated);
  return updated;
}

// Default profiles are fixed mic slots to minimize churn in profiles.json.
function getDefaultProfiles() {
  return Array.from({ length: 8 }, (_, i) => ({
    id: i + 1,
    slot: `Mic ${i + 1}`,
    label: `Mic ${i + 1}`,
    name: '',
    auxBus: i + 1,
    color: ['#E85D4A', '#E8A44A', '#4AE88D', '#4A9EE8', '#C77DFF', '#FF6B9D', '#00D4AA', '#8B8B8B'][i],
    allowedChannels: [],
    savedLevels: {},
    lastConnected: null,
    presets: [],
  }));
}

function normalizeProfile(profile, index) {
  const fallback = getDefaultProfiles()[index] || {
    id: index + 1,
    slot: `Mic ${index + 1}`,
    label: `Mic ${index + 1}`,
    auxBus: index + 1,
    allowedChannels: [],
  };

  return {
    ...fallback,
    ...profile,
    id: fallback.id,
    slot: fallback.slot,
    label: fallback.label,
    auxBus: Number(profile?.auxBus ?? fallback.auxBus),
    allowedChannels: Array.isArray(profile?.allowedChannels) ? profile.allowedChannels : fallback.allowedChannels,
    savedLevels: profile?.savedLevels && typeof profile.savedLevels === 'object' ? profile.savedLevels : {},
    presets: Array.isArray(profile?.presets) ? profile.presets : [],
  };
}

function loadProfiles() {
  const storedProfiles = loadJSON(PROFILES_FILE, getDefaultProfiles());
  return getDefaultProfiles().map((fallback, index) => {
    const stored = Array.isArray(storedProfiles)
      ? storedProfiles.find((profile) => Number(profile.id) === fallback.id) || storedProfiles[index]
      : null;
    return normalizeProfile(stored, index);
  });
}

function saveProfiles(profiles) {
  saveJSON(PROFILES_FILE, profiles.map((profile, index) => normalizeProfile(profile, index)));
}

function getDefaultSavedMixes() {
  return [];
}

function loadSavedMixes() {
  const mixes = loadJSON(SAVED_MIXES_FILE, getDefaultSavedMixes());
  if (!Array.isArray(mixes)) return [];

  return mixes
    .filter((mix) => mix && typeof mix === 'object')
    .map((mix) => ({
      id: String(mix.id || ''),
      name: String(mix.name || '').trim(),
      levels: normalizeLevelsMap(mix.levels),
      updatedAt: mix.updatedAt || new Date(0).toISOString(),
    }))
    .filter((mix) => mix.id && mix.name);
}

function saveSavedMixes(mixes) {
  saveJSON(SAVED_MIXES_FILE, mixes);
}

function normalizeLevelsMap(levels) {
  const normalized = {};
  if (!levels || typeof levels !== 'object' || Array.isArray(levels)) {
    return normalized;
  }

  Object.entries(levels).forEach(([channel, level]) => {
    const normalizedChannel = Number(channel);
    const normalizedLevel = Number(level);
    if (
      Number.isInteger(normalizedChannel) &&
      normalizedChannel > 0 &&
      Number.isFinite(normalizedLevel) &&
      normalizedLevel >= 0 &&
      normalizedLevel <= 1
    ) {
      normalized[String(normalizedChannel)] = normalizedLevel;
    }
  });

  return normalized;
}

function validateSavedMixPayload(body, { requireName = true } = {}) {
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const levels = normalizeLevelsMap(body?.levels);

  if (requireName && !name) {
    return { valid: false, error: 'Mix name is required' };
  }

  if (!Object.keys(levels).length) {
    return { valid: false, error: 'Mix levels are required' };
  }

  return {
    valid: true,
    value: {
      name,
      levels,
    },
  };
}

function getAllowedChannelsForAux(matrix, auxBus) {
  const allowedChannels = [];
  Object.entries(matrix || {}).forEach(([key, value]) => {
    if (value && key.startsWith(`${auxBus}-`)) {
      const ch = Number.parseInt(key.split('-')[1], 10);
      if (!Number.isNaN(ch)) {
        allowedChannels.push(ch);
      }
    }
  });

  return allowedChannels.sort((a, b) => a - b);
}

function resolveSlot(profiles, slotIdOrProfileId) {
  const normalizedId = Number(slotIdOrProfileId);
  if (!Number.isInteger(normalizedId)) {
    return null;
  }

  return profiles.find((profile) => profile.id === normalizedId) || null;
}

function getAvailableAuxIds() {
  const status = dliveProvider.getStatus();
  const auxBuses = Array.isArray(status.auxBuses) ? status.auxBuses : [];
  return new Set(auxBuses.map((aux) => aux.id));
}

function validateProfileAuxAssignment(profiles, profileId, nextAuxBus) {
  if (nextAuxBus == null) {
    return { valid: false, status: 400, error: 'Aux bus is required' };
  }

  const availableAuxIds = getAvailableAuxIds();
  if (availableAuxIds.size > 0 && !availableAuxIds.has(nextAuxBus)) {
    return { valid: false, status: 400, error: 'Aux bus is not available from dLive' };
  }

  const conflict = profiles.find((profile) => profile.id !== profileId && profile.auxBus === nextAuxBus);
  if (conflict) {
    return {
      valid: false,
      status: 409,
      error: `Aux ${nextAuxBus} is already assigned to ${conflict.name || conflict.slot}`,
    };
  }

  return { valid: true };
}

function setDLiveProvider(provider) {
  dliveProvider = {
    ...dliveProvider,
    ...provider,
  };
}

function broadcastAuxSendLevel(payload) {
  const normalizedAuxBus = Number(payload?.auxBus);
  const normalizedInputChannel = Number(payload?.inputChannel);
  const normalizedLevel = Number(payload?.level);
  if (
    !Number.isInteger(normalizedAuxBus) ||
    !Number.isInteger(normalizedInputChannel) ||
    !Number.isFinite(normalizedLevel)
  ) {
    return;
  }

  const message = `event: aux-send-level\ndata: ${JSON.stringify({
    type: 'aux-send-level',
    auxBus: normalizedAuxBus,
    inputChannel: normalizedInputChannel,
    level: normalizedLevel,
  })}\n\n`;

  eventStreams.forEach((stream) => {
    try {
      stream.write(message);
    } catch (error) {
      eventStreams.delete(stream);
    }
  });
}

function broadcastAuxMasterLevel(payload) {
  const normalizedAuxBus = Number(payload?.auxBus);
  const normalizedLevel = Number(payload?.level);
  if (!Number.isInteger(normalizedAuxBus) || !Number.isFinite(normalizedLevel)) {
    return;
  }

  const message = `event: aux-master-level\ndata: ${JSON.stringify({
    type: 'aux-master-level',
    auxBus: normalizedAuxBus,
    level: normalizedLevel,
  })}\n\n`;

  eventStreams.forEach((stream) => {
    try {
      stream.write(message);
    } catch (error) {
      eventStreams.delete(stream);
    }
  });
}

function startServer(port = 3000) {
  ensureDataDir();

  app = express();
  app.use(cors());
  app.use(express.json());

  // Serve iPad web client
  app.use('/client', express.static(path.join(__dirname, 'client')));

  // Serve admin UI
  app.use('/admin', express.static(path.join(__dirname, 'ui')));

  // Serve shared browser modules
  app.use('/shared', express.static(path.join(__dirname, 'shared')));

  // ── API Routes ─────────────────────────────────────────────

  // Server discovery endpoint — iPads ping this
  app.get('/api/ping', (req, res) => {
    res.json({
      name: 'VocalMix Server',
      version: '1.0.0',
      timestamp: Date.now(),
    });
  });

  app.get('/api/dlive-status', (req, res) => {
    res.json(dliveProvider.getStatus());
  });

  app.get('/api/channels', (req, res) => {
    const status = dliveProvider.getStatus();
    res.json(status.channels || []);
  });

  app.get('/api/events', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(': connected\n\n');

    const heartbeatId = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch (error) {
        clearInterval(heartbeatId);
        eventStreams.delete(res);
      }
    }, 25000);

    eventStreams.add(res);

    req.on('close', () => {
      clearInterval(heartbeatId);
      eventStreams.delete(res);
    });
  });

  app.post('/api/dlive/resync', async (req, res) => {
    try {
      const result = await dliveProvider.resync();
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post('/api/dlive/connect', async (req, res) => {
    try {
      const { ip } = req.body || {};
      const result = await dliveProvider.connect(ip);
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post('/api/dlive/disconnect', async (req, res) => {
    try {
      const result = await dliveProvider.disconnect();
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post('/api/dlive/send-levels', async (req, res) => {
    try {
      const { auxBus, inputChannels } = req.body || {};
      const result = await dliveProvider.getAuxSendLevels(inputChannels || [], auxBus);
      if (result.success === false) {
        return res.status(503).json(result);
      }
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, error: error.message, levels: {} });
    }
  });

  // Get all profiles
  app.get('/api/profiles', (req, res) => {
    const profiles = loadProfiles();
    res.json(profiles);
  });

  // Update a profile
  app.put('/api/profiles/:id', (req, res) => {
    const profiles = loadProfiles();
    const id = parseInt(req.params.id);
    const idx = profiles.findIndex(p => p.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Profile not found' });

    const nextAuxBus = Number(req.body.auxBus);
    const validation = validateProfileAuxAssignment(profiles, id, nextAuxBus);
    if (!validation.valid) {
      return res.status(validation.status).json({ error: validation.error });
    }

    profiles[idx] = { ...profiles[idx], ...req.body, id, auxBus: nextAuxBus };
    saveProfiles(profiles);
    res.json(profiles[idx]);
  });

  // Get channel access matrix
  app.get('/api/matrix', (req, res) => {
    const matrix = loadJSON(MATRIX_FILE, {});
    res.json(matrix);
  });

  // Update channel access matrix
  app.put('/api/matrix', (req, res) => {
    saveJSON(MATRIX_FILE, req.body);
    res.json({ success: true });
  });

  // Get settings (dLive IP, network config, etc.)
  app.get('/api/settings', (req, res) => {
    const settings = loadSettings();
    res.json(settings);
  });

  // Update settings
  app.put('/api/settings', (req, res) => {
    const updated = saveSettings(req.body);
    res.json(updated);
  });

  app.get('/api/saved-mixes', (req, res) => {
    res.json(loadSavedMixes());
  });

  app.post('/api/saved-mixes', (req, res) => {
    const validation = validateSavedMixPayload(req.body, { requireName: true });
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }

    const mixes = loadSavedMixes();
    const savedMix = {
      id: `mix-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: validation.value.name,
      levels: validation.value.levels,
      updatedAt: new Date().toISOString(),
    };

    mixes.push(savedMix);
    saveSavedMixes(mixes);
    res.status(201).json(savedMix);
  });

  app.put('/api/saved-mixes/:id', (req, res) => {
    const validation = validateSavedMixPayload(req.body, { requireName: false });
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }

    const mixes = loadSavedMixes();
    const idx = mixes.findIndex((mix) => mix.id === req.params.id);
    if (idx === -1) {
      return res.status(404).json({ error: 'Saved mix not found' });
    }

    mixes[idx] = {
      ...mixes[idx],
      name: validation.value.name || mixes[idx].name,
      levels: validation.value.levels,
      updatedAt: new Date().toISOString(),
    };
    saveSavedMixes(mixes);
    res.json(mixes[idx]);
  });

  // Login endpoint for iPad clients
  app.post('/api/login', (req, res) => {
    const { slotId, profileId } = req.body || {};
    const profiles = loadProfiles();
    const profile = resolveSlot(profiles, slotId ?? profileId);

    if (!profile) return res.status(404).json({ error: 'Slot not found' });

    const matrix = loadJSON(MATRIX_FILE, {});
    const allowedChannels = getAllowedChannelsForAux(matrix, profile.auxBus);

    profile.lastConnected = new Date().toISOString();
    const idx = profiles.findIndex((p) => p.id === profile.id);
    profiles[idx] = profile;
    saveProfiles(profiles);

    const clientInfo = {
      slotId: profile.id,
      profileId: profile.id,
      name: profile.label || profile.slot,
      aux: profile.auxBus,
      connectedAt: Date.now(),
    };
    serverState.connectedClients = serverState.connectedClients.filter(
      (c) => c.slotId !== profile.id
    );
    serverState.connectedClients.push(clientInfo);

    res.json({
      slot: profile,
      allowedChannels,
      savedMixes: loadSavedMixes(),
    });
  });

  // Legacy endpoint kept as a harmless no-op for older clients.
  app.post('/api/save-levels', (req, res) => {
    res.json({ success: true, ignored: true });
  });

  const handleAuxSendLevel = (req, res) => {
    const { slotId, profileId, auxBus, inputChannel, level } = req.body || {};
    const profiles = loadProfiles();
    const slot = resolveSlot(profiles, slotId ?? profileId);
    const resolvedAuxBus = auxBus != null ? Number(auxBus) : slot?.auxBus;
    const normalizedInputChannel = Number(inputChannel);
    const normalizedLevel = Number(level);

    if (!Number.isInteger(resolvedAuxBus) || resolvedAuxBus <= 0) {
      return res.status(400).json({ error: 'Aux bus is required' });
    }

    if (!Number.isInteger(normalizedInputChannel) || normalizedInputChannel <= 0) {
      return res.status(400).json({ error: 'inputChannel must be a positive integer' });
    }

    if (!Number.isFinite(normalizedLevel) || normalizedLevel < 0 || normalizedLevel > 1) {
      return res.status(400).json({ error: 'Level must be between 0 and 1' });
    }

    const status = dliveProvider.getStatus();
    if (!status.connected) {
      return res.status(503).json({ success: false, error: 'dLive not connected' });
    }

    const sendApplied = dliveProvider.setAuxSendLevel(normalizedInputChannel, resolvedAuxBus, normalizedLevel);
    if (sendApplied === false) {
      return res.status(502).json({
        success: false,
        error: 'Failed to apply aux send level',
      });
    }

    res.json({
      success: true,
      slotId: slot?.id || null,
      auxBus: resolvedAuxBus,
      inputChannel: normalizedInputChannel,
      level: normalizedLevel,
    });
  };

  app.post('/api/aux-send-level', handleAuxSendLevel);
  app.post('/api/fader-level', handleAuxSendLevel);

  app.post('/api/dlive/aux-master-level', async (req, res) => {
    const normalizedAuxBus = Number(req.body?.auxBus);
    if (!Number.isInteger(normalizedAuxBus) || normalizedAuxBus <= 0) {
      return res.status(400).json({ error: 'Aux bus is required' });
    }

    const status = dliveProvider.getStatus();
    if (!status.connected) {
      return res.status(503).json({ success: false, error: 'dLive not connected' });
    }

    try {
      const result = await dliveProvider.getAuxMasterLevel(normalizedAuxBus);
      if (result?.success === false) {
        return res.status(400).json(result);
      }

      res.json(result);
    } catch (error) {
      res.status(502).json({
        success: false,
        error: 'Failed to fetch aux master level',
      });
    }
  });

  app.post('/api/aux-master-level', (req, res) => {
    const { slotId, profileId, auxBus, level } = req.body || {};
    const profiles = loadProfiles();
    const slot = resolveSlot(profiles, slotId ?? profileId);
    const resolvedAuxBus = auxBus != null ? Number(auxBus) : slot?.auxBus;
    const normalizedLevel = Number(level);

    if (!Number.isInteger(resolvedAuxBus) || resolvedAuxBus <= 0) {
      return res.status(400).json({ error: 'Aux bus is required' });
    }

    if (!Number.isFinite(normalizedLevel) || normalizedLevel < 0 || normalizedLevel > 1) {
      return res.status(400).json({ error: 'Level must be between 0 and 1' });
    }

    const status = dliveProvider.getStatus();
    if (!status.connected) {
      return res.status(503).json({ success: false, error: 'dLive not connected' });
    }

    const sendApplied = dliveProvider.setAuxMasterLevel(resolvedAuxBus, normalizedLevel);
    if (sendApplied === false) {
      return res.status(502).json({
        success: false,
        error: 'Failed to apply aux master level',
      });
    }

    res.json({
      success: true,
      slotId: slot?.id || null,
      auxBus: resolvedAuxBus,
      level: normalizedLevel,
    });
  });

  app.post('/api/recall-mix', async (req, res) => {
    const { slotId, profileId, mixId } = req.body || {};
    const profiles = loadProfiles();
    const slot = resolveSlot(profiles, slotId ?? profileId);
    if (!slot) {
      return res.status(404).json({ error: 'Slot not found' });
    }

    const mixes = loadSavedMixes();
    const mix = mixes.find((savedMix) => savedMix.id === mixId);
    if (!mix) {
      return res.status(404).json({ error: 'Saved mix not found' });
    }

    const status = dliveProvider.getStatus();
    if (!status.connected) {
      return res.status(503).json({ success: false, error: 'dLive not connected' });
    }

    try {
      const result = await dliveProvider.applyAuxSendLevels(slot.auxBus, mix.levels);
      if (result?.success === false) {
        return res.status(400).json(result);
      }

      res.json({
        success: true,
        slot,
        mix: {
          ...mix,
          auxBus: slot.auxBus,
        },
        levels: mix.levels,
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Client disconnect
  app.post('/api/logout', (req, res) => {
    const { slotId, profileId } = req.body || {};
    const normalizedId = Number(slotId ?? profileId);
    serverState.connectedClients = serverState.connectedClients.filter(
      (c) => c.slotId !== normalizedId
    );
    res.json({ success: true });
  });

  // Redirect root to client
  app.get('/', (req, res) => {
    res.redirect('/client');
  });

  // ── Start server ───────────────────────────────────────────

  httpServer = http.createServer(app);
  httpServer.listen(port, '0.0.0.0', () => {
    serverState.port = port;
    serverState.running = true;
    console.log(`[Server] Listening on port ${port}`);

    // Advertise via Bonjour / mDNS
    try {
      const Bonjour = require('bonjour-service').Bonjour;
      bonjour = new Bonjour();
      bonjour.publish({
        name: 'VocalMix Server',
        type: 'http',
        port: port,
        txt: { app: 'vocalmix', version: '1.0.0' },
      });
      console.log('[Bonjour] Advertising vocalmix on local network');
    } catch (e) {
      console.warn('[Bonjour] Could not start advertisement:', e.message);
      console.warn('[Bonjour] iPads can still connect via IP or .local hostname');
    }
  });
}

function stopServer() {
  eventStreams.forEach((stream) => {
    try {
      stream.end();
    } catch (error) {
      // Ignore stream shutdown errors during app exit.
    }
  });
  eventStreams.clear();
  if (httpServer) {
    httpServer.close();
    httpServer = null;
  }
  if (bonjour) {
    bonjour.unpublishAll();
    bonjour.destroy();
    bonjour = null;
  }
  serverState.running = false;
}

function getServerState() {
  return { ...serverState };
}

module.exports = {
  startServer,
  stopServer,
  getServerState,
  setDLiveProvider,
  broadcastAuxSendLevel,
  broadcastAuxMasterLevel,
  loadSettings,
  saveSettings,
  getDefaultSettings,
};
export {};
