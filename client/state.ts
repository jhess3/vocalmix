export function createInitialState() {
  return {
    currentProfile: null,
    allowedChannels: [],
    faderLevels: {},
    mutedChannels: new Set(),
    activeTouches: {},
    savedMixes: [],
    currentLoadedMixId: null,
    currentLoadedMixName: '',
    faderSendTimers: {},
    liveEventSource: null,
    channels: [],
    profiles: [],
    auxBuses: [],
  };
}

export function resetSessionState(state) {
  state.currentProfile = null;
  state.allowedChannels = [];
  state.faderLevels = {};
  state.mutedChannels = new Set();
  state.activeTouches = {};
  state.savedMixes = [];
  state.currentLoadedMixId = null;
  state.currentLoadedMixName = '';
}

export function applyBootstrapData(state, { profiles, channels, auxBuses }) {
  state.profiles = Array.isArray(profiles) ? profiles : [];
  state.channels = Array.isArray(channels) ? channels : [];
  state.auxBuses = Array.isArray(auxBuses) ? auxBuses : [];
}

export function applyLoginState(state, { profile, allowedChannels, savedMixes, liveLevels }) {
  state.currentProfile = profile || null;
  state.allowedChannels = Array.isArray(allowedChannels) ? [...allowedChannels] : [];
  state.faderLevels = {};
  state.mutedChannels = new Set();
  state.savedMixes = Array.isArray(savedMixes) ? [...savedMixes] : [];
  state.currentLoadedMixId = null;
  state.currentLoadedMixName = '';

  state.allowedChannels.forEach((channel) => {
    if (Object.prototype.hasOwnProperty.call(liveLevels || {}, channel)) {
      state.faderLevels[channel] = liveLevels[channel];
      return;
    }

    state.faderLevels[channel] = 0.7;
  });
}

export function applyRecalledMixLevels(state, levels) {
  state.allowedChannels.forEach((channel) => {
    if (Object.prototype.hasOwnProperty.call(levels || {}, channel)) {
      state.faderLevels[channel] = levels[channel];
      return;
    }

    state.faderLevels[channel] = 0;
  });
}

export function syncLocalMixCache(state, updatedMix) {
  const index = state.savedMixes.findIndex((mix) => mix.id === updatedMix.id);
  if (index === -1) {
    state.savedMixes.unshift(updatedMix);
    return;
  }

  state.savedMixes[index] = updatedMix;
}

export function setLoadedMix(state, mix) {
  state.currentLoadedMixId = mix?.id || null;
  state.currentLoadedMixName = mix?.name || '';
}
