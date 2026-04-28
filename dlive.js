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
const SYSEX_HEADER = [0xF0, 0x00, 0x00, 0x1A, 0x50, 0x10, 0x01, 0x00];
const DEFAULT_CHANNEL_COLOR = '#5F6B7A';

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
    this._auxBuses = [
      { id: 1, name: 'Vox 1', color: '#E85D4A' },
      { id: 2, name: 'Vox 2', color: '#E8A44A' },
      { id: 3, name: 'Vox 3', color: '#4AE88D' },
      { id: 4, name: 'Vox 4', color: '#4A9EE8' },
      { id: 5, name: 'Vox 5', color: '#C77DFF' },
      { id: 6, name: 'Vox 6', color: '#FF6B9D' },
      { id: 7, name: 'Vox 7', color: '#00D4AA' },
      { id: 8, name: 'Vox 8', color: '#E8A44A' },
      { id: 9, name: 'IEM MD', color: '#8B8B8B' },
      { id: 10, name: 'IEM Keys', color: '#C77DFF' },
      { id: 11, name: 'Wedge DS', color: '#4A9EE8' },
      { id: 12, name: 'Wedge DR', color: '#4A9EE8' },
    ];

    this.emit('show-data', {
      channels: this._channels,
      auxBuses: this._auxBuses,
    });

    const messages = [];
    for (let channelIndex = 0; channelIndex < INPUT_CHANNEL_COUNT; channelIndex += 1) {
      messages.push(this._buildGetChannelNameMessage(INPUT_MIDI_BASE_CHANNEL, channelIndex));
    }

    this._socket.write(Buffer.concat(messages));
  }

  _buildGetChannelNameMessage(baseChannel, channelIndex) {
    return Buffer.from([
      ...SYSEX_HEADER,
      baseChannel & 0x0F,
      0x01,
      channelIndex & 0x7F,
      0xF7,
    ]);
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

    const command = message[9];
    if (command !== 0x02) return;

    const channelIndex = message[10];
    const channelNumber = channelIndex + 1;
    const name = message
      .subarray(11, message.length - 1)
      .toString('ascii')
      .replace(/[^\x20-\x7E]/g, '')
      .trimEnd();

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

    this._emitShowData();
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
    if (!this._connected || !this._socket) return;

    // Convert to MIDI NRPN message
    // dLive uses NRPN for fader control:
    //   - NRPN MSB (CC 99): Parameter group
    //   - NRPN LSB (CC 98): Parameter index
    //   - Data Entry MSB (CC 6): Value high byte
    //   - Data Entry LSB (CC 38): Value low byte
    //
    // For aux sends:
    //   Bank = floor((inputCh - 1) / 12)
    //   MIDI Channel = function of aux bus
    //   CC for fader = function of (inputCh - 1) % 12

    const bank = Math.floor((inputCh - 1) / MIDI_BANK_SIZE);
    const channelInBank = (inputCh - 1) % MIDI_BANK_SIZE;

    // Convert 0.0-1.0 to 14-bit MIDI value (0-16383)
    const midiValue = Math.round(level * 16383);
    const msb = (midiValue >> 7) & 0x7F;
    const lsb = midiValue & 0x7F;

    // Build the MIDI TCP message
    // NOTE: Actual byte format depends on dLive's TCP MIDI wrapper
    const msg = Buffer.from([
      0xB0 | (auxBus - 1) & 0x0F, // CC on aux channel
      0x63, bank,                   // NRPN MSB
      0xB0 | (auxBus - 1) & 0x0F,
      0x62, channelInBank,          // NRPN LSB
      0xB0 | (auxBus - 1) & 0x0F,
      0x06, msb,                    // Data Entry MSB
      0xB0 | (auxBus - 1) & 0x0F,
      0x26, lsb,                    // Data Entry LSB
    ]);

    try {
      this._socket.write(msg);
    } catch (err) {
      console.error('[dLive] Failed to send:', err.message);
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
