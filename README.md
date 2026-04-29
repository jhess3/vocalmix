# VocalMix Server

Personal monitor mix server for Allen & Heath dLive. Lets singers open any iPad, choose a live `Mic 1-8` slot, adjust that aux mix in real time, and recall saved mixes from the server.

## Architecture

```
┌─────────────┐       ┌──────────────────┐       ┌─────────────┐
│  iPad        │◄────►│  Mac (this app)   │◄────►│  dLive       │
│  Safari      │ HTTP │  Electron + Node  │ TCP  │  MixRack     │
│  any device  │      │  Tray icon app    │      │  port 51325  │
└─────────────┘       └──────────────────┘       └─────────────┘
```

## What's in the box

```
vocalmix-server/
├── main.ts            # Electron main process (tray icon, window)
├── preload.ts         # Secure IPC bridge
├── server.ts          # Express HTTP server + Bonjour
├── dlive.ts           # dLive MixRack TCP/MIDI connection
├── shared/
│   └── level-scale.ts # Shared dLive level conversion utilities
├── package.json
├── tsconfig.node.json
├── tsconfig.web.json
├── ui/
│   ├── index.html     # Admin dashboard shell
│   └── dashboard.ts   # Admin dashboard logic
└── client/
    ├── index.html     # iPad mic-slot interface shell
    └── *.ts           # Browser client modules
```

## Setup

### Prerequisites
- macOS 12 or later
- Node.js 18+ (https://nodejs.org)
- Mac on the same network as your dLive MixRack and WiFi for iPads

### Install

```bash
cd vocalmix-server
npm install
```

### Run in development

```bash
npm start
```

This will:
1. Open the admin dashboard window
2. Show the tray icon in your menu bar
3. Start the HTTP server on port 3000
4. Advertise via Bonjour as "VocalMix Server"

To run the test suite:

```bash
npm test
```

### iPad access

On any iPad connected to the same network:
1. Open Safari
2. Go to `http://vocalmix.local:3000`
3. Tap a mic slot
4. Mix!

Or use the Mac's IP directly: `http://192.168.x.x:3000`

## How it works

### For the sound engineer (Mac dashboard)

1. **Mic Slots tab** — Configure `Mic 1-8` labels and pick which aux bus each slot controls
2. **Channel Matrix tab** — Click/drag to choose which input channels each mic slot can see. Channel names are pulled from the dLive automatically.
3. **Settings tab** — Configure dLive IP, server name, fader limits

### For singers (iPad)

1. Open the web app on any iPad
2. Tap `Mic 1-8`
3. Start from the current live aux levels for that slot
4. Recall a previously saved mix if desired
5. Adjust faders live on the selected aux
6. Save to overwrite the currently loaded mix, or create a new saved mix first

### dLive connection

The server connects to the dLive MixRack via TCP on port 51325. It:
- Pulls channel names, colors, and aux bus labels from the show file
- Sends MIDI NRPN messages for fader changes
- Listens for changes made at the surface and updates iPads in real-time

**Note:** The current release includes simulated dLive data for development. The `dlive.ts` module has the connection framework — the specific protocol bytes need to be implemented based on the A&H MIDI specification or protocol analysis. The simulated data lets you test the full UI flow without a real console.

## Building for production

To package as a standalone macOS app:

```bash
npm install --save-dev @electron/packager
npx @electron/packager . VocalMix --platform=darwin --arch=arm64 --icon=icon.icns
```

This creates a `VocalMix.app` you can drag to Applications.

### Launch at login

To start VocalMix automatically when you log in:
1. Open System Settings > General > Login Items
2. Add VocalMix.app

## Configuration

Settings are stored in `~/.vocalmix/`:
- `profiles.json` — Mic slot definitions
- `saved-mixes.json` — Recallable saved mixes
- `matrix.json` — Channel access matrix  
- `settings.json` — Server and dLive settings

## Network requirements

- Mac, dLive MixRack, and iPad WiFi must be on the same subnet (or have routing between them)
- Port 3000 (HTTP) must be accessible from iPads to the Mac
- Port 51325 (TCP) must be accessible from the Mac to the dLive MixRack
- Bonjour/mDNS (UDP 5353) for `.local` hostname resolution

## Roadmap

- [ ] Full dLive protocol implementation (beyond MIDI)
- [ ] WebSocket for real-time fader sync between iPads and surface
- [ ] EQ access per channel (with engineer approval)
- [ ] "More Me" one-knob control
- [ ] Scene/snapshot integration
- [ ] Multiple show file support
- [ ] Android support (already works in Chrome)
