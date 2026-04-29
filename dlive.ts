/**
 * Allen & Heath dLive MixRack Connection
 * 
 * The dLive uses a proprietary TCP protocol on port 51325.
 * This module handles:
 *   - Connecting to the MixRack
 *   - Pulling channel names, colors, and aux bus configuration
 *   - Sending MIDI-style fader commands for aux sends
 *   - Listening for changes made at the surface
 * 
 * IMPORTANT: The actual dLive protocol is proprietary. This module
 * provides the connection framework. The specific message bytes
 * will need to be filled in based on protocol analysis or the 
 * A&H MIDI specification document.
 */

const net = require('net');
const EventEmitter = require('events');

// dLive TCP port
const DLIVE_PORT = 51325;

// MIDI Channel mapping for dLive
// Input channels: MIDI ch 0-11 (banks of 12)
// Mix/Aux outputs: MIDI ch 12-15 (banks)
const MIDI_BANK_SIZE = 12;
const INPUT_CHANNEL_COUNT = 128;
const INPUT_MIDI_BASE_CHANNEL = 0;
const MONO_AUX_MIDI_CHANNEL = INPUT_MIDI_BASE_CHANNEL + 2;
const MONO_AUX_START_NOTE = 0x00;
const MAX_MONO_AUX_COUNT = 62;
const STEREO_AUX_START_NOTE = 0x40;
const MAX_STEREO_AUX_COUNT = 31;
const SYSEX_HEADER = [0xF0, 0x00, 0x00, 0x1A, 0x50, 0x10, 0x01, 0x00];
const DEFAULT_CHANNEL_COLOR = '#5F6B7A';
const DEFAULT_AUX_COLOR = '#8B8B8B';

class DLiveConnection extends EventEmitter {
  constructor() {
    super();
    this._socket = null;
    this._connected = false;
    this._ip = null;
    this._channels = [];
    this._auxBuses = [];
    this._reconnectTimer = null;
    this._buffer = Buffer.alloc(0);
    this._receivedChannelNames = new Map();
    this._receivedAuxNames = new Map();
    this._pendingSendLevelRequests = new Map();
  }

  isConnected() {
    return this._connected;
  }

  getIP() {
    return this._ip;
  }

  getChannels() {
    return this._channels;
  }

  getAuxBuses() {
    return this._auxBuses;
  }

  async refreshChannelNames() {
    if (!this._connected || !this._socket) {
      return { success: false, error: 'Not connected' };
    }

    this._requestShowData();
    return { success: true };
  }

  async getAuxSendLevels(inputChannels, auxBus) {
    if (!this._connected || !this._socket) {
      return { success: false, error: 'Not connected' };
    }

    const target = this._getAuxTarget(auxBus);
    if (!target) {
      return { success: false, error: `Unsupported aux bus: ${auxBus}` };
    }

    const requestedChannels = [...new Set(inputChannels)]
      .map((channel) => Number(channel))
      .filter((channel) => Number.isInteger(channel) && channel >= 1 && channel <= INPUT_CHANNEL_COUNT);

    const requests = requestedChannels.map((inputCh) => {
      const promise = this._createPendingSendLevelRequest(inputCh, auxBus);
      return {
        inputCh,
        promise,
        message: this._buildGetAuxSendLevelMessage(inputCh, target),
      };
    });

    if (!requests.length) {
      return { success: true, levels: {} };
    }

    this._socket.write(Buffer.concat(requests.map((request) => request.message)));

    const results = await Promise.allSettled(requests.map((request) => request.promise));
    const levels = {};

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        levels[requests[index].inputCh] = result.value;
      }
    });

    return { success: true, levels };
  }

  async applyAuxSendLevels(auxBus, levels) {
    if (!this._connected || !this._socket) {
      return { success: false, error: 'Not connected' };
    }

    const normalizedAuxBus = Number(auxBus);
    if (!this._getAuxTarget(normalizedAuxBus)) {
      return { success: false, error: `Unsupported aux bus: ${auxBus}` };
    }

    const normalizedLevels = {};
    Object.entries(levels || {}).forEach(([inputCh, level]) => {
      const normalizedInputCh = Number(inputCh);
      const normalizedLevel = Number(level);
      if (
        Number.isInteger(normalizedInputCh) &&
        normalizedInputCh >= 1 &&
        normalizedInputCh <= INPUT_CHANNEL_COUNT &&
        Number.isFinite(normalizedLevel) &&
        normalizedLevel >= 0 &&
        normalizedLevel <= 1
      ) {
        normalizedLevels[String(normalizedInputCh)] = normalizedLevel;
      }
    });

    Object.entries(normalizedLevels).forEach(([inputCh, level]) => {
      this.setAuxSendLevel(Number(inputCh), normalizedAuxBus, level);
    });

    return { success: true, auxBus: normalizedAuxBus, levels: normalizedLevels };
  }

  /**
   * Connect to a dLive MixRack at the given IP
   */
  async connect(ip) {
    if (this._socket) {
      this.disconnect();
    }

    this._ip = ip;

    return new Promise((resolve, reject) => {
      this._socket = new net.Socket();
      this._socket.setTimeout(5000);

      this._socket.connect(DLIVE_PORT, ip, () => {
        console.log(`[dLive] Connected to MixRack at ${ip}:${DLIVE_PORT}`);
        this._connected = true;
        this._socket.setTimeout(0);
        this.emit('connected', ip);

        // Request channel data from the MixRack
        this._requestShowData();
        resolve({ success: true, ip });
      });

      this._socket.on('data', (data) => {
        this._buffer = Buffer.concat([this._buffer, data]);
        this._parseMessages();
      });

      this._socket.on('error', (err) => {
        console.error(`[dLive] Connection error:`, err.message);
        this._connected = false;
        if (this.listenerCount('error') > 0) {
          this.emit('error', err);
        }
        reject({ success: false, error: err.message });
      });

      this._socket.on('close', () => {
        console.log('[dLive] Connection closed');
        this._connected = false;
        this.emit('disconnected');
        this._scheduleReconnect();
      });

      this._socket.on('timeout', () => {
        console.log('[dLive] Connection timeout');
        this._socket.destroy();
        reject({ success: false, error: 'Connection timeout' });
      });
    });
  }

  disconnect() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this._socket) {
      this._socket.destroy();
      this._socket = null;
    }
    this._connected = false;
    this._ip = null;
    this.emit('disconnected');
  }

  /**
   * Request the full show data from the MixRack.
   * This pulls channel names, colors, aux bus config, routing, etc.
   * 
   * NOTE: The actual protocol bytes are proprietary to A&H.
   * This is the framework — you'll need to fill in the specific
   * SysEx/NRPN messages based on protocol documentation or analysis.
   */
  _requestShowData() {
    this._channels = [];
    this._receivedChannelNames.clear();
    this._receivedAuxNames.clear();
    this._auxBuses = [];

    this.emit('show-data', {
      channels: this._channels,
      auxBuses: this._auxBuses,
    });

    const messages = [];
    for (let channelIndex = 0; channelIndex < INPUT_CHANNEL_COUNT; channelIndex += 1) {
      messages.push(this._buildGetChannelNameMessage(INPUT_MIDI_BASE_CHANNEL, channelIndex));
    }
    for (let auxIndex = 0; auxIndex < MAX_MONO_AUX_COUNT; auxIndex += 1) {
      messages.push(this._buildGetChannelNameMessage(MONO_AUX_MIDI_CHANNEL, MONO_AUX_START_NOTE + auxIndex));
    }
    for (let auxIndex = 0; auxIndex < MAX_STEREO_AUX_COUNT; auxIndex += 1) {
      messages.push(this._buildGetChannelNameMessage(MONO_AUX_MIDI_CHANNEL, STEREO_AUX_START_NOTE + auxIndex));
    }

    this._socket.write(Buffer.concat(messages));
  }

  _buildGetChannelNameMessage(baseChannel, channelNote) {
    return Buffer.from([
      ...SYSEX_HEADER,
      baseChannel & 0x0F,
      0x01,
      channelNote & 0x7F,
      0xF7,
    ]);
  }

  _buildGetAuxSendLevelMessage(inputCh, target) {
    return Buffer.from([
      ...SYSEX_HEADER,
      INPUT_MIDI_BASE_CHANNEL & 0x0F,
      0x05,
      0x0F,
      0x0D,
      (inputCh - 1) & 0x7F,
      target.sndN & 0x0F,
      target.sndCH & 0x7F,
      0xF7,
    ]);
  }

  _createPendingSendLevelRequest(inputCh, auxBus) {
    const key = `${auxBus}:${inputCh}`;
    const existing = this._pendingSendLevelRequests.get(key);
    if (existing) {
      clearTimeout(existing.timeoutId);
      existing.reject(new Error('Superseded by newer send level request'));
      this._pendingSendLevelRequests.delete(key);
    }

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this._pendingSendLevelRequests.delete(key);
        reject(new Error(`Timed out waiting for send level ${key}`));
      }, 1500);

      this._pendingSendLevelRequests.set(key, {
        resolve,
        reject,
        timeoutId,
      });
    });
  }

  _getAuxTarget(auxBus) {
    const normalizedId = Number(auxBus);
    const discoveredAux = this._auxBuses.find((bus) => bus.id === normalizedId);
    if (discoveredAux) {
      return {
        sndN: MONO_AUX_MIDI_CHANNEL,
        sndCH: discoveredAux.targetNote,
      };
    }

    if (!Number.isInteger(normalizedId)) {
      return null;
    }

    if (normalizedId >= 1 && normalizedId <= MAX_MONO_AUX_COUNT) {
      return {
        sndN: MONO_AUX_MIDI_CHANNEL,
        sndCH: normalizedId - 1,
      };
    }

    if (
      normalizedId >= STEREO_AUX_START_NOTE + 1 &&
      normalizedId < STEREO_AUX_START_NOTE + 1 + MAX_STEREO_AUX_COUNT
    ) {
      return {
        sndN: MONO_AUX_MIDI_CHANNEL,
        sndCH: normalizedId - 1,
      };
    }

    return null;
  }

  _getAuxBusFromTarget(sndN, sndCH) {
    if (sndN !== MONO_AUX_MIDI_CHANNEL) return null;
    if (sndCH >= MONO_AUX_START_NOTE && sndCH < MONO_AUX_START_NOTE + MAX_MONO_AUX_COUNT) {
      return sndCH + 1;
    }
    if (sndCH >= STEREO_AUX_START_NOTE && sndCH < STEREO_AUX_START_NOTE + MAX_STEREO_AUX_COUNT) {
      return sndCH + 1;
    }
    return null;
  }

  _emitShowData() {
    this.emit('show-data', {
      channels: this._channels,
      auxBuses: this._auxBuses,
    });

    console.log(`[dLive] Loaded ${this._channels.length} live channel names, ${this._auxBuses.length} aux buses`);
  }

  /**
   * Parse incoming TCP messages from the MixRack.
   * The dLive protocol uses variable-length messages.
   */
  _parseMessages() {
    while (this._buffer.length > 0) {
      const start = this._buffer.indexOf(0xF0);
      if (start === -1) {
        this._buffer = Buffer.alloc(0);
        return;
      }

      if (start > 0) {
        this._buffer = this._buffer.slice(start);
      }

      const end = this._buffer.indexOf(0xF7, 1);
      if (end === -1) {
        return;
      }

      const message = this._buffer.slice(0, end + 1);
      this._buffer = this._buffer.slice(end + 1);
      this._parseSysExMessage(message);
    }
  }

  _parseSysExMessage(message) {
    if (message.length < 12) return;

    const header = message.subarray(0, SYSEX_HEADER.length);
    if (!header.equals(Buffer.from(SYSEX_HEADER))) return;

    const midiChannel = message[8] & 0x0F;
    const command = message[9];
    if (command === 0x02) {
      const name = message
        .subarray(11, message.length - 1)
        .toString('ascii')
        .replace(/[^\x20-\x7E]/g, '')
        .trimEnd();

      if (midiChannel === INPUT_MIDI_BASE_CHANNEL) {
        const channelIndex = message[10];
        const channelNumber = channelIndex + 1;
        this._receivedChannelNames.set(channelNumber, name);
        this._channels = Array.from(this._receivedChannelNames.entries())
          .sort((a, b) => a[0] - b[0])
          .map(([ch, channelName]) => ({
            ch,
            name: channelName,
            color: DEFAULT_CHANNEL_COLOR,
            group: 'inputs',
            stereoLinked: false,
          }));
      } else if (midiChannel === MONO_AUX_MIDI_CHANNEL) {
        const auxNote = message[10] & 0x7F;
        const auxBus = this._parseAuxBusFromNote(auxNote, name);
        if (!auxBus) return;
        this._receivedAuxNames.set(auxBus.id, auxBus);
        this._auxBuses = Array.from(this._receivedAuxNames.entries())
          .sort((a, b) => a[1].targetNote - b[1].targetNote)
          .map(([, bus]) => bus);
      }

      this._emitShowData();
      return;
    }

    if (command === 0x0D && message.length >= 15) {
      const inputCh = (message[10] & 0x7F) + 1;
      const auxBus = this._getAuxBusFromTarget(message[11] & 0x0F, message[12] & 0x7F);
      if (!auxBus) return;
      const level = (message[13] & 0x7F) / 127;

      const key = `${auxBus}:${inputCh}`;
      const pending = this._pendingSendLevelRequests.get(key);
      if (pending) {
        clearTimeout(pending.timeoutId);
        this._pendingSendLevelRequests.delete(key);
        pending.resolve(level);
      }

      this.emit('aux-send-level', {
        auxBus,
        inputChannel: inputCh,
        level,
      });
    }
  }

  _parseAuxBusFromNote(auxNote, name) {
    if (auxNote >= MONO_AUX_START_NOTE && auxNote < MONO_AUX_START_NOTE + MAX_MONO_AUX_COUNT) {
      const number = auxNote - MONO_AUX_START_NOTE + 1;
      return {
        id: number,
        name: name || `Aux ${number}`,
        color: DEFAULT_AUX_COLOR,
        type: 'mono',
        number,
        targetNote: auxNote,
      };
    }

    if (auxNote >= STEREO_AUX_START_NOTE && auxNote < STEREO_AUX_START_NOTE + MAX_STEREO_AUX_COUNT) {
      const number = auxNote - STEREO_AUX_START_NOTE + 1;
      return {
        id: auxNote + 1,
        name: name || `Stereo Aux ${number}`,
        color: DEFAULT_AUX_COLOR,
        type: 'stereo',
        number,
        targetNote: auxNote,
      };
    }

    return null;
  }

  /**
   * Set an aux send level for a given input channel.
   * This is the core command that the iPad client triggers.
   * 
   * @param {number} inputCh - Input channel number (1-based)
   * @param {number} auxBus - Aux bus number (1-based)
   * @param {number} level - Fader level 0.0 to 1.0
   */
  setAuxSendLevel(inputCh, auxBus, level) {
    if (!this._connected || !this._socket) return false;
    const normalizedInputCh = Number(inputCh);
    const normalizedLevel = Number(level);
    const target = this._getAuxTarget(auxBus);
    if (
      !Number.isInteger(normalizedInputCh) ||
      normalizedInputCh < 1 ||
      normalizedInputCh > INPUT_CHANNEL_COUNT ||
      !target ||
      !Number.isFinite(normalizedLevel)
    ) {
      return false;
    }

    const sendLevel = Math.max(0, Math.min(127, Math.round(normalizedLevel * 127)));
    const msg = Buffer.from([
      ...SYSEX_HEADER,
      INPUT_MIDI_BASE_CHANNEL & 0x0F,
      0x0D,
      (normalizedInputCh - 1) & 0x7F,
      target.sndN & 0x0F,
      target.sndCH & 0x7F,
      sendLevel & 0x7F,
      0xF7,
    ]);

    try {
      this._socket.write(msg);
      return true;
    } catch (err) {
      console.error('[dLive] Failed to send:', err.message);
      return false;
    }
  }

  /**
   * Set mute state for a channel's aux send
   */
  setAuxSendMute(inputCh, auxBus, muted) {
    if (!this._connected || !this._socket) return;

    // MIDI Note On/Off for mutes
    const note = (inputCh - 1) % MIDI_BANK_SIZE;
    const velocity = muted ? 0x7F : 0x00;
    const bank = Math.floor((inputCh - 1) / MIDI_BANK_SIZE);

    const msg = Buffer.from([
      0x90 | (auxBus - 1) & 0x0F, // Note On
      note,
      velocity,
    ]);

    try {
      this._socket.write(msg);
    } catch (err) {
      console.error('[dLive] Failed to send mute:', err.message);
    }
  }

  /**
   * Auto-reconnect after disconnection
   */
  _scheduleReconnect() {
    if (this._reconnectTimer) return;
    if (!this._ip) return;

    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      console.log('[dLive] Attempting reconnect...');
      this.connect(this._ip).catch(() => {
        this._scheduleReconnect();
      });
    }, 5000);
  }
}

module.exports = { DLiveConnection };
export {};
