# VocalMix Server

Personal monitor mix server for Allen & Heath dLive. Lets vocalists log into any iPad and control their own monitor mix — identity follows the person, not the device.

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
├── main.js            # Electron main process (tray icon, window)
├── preload.js         # Secure IPC bridge
├── server.js          # Express HTTP server + Bonjour
├── dlive.js           # dLive MixRack TCP/MIDI connection
├── package.json
├── ui/
│   └── index.html     # Admin dashboard (runs in Electron window)
└── client/
    └── index.html     # iPad vocalist interface (served via HTTP)
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

### iPad access

On any iPad connected to the same network:
1. Open Safari
2. Go to `http://vocalmix.local:3000`
3. Tap a vocalist name
4. Mix!

Or use the Mac's IP directly: `http://192.168.x.x:3000`

## How it works

### For the sound engineer (Mac dashboard)

1. **Profiles tab** — Assign names to Vox 1–8 slots and pick which aux bus each vocalist controls
2. **Channel Matrix tab** — Click/drag to choose which input channels each vocalist can see. Channel names are pulled from the dLive automatically.
3. **Settings tab** — Configure dLive IP, server name, fader limits

### For vocalists (iPad)

1. Open the web app on any iPad
2. Tap their name
3. See only the faders they're allowed to control
4. Fader positions auto-save — next week they pick up right where they left off

### dLive connection

The server connects to the dLive MixRack via TCP on port 51325. It:
- Pulls channel names, colors, and aux bus labels from the show file
- Sends MIDI NRPN messages for fader changes
- Listens for changes made at the surface and updates iPads in real-time

**Note:** The current release includes simulated dLive data for development. The `dlive.js` module has the connection framework — the specific protocol bytes need to be implemented based on the A&H MIDI specification or protocol analysis. The simulated data lets you test the full UI flow without a real console.

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
- `profiles.json` — Vocalist profiles
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
