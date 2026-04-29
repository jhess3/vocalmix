import * as api from './api.js';
import * as dom from './dom.js';
import { dbToLevel, levelToMidiValue, midiValueToDb } from './level-scale.js';
import {
  applyBootstrapData,
  applyLoginState,
  applyRecalledMixLevels,
  createInitialState,
  resetSessionState,
  setLoadedMix,
  syncLocalMixCache,
} from './state.js';

function levelToDb(level: number) {
  const db = midiValueToDb(levelToMidiValue(level));
  if (!Number.isFinite(db)) return '-∞';
  if (db > 0) return `+${db.toFixed(1)}`;
  return db.toFixed(1);
}

function clampLevel(level: number) {
  return Math.max(0, Math.min(1, Number(level) || 0));
}

function getAuxLabel(state: any, auxId: number) {
  const aux = state.auxBuses.find((item) => item.id === auxId);
  if (!aux) return `Aux ${auxId}`;
  return aux.name;
}

export function createApp(doc = document) {
  const state = createInitialState();
  const refs = dom.createDomRefs(doc);

  function bindFaderTrackEvents() {
    refs.faderArea.querySelectorAll('.fader-track').forEach((track) => {
      track.addEventListener('touchstart', onFaderTouchStart, { passive: false });
      track.addEventListener('touchmove', onFaderTouchMove, { passive: false });
      track.addEventListener('touchend', onFaderTouchEnd, { passive: false });
      track.addEventListener('mousedown', onFaderMouseDown);
    });
  }

  function renderLogin() {
    dom.renderLogin(refs, state.profiles);
  }

  function renderFaders() {
    dom.renderFaders(refs, state, { levelToDb });
    bindFaderTrackEvents();
  }

  function updateLoadedMixUI() {
    dom.updateLoadedMixUI(refs, state);
  }

  function ensureLiveEventStream() {
    if (state.liveEventSource) return;

    state.liveEventSource = new EventSource('/api/events');
    state.liveEventSource.addEventListener('aux-send-level', (event) => {
      if (!state.currentProfile) return;

      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }

      const auxBus = Number(payload?.auxBus);
      const inputChannel = Number(payload?.inputChannel);
      const level = Number(payload?.level);
      if (
        auxBus !== Number(state.currentProfile.auxBus) ||
        !state.allowedChannels.includes(inputChannel) ||
        !Number.isFinite(level)
      ) {
        return;
      }

      setFaderLevel(inputChannel, level, { skipLiveSend: true });
    });

    state.liveEventSource.addEventListener('aux-master-level', (event) => {
      if (!state.currentProfile) return;

      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }

      const auxBus = Number(payload?.auxBus);
      const level = Number(payload?.level);
      if (auxBus !== Number(state.currentProfile.auxBus) || !Number.isFinite(level)) {
        return;
      }

      setAuxMasterLevel(level, { skipLiveSend: true });
    });

    state.liveEventSource.onerror = () => {
      if (state.liveEventSource?.readyState === EventSource.CLOSED) {
        state.liveEventSource.close();
        state.liveEventSource = null;
        setTimeout(() => ensureLiveEventStream(), 2000);
      }
    };
  }

  function closeLiveEventStream() {
    if (!state.liveEventSource) return;
    state.liveEventSource.close();
    state.liveEventSource = null;
  }

  function setFaderLevel(channel: number, level: number, options: { skipLiveSend?: boolean } = {}) {
    const nextLevel = clampLevel(level);
    state.faderLevels[channel] = nextLevel;

    const strip = refs.faderArea.querySelector(`.fader-strip[data-ch="${channel}"]`);
    if (!strip) return;

    const pct = nextLevel * 100;
    const fill = strip.querySelector('.fader-fill') as HTMLElement;
    const thumb = strip.querySelector('.fader-thumb') as HTMLElement;
    const db = strip.querySelector('.fader-db') as HTMLElement;

    fill.style.height = `${pct}%`;
    thumb.style.bottom = `${pct}%`;
    db.textContent = levelToDb(nextLevel);

    if (!options.skipLiveSend) {
      sendLiveFaderLevel(channel, nextLevel);
    }
  }

  function setAuxMasterLevel(level: number, options: { skipLiveSend?: boolean } = {}) {
    const nextLevel = clampLevel(level);
    state.auxMasterLevel = nextLevel;

    const strip = refs.faderArea.querySelector('.fader-strip[data-kind="master"]');
    if (!strip) return;

    const pct = nextLevel * 100;
    const fill = strip.querySelector('.fader-fill') as HTMLElement;
    const thumb = strip.querySelector('.fader-thumb') as HTMLElement;
    const db = strip.querySelector('.fader-db') as HTMLElement;

    fill.style.height = `${pct}%`;
    thumb.style.bottom = `${pct}%`;
    db.textContent = levelToDb(nextLevel);

    if (!options.skipLiveSend) {
      sendLiveAuxMasterLevel(nextLevel);
    }
  }

  function toggleMute(channel: number) {
    if (state.mutedChannels.has(channel)) state.mutedChannels.delete(channel);
    else state.mutedChannels.add(channel);
    renderFaders();
  }

  function onFaderTouchStart(event: TouchEvent) {
    event.preventDefault();
    const track = event.currentTarget as HTMLElement;
    const channel = Number.parseInt(track.dataset.ch || '', 10);
    const kind = track.dataset.kind;
    const rect = track.getBoundingClientRect();

    for (const touch of Array.from(event.changedTouches)) {
      const y = touch.clientY - rect.top;
      const level = 1 - (y / rect.height);
      state.activeTouches[touch.identifier] = { channel, kind, trackRect: rect };
      if (kind === 'master') setAuxMasterLevel(level);
      else setFaderLevel(channel, level);
    }
  }

  function onFaderTouchMove(event: TouchEvent) {
    event.preventDefault();
    for (const touch of Array.from(event.changedTouches)) {
      const info = state.activeTouches[touch.identifier];
      if (!info) continue;
      const y = touch.clientY - info.trackRect.top;
      const level = 1 - (y / info.trackRect.height);
      if (info.kind === 'master') setAuxMasterLevel(level);
      else setFaderLevel(info.channel, level);
    }
  }

  function onFaderTouchEnd(event: TouchEvent) {
    for (const touch of Array.from(event.changedTouches)) {
      delete state.activeTouches[touch.identifier];
    }
  }

  function onFaderMouseDown(event: MouseEvent) {
    const track = event.currentTarget as HTMLElement;
    const channel = Number.parseInt(track.dataset.ch || '', 10);
    const kind = track.dataset.kind;
    const rect = track.getBoundingClientRect();

    const onMove = (moveEvent: MouseEvent) => {
      const y = moveEvent.clientY - rect.top;
      const level = 1 - (y / rect.height);
      if (kind === 'master') setAuxMasterLevel(level);
      else setFaderLevel(channel, level);
    };

    const onUp = () => {
      doc.removeEventListener('mousemove', onMove);
      doc.removeEventListener('mouseup', onUp);
    };

    doc.addEventListener('mousemove', onMove);
    doc.addEventListener('mouseup', onUp);

    const y = event.clientY - rect.top;
    const level = 1 - (y / rect.height);
    if (kind === 'master') setAuxMasterLevel(level);
    else setFaderLevel(channel, level);
  }

  async function handleLogin(profileId: number) {
    try {
      const data = await api.login(profileId);
      const channels = await api.getChannels();
      const profile = data.slot || data.profile;
      if (!profile) return;

      let liveLevels = {};
      let liveAuxMasterLevel = 0.7;
      if ((data.allowedChannels || []).length) {
        try {
          const liveResponse = await api.getAuxSendLevels(profile.auxBus, data.allowedChannels);
          liveLevels = liveResponse.levels || {};
        } catch (error) {
          console.error('Failed to load live send levels:', error);
        }
      }

      try {
        const auxMasterResponse = await api.getAuxMasterLevel(profile.auxBus);
        if (Number.isFinite(Number(auxMasterResponse?.level))) {
          liveAuxMasterLevel = Number(auxMasterResponse.level);
        }
      } catch (error) {
        console.error('Failed to load aux master level:', error);
      }

      state.channels = channels;
      applyLoginState(state, {
        profile,
        allowedChannels: data.allowedChannels || [],
        savedMixes: Array.isArray(data.savedMixes) ? data.savedMixes : [],
        liveLevels,
        liveAuxMasterLevel,
      });

      dom.showMixerScreen(refs);
      dom.updateMixerHeader(refs, state.currentProfile, getAuxLabel(state, state.currentProfile.auxBus));
      updateLoadedMixUI();
      ensureLiveEventStream();
      renderFaders();
    } catch (error) {
      console.error('Login failed:', error);
    }
  }

  function handleLogout() {
    if (state.currentProfile) {
      api.logout(state.currentProfile.id).catch((error) => console.error('Logout failed:', error));
    }

    resetSessionState(state);
    closeLiveEventStream();
    dom.closeRecallModal(refs);
    updateLoadedMixUI();
    dom.showLoginScreen(refs);
  }

  function allFadersUnity() {
    const unity = dbToLevel(0);
    state.allowedChannels.forEach((channel) => setFaderLevel(channel, unity));
  }

  async function refreshSavedMixes() {
    state.savedMixes = await api.getSavedMixes();
    dom.renderRecallList(refs, state.savedMixes);
  }

  async function openRecallModal() {
    if (!state.currentProfile) return;
    await refreshSavedMixes();
    dom.openRecallModal(refs);
  }

  async function handleRecallMix(mixId: string) {
    try {
      const response = await api.recallMix(state.currentProfile.id, mixId);
      const appliedMix = response.mix || state.savedMixes.find((mix) => mix.id === mixId);
      const appliedLevels = response.levels || (appliedMix ? appliedMix.levels : {}) || {};

      applyRecalledMixLevels(state, appliedLevels);
      state.allowedChannels.forEach((channel) => {
        setFaderLevel(channel, state.faderLevels[channel], { skipLiveSend: true });
      });

      if (appliedMix) {
        setLoadedMix(state, appliedMix);
        syncLocalMixCache(state, appliedMix);
      }

      updateLoadedMixUI();
      dom.closeRecallModal(refs);
    } catch (error) {
      console.error('Recall failed:', error);
    }
  }

  async function handleCreateMix() {
    const name = window.prompt('Name this mix');
    if (!name || !name.trim()) return;

    try {
      const mix = await api.createMix(name.trim(), { ...state.faderLevels });
      syncLocalMixCache(state, mix);
      setLoadedMix(state, mix);
      updateLoadedMixUI();
    } catch (error) {
      console.error('Create mix failed:', error);
    }
  }

  async function handleSaveMix() {
    if (!state.currentLoadedMixId) return;

    try {
      const updatedMix = await api.saveMix(state.currentLoadedMixId, { ...state.faderLevels });
      syncLocalMixCache(state, updatedMix);
    } catch (error) {
      console.error('Save failed:', error);
      return;
    }

    refs.saveMixButton.textContent = '✓ Saved!';
    setTimeout(() => {
      refs.saveMixButton.textContent = '✓ Save Mix';
    }, 1500);
  }

  function sendLiveFaderLevel(channel: number, level: number) {
    if (!state.currentProfile) return;

    clearTimeout(state.faderSendTimers[channel]);
    state.faderSendTimers[channel] = setTimeout(() => {
      api.setFaderLevel(state.currentProfile.id, channel, level)
        .catch((error) => console.error('Live level send failed:', error));
    }, 25);
  }

  function sendLiveAuxMasterLevel(level: number) {
    if (!state.currentProfile) return;

    clearTimeout(state.faderSendTimers['master'] as ReturnType<typeof setTimeout> | undefined);
    state.faderSendTimers['master'] = setTimeout(() => {
      api.setAuxMasterLevel(state.currentProfile.id, state.currentProfile.auxBus, level)
        .catch((error) => console.error('Live aux master send failed:', error));
    }, 25);
  }

  async function init() {
    try {
      const [profiles, channels, dliveStatus] = await Promise.all([
        api.getProfiles(),
        api.getChannels(),
        api.getDLiveStatus(),
      ]);

      applyBootstrapData(state, {
        profiles,
        channels,
        auxBuses: Array.isArray(dliveStatus.auxBuses) ? dliveStatus.auxBuses : [],
      });
    } catch (error) {
      console.error('Failed to load initial data:', error);
    }

    renderLogin();
    updateLoadedMixUI();
    ensureLiveEventStream();
  }

  refs.loginGrid.addEventListener('click', (event) => {
    const button = (event.target as Element | null)?.closest('[data-action="login"]') as HTMLElement | null;
    if (!button) return;
    handleLogin(Number(button.dataset.profileId));
  });

  refs.faderArea.addEventListener('click', (event) => {
    const button = (event.target as Element | null)?.closest('[data-action="toggle-mute"]') as HTMLElement | null;
    if (!button) return;
    toggleMute(Number(button.dataset.ch));
  });

  refs.mixList.addEventListener('click', (event) => {
    const button = (event.target as Element | null)?.closest('[data-action="recall-mix"]') as HTMLElement | null;
    if (!button) return;
    handleRecallMix(button.dataset.mixId);
  });

  doc.body.addEventListener('click', (event) => {
    const button = (event.target as Element | null)?.closest('[data-action]') as HTMLElement | null;
    if (!button) return;

    switch (button.dataset.action) {
      case 'logout':
        handleLogout();
        break;
      case 'open-recall-modal':
        openRecallModal();
        break;
      case 'close-recall-modal':
        dom.closeRecallModal(refs);
        break;
      case 'all-faders-unity':
        allFadersUnity();
        break;
      case 'create-mix':
        handleCreateMix();
        break;
      case 'save-mix':
        handleSaveMix();
        break;
      default:
        break;
    }
  });

  return {
    init,
    state,
  };
}

export {
  createInitialState,
  applyLoginState,
  applyRecalledMixLevels,
};
