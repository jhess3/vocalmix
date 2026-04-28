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

// Simple JSON file storage for profiles
const DATA_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE,
  '.vocalmix'
);
const PROFILES_FILE = path.join(DATA_DIR, 'profiles.json');
const MATRIX_FILE = path.join(DATA_DIR, 'matrix.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

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

// Default profiles for Vox 1-8
function getDefaultProfiles() {
  return Array.from({ length: 8 }, (_, i) => ({
    id: i + 1,
    slot: `Vox ${i + 1}`,
    name: '',
    auxBus: i + 1,
    color: ['#E85D4A', '#E8A44A', '#4AE88D', '#4A9EE8', '#C77DFF', '#FF6B9D', '#00D4AA', '#8B8B8B'][i],
    allowedChannels: [],
    savedLevels: {},
    lastConnected: null,
    presets: [],
  }));
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

  // ── API Routes ─────────────────────────────────────────────

  // Server discovery endpoint — iPads ping this
  app.get('/api/ping', (req, res) => {
    res.json({
      name: 'VocalMix Server',
      version: '1.0.0',
      timestamp: Date.now(),
    });
  });

  // Get all profiles
  app.get('/api/profiles', (req, res) => {
    const profiles = loadJSON(PROFILES_FILE, getDefaultProfiles());
    res.json(profiles);
  });

  // Update a profile
  app.put('/api/profiles/:id', (req, res) => {
    const profiles = loadJSON(PROFILES_FILE, getDefaultProfiles());
    const id = parseInt(req.params.id);
    const idx = profiles.findIndex(p => p.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Profile not found' });

    profiles[idx] = { ...profiles[idx], ...req.body, id };
    saveJSON(PROFILES_FILE, profiles);
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
    const settings = loadJSON(SETTINGS_FILE, {
      dliveIP: '192.168.1.70',
      serverName: 'VocalMix',
      autoConnect: true,
      faderMin: -60,  // dB floor for vocalists
      faderMax: 6,    // dB ceiling for vocalists
    });
    res.json(settings);
  });

  // Update settings
  app.put('/api/settings', (req, res) => {
    const settings = loadJSON(SETTINGS_FILE, {});
    const updated = { ...settings, ...req.body };
    saveJSON(SETTINGS_FILE, updated);
    res.json(updated);
  });

  // Login endpoint for iPad clients
  app.post('/api/login', (req, res) => {
    const { profileId } = req.body;
    const profiles = loadJSON(PROFILES_FILE, getDefaultProfiles());
    const profile = profiles.find(p => p.id === profileId);

    if (!profile) return res.status(404).json({ error: 'Profile not found' });

    // Load the matrix to get allowed channels
    const matrix = loadJSON(MATRIX_FILE, {});
    const allowedChannels = [];

    // Extract channels for this aux from the matrix
    Object.entries(matrix).forEach(([key, value]) => {
      if (value && key.startsWith(`${profile.auxBus}-`)) {
        const ch = parseInt(key.split('-')[1]);
        if (!isNaN(ch)) allowedChannels.push(ch);
      }
    });

    // Update last connected
    profile.lastConnected = new Date().toISOString();
    const idx = profiles.findIndex(p => p.id === profileId);
    profiles[idx] = profile;
    saveJSON(PROFILES_FILE, profiles);

    // Track connected client
    const clientInfo = {
      profileId: profile.id,
      name: profile.name || profile.slot,
      aux: profile.auxBus,
      connectedAt: Date.now(),
    };
    serverState.connectedClients = serverState.connectedClients.filter(
      c => c.profileId !== profileId
    );
    serverState.connectedClients.push(clientInfo);

    res.json({
      profile,
      allowedChannels,
      savedLevels: profile.savedLevels || {},
    });
  });

  // Save fader levels from iPad client
  app.post('/api/save-levels', (req, res) => {
    const { profileId, levels } = req.body;
    const profiles = loadJSON(PROFILES_FILE, getDefaultProfiles());
    const idx = profiles.findIndex(p => p.id === profileId);

    if (idx === -1) return res.status(404).json({ error: 'Profile not found' });

    profiles[idx].savedLevels = levels;
    saveJSON(PROFILES_FILE, profiles);
    res.json({ success: true });
  });

  // Client disconnect
  app.post('/api/logout', (req, res) => {
    const { profileId } = req.body;
    serverState.connectedClients = serverState.connectedClients.filter(
      c => c.profileId !== profileId
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

module.exports = { startServer, stopServer, getServerState };
