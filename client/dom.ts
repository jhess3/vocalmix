export function createDomRefs(doc = document) {
  return {
    loginScreen: doc.getElementById('loginScreen'),
    mixerScreen: doc.getElementById('mixerScreen'),
    loginGrid: doc.getElementById('loginGrid'),
    mixerAvatar: doc.getElementById('mixerAvatar'),
    mixerName: doc.getElementById('mixerName'),
    mixerAux: doc.getElementById('mixerAux'),
    loadedMixLabel: doc.getElementById('loadedMixLabel'),
    mixerStats: doc.getElementById('mixerStats'),
    mixerHint: doc.getElementById('mixerHint'),
    faderArea: doc.getElementById('faderArea'),
    mixModal: doc.getElementById('mixModal'),
    mixList: doc.getElementById('mixList'),
    saveMixButton: doc.querySelector('[data-action="save-mix"]'),
  };
}

export function renderLogin(refs, profiles) {
  refs.loginGrid.innerHTML = profiles.map((profile) => {
    const label = profile.slot || `Mic ${profile.id}`;
    return `
      <button
        class="login-btn"
        type="button"
        data-action="login"
        data-profile-id="${profile.id}"
        style="background:linear-gradient(145deg,${profile.color}25,${profile.color}10);border-color:${profile.color}40"
      >
        <span class="num" style="color:${profile.color}">${profile.id}</span>
        <span class="name">${label}</span>
      </button>
    `;
  }).join('');
}

export function updateMixerHeader(refs, profile, auxLabel) {
  refs.mixerAvatar.textContent = profile.id;
  refs.mixerAvatar.style.background = `linear-gradient(135deg,${profile.color},${profile.color}99)`;
  refs.mixerName.textContent = profile.slot || `Mic ${profile.id}`;
  refs.mixerAux.textContent = auxLabel;
}

export function updateLoadedMixUI(refs, state) {
  if (state.currentLoadedMixId && state.currentLoadedMixName) {
    refs.loadedMixLabel.textContent = `Loaded mix: ${state.currentLoadedMixName}`;
    refs.saveMixButton.disabled = false;
    return;
  }

  refs.loadedMixLabel.textContent = 'Live mix only';
  refs.saveMixButton.disabled = true;
}

export function showLoginScreen(refs) {
  refs.loginScreen.style.display = 'flex';
  refs.mixerScreen.style.display = 'none';
}

export function showMixerScreen(refs) {
  refs.loginScreen.style.display = 'none';
  refs.mixerScreen.style.display = 'flex';
}

export function renderFaders(refs, state, { levelToDb }) {
  const visibleChannels = state.channels.filter((channel) => state.allowedChannels.includes(channel.ch));
  refs.mixerStats.textContent = `${visibleChannels.length} channels`;
  refs.mixerHint.textContent = visibleChannels.length > 10
    ? 'Swipe sideways for the full mix'
    : 'Drag faders to shape the mix';

  if (!visibleChannels.length) {
    refs.faderArea.innerHTML = '<div class="fader-empty">No live dLive channel names are available for this profile.</div>';
    return;
  }

  refs.faderArea.innerHTML = visibleChannels.map((channel) => {
    const level = state.faderLevels[channel.ch] || 0;
    const muted = state.mutedChannels.has(channel.ch);
    const pct = level * 100;

    return `
      <div class="fader-strip" data-ch="${channel.ch}">
        <div class="fader-label">${channel.name}</div>
        <div class="fader-ch">CH ${channel.ch}</div>
        <div class="fader-track" data-ch="${channel.ch}">
          <div class="fader-fill" style="height:${pct}%;background:${muted ? '#FF3B30' : channel.color};opacity:${muted ? 0.3 : 0.4}"></div>
          <div class="fader-thumb" style="bottom:${pct}%" data-ch="${channel.ch}"></div>
        </div>
        <div class="fader-db">${levelToDb(level)}</div>
        <button class="fader-mute ${muted ? 'muted' : ''}" type="button" data-action="toggle-mute" data-ch="${channel.ch}">
          ${muted ? 'MUTE' : 'M'}
        </button>
      </div>
    `;
  }).join('');
}

export function renderRecallList(refs, savedMixes) {
  if (!savedMixes.length) {
    refs.mixList.innerHTML = '<div class="mix-empty">No saved mixes yet. Create one from the current live mix first.</div>';
    return;
  }

  refs.mixList.innerHTML = savedMixes.map((mix) => {
    const updated = mix.updatedAt ? new Date(mix.updatedAt).toLocaleString() : 'Unknown';
    const channelCount = Object.keys(mix.levels || {}).length;
    return `
      <button class="mix-item" type="button" data-action="recall-mix" data-mix-id="${mix.id}">
        <div class="mix-item-name">${mix.name}</div>
        <div class="mix-item-meta">${channelCount} channels · Updated ${updated}</div>
      </button>
    `;
  }).join('');
}

export function openRecallModal(refs) {
  refs.mixModal.classList.add('open');
}

export function closeRecallModal(refs) {
  refs.mixModal.classList.remove('open');
}
