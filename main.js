const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell } = require('electron');
const path = require('path');
const { startServer, stopServer, getServerState, setDLiveProvider, loadSettings } = require('./server');
const { DLiveConnection } = require('./dlive');

let mainWindow = null;
let tray = null;
let dlive = null;

// Keep reference to prevent garbage collection
app.dock?.hide(); // Hide dock icon — tray-only app

function createTrayIcon(status = 'disconnected') {
  // Generate a simple tray icon programmatically
  const size = 22;
  const canvas = `
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
      <rect x="5" y="3" width="3" height="16" rx="1.5" fill="${status === 'connected' ? '#34C759' : '#FF9500'}" opacity="0.9"/>
      <rect x="10" y="7" width="3" height="12" rx="1.5" fill="white" opacity="0.7"/>
      <rect x="15" y="5" width="3" height="14" rx="1.5" fill="white" opacity="0.5"/>
    </svg>
  `;
  return nativeImage.createFromBuffer(
    Buffer.from(canvas),
    { width: size, height: size }
  );
}

function createWindow() {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#111113',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  });

  mainWindow.loadFile('ui/index.html');

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('close', (e) => {
    // Don't quit — hide to tray
    e.preventDefault();
    mainWindow.hide();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function buildTrayMenu() {
  const state = getServerState();
  const connectedUsers = state.connectedClients || [];
  const dliveStatus = dlive?.isConnected() ? 'Connected' : 'Not connected';

  const userItems = connectedUsers.length > 0
    ? connectedUsers.map(u => ({
        label: `  ● ${u.name} — Aux ${u.aux}`,
        enabled: false,
      }))
    : [{ label: '  No vocalists connected', enabled: false }];

  return Menu.buildFromTemplate([
    {
      label: `VocalMix Server`,
      enabled: false,
    },
    { type: 'separator' },
    {
      label: `dLive: ${dliveStatus}`,
      enabled: false,
    },
    {
      label: `Server: http://vocalmix.local:${state.port || 3000}`,
      enabled: false,
    },
    { type: 'separator' },
    {
      label: 'Connected Vocalists',
      enabled: false,
    },
    ...userItems,
    { type: 'separator' },
    {
      label: 'Open Dashboard',
      click: () => createWindow(),
    },
    {
      label: 'Open in Browser',
      click: () => shell.openExternal(`http://localhost:${state.port || 3000}/admin`),
    },
    { type: 'separator' },
    {
      label: 'Quit VocalMix',
      click: () => {
        stopServer();
        app.exit(0);
      },
    },
  ]);
}

function updateTray() {
  if (!tray) return;
  const connected = dlive?.isConnected() || false;
  tray.setImage(createTrayIcon(connected ? 'connected' : 'disconnected'));
  tray.setContextMenu(buildTrayMenu());
  tray.setToolTip(connected ? 'VocalMix — dLive Connected' : 'VocalMix — No dLive');
}

app.whenReady().then(async () => {
  // Create tray
  tray = new Tray(createTrayIcon('disconnected'));
  tray.setContextMenu(buildTrayMenu());
  tray.setToolTip('VocalMix Server');

  tray.on('click', () => {
    tray.setContextMenu(buildTrayMenu());
    tray.popUpContextMenu();
  });

  tray.on('right-click', () => {
    tray.setContextMenu(buildTrayMenu());
    tray.popUpContextMenu();
  });

  // Start HTTP server
  const port = 3000;
  startServer(port);
  console.log(`VocalMix server running on http://localhost:${port}`);

  // Initialize dLive connection
  dlive = new DLiveConnection();
  setDLiveProvider({
    getStatus: () => ({
      connected: dlive?.isConnected() || false,
      ip: dlive?.getIP() || null,
      channels: dlive?.getChannels() || [],
      auxBuses: dlive?.getAuxBuses() || [],
    }),
    resync: () => dlive.refreshChannelNames(),
    getAuxSendLevels: (inputChannels, auxBus) => dlive.getAuxSendLevels(inputChannels, auxBus),
    connect: (ip) => dlive.connect(ip),
    disconnect: () => {
      dlive.disconnect();
      return { success: true };
    },
  });

  const settings = loadSettings();
  if (settings.autoConnect && settings.dliveIP) {
    dlive.connect(settings.dliveIP).catch((error) => {
      console.error('[dLive] Auto-connect failed:', error?.error || error?.message || error);
    });
  }

  // Update tray periodically
  setInterval(updateTray, 5000);

  // IPC handlers for renderer
  ipcMain.handle('get-server-state', () => getServerState());
  ipcMain.handle('get-dlive-status', () => ({
    connected: dlive?.isConnected() || false,
    ip: dlive?.getIP() || null,
    channels: dlive?.getChannels() || [],
    auxBuses: dlive?.getAuxBuses() || [],
  }));
  ipcMain.handle('connect-dlive', (_, ip) => dlive.connect(ip));
  ipcMain.handle('disconnect-dlive', () => dlive.disconnect());

  // Open dashboard window
  createWindow();
});

app.on('window-all-closed', (e) => {
  // Don't quit when window closes — keep running in tray
  e.preventDefault();
});
