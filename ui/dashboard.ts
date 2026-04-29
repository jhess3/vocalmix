const GROUP_COLORS: Record<string, string> = {
  inputs: '#5F6B7A',
  vocals: '#E85D4A',
  keys: '#C77DFF',
  guitars: '#E8A44A',
  bass: '#4AE88D',
  drums: '#4A9EE8',
  utility: '#8B8B8B',
  tracks: '#FF6B9D',
  fx: '#00D4AA',
};

type Channel = {
  ch: number;
  name: string;
  color: string;
  group: string;
};

type AuxBus = {
  id: number;
  name: string;
  color?: string;
};

type Profile = {
  id: number;
  slot: string;
  name: string;
  auxBus: number;
  color: string;
  allowedChannels: number[];
  connected?: boolean;
  lastSeen?: string;
};

type Settings = {
  dliveIP?: string;
  autoConnect?: boolean;
  serverName?: string;
  port?: number;
  faderMin?: number;
  faderMax?: number;
};

const PROFILE_COLORS = ['#E85D4A', '#E8A44A', '#4AE88D', '#4A9EE8', '#C77DFF', '#FF6B9D', '#00D4AA', '#8B8B8B'];

let channels: Channel[] = [];
let auxBuses: AuxBus[] = [
  { id: 1, name: 'Mic 1', color: '#E85D4A' },
  { id: 2, name: 'Mic 2', color: '#E8A44A' },
  { id: 3, name: 'Mic 3', color: '#4AE88D' },
  { id: 4, name: 'Mic 4', color: '#4A9EE8' },
  { id: 5, name: 'Mic 5', color: '#C77DFF' },
  { id: 6, name: 'Mic 6', color: '#FF6B9D' },
  { id: 7, name: 'Mic 7', color: '#00D4AA' },
  { id: 8, name: 'Mic 8', color: '#E8A44A' },
  { id: 9, name: 'IEM MD', color: '#8B8B8B' },
  { id: 10, name: 'IEM Keys', color: '#C77DFF' },
  { id: 11, name: 'Wedge DS', color: '#4A9EE8' },
  { id: 12, name: 'Wedge DR', color: '#4A9EE8' },
];

let profiles: Profile[] = Array.from({ length: 8 }, (_, index) => ({
  id: index + 1,
  slot: `Mic ${index + 1}`,
  name: ['Lead Vocal', 'Harmony 1', 'Harmony 2', 'Spare', '', '', '', ''][index] || '',
  auxBus: index + 1,
  color: PROFILE_COLORS[index],
  allowedChannels: [
    [1, 2, 3, 4, 5, 6, 15, 16, 17, 18],
    [1, 2, 3, 4, 5, 6, 7, 15, 16, 17, 18],
    [1, 2, 3, 4, 5, 6, 15, 16, 17, 18, 20],
    [1, 5, 6, 9, 15, 16, 17],
    [], [], [], [],
  ][index] || [],
  connected: [true, true, false, false, false, false, false, false][index],
  lastSeen: ['Now', 'Now', '2 min ago', 'Last Sunday', 'Never', 'Never', 'Never', 'Never'][index],
}));

let matrix: Record<string, boolean> = {};
profiles.forEach((profile) => {
  profile.allowedChannels.forEach((channel) => {
    matrix[`${profile.auxBus}-${channel}`] = true;
  });
});

let editingProfileId: number | null = null;
let editAux = 1;
let editChannels = new Set<number>();
let matrixDirty = false;
let isDragging = false;
let dragMode: boolean | null = null;
let settings: Settings | null = null;
let liveSendLevels: Record<number, number> = {};
let liveSendLevelLoads = new Set<number>();
let liveSendLevelError: string | null = null;

function getById<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function getApiBase(): Promise<string> | string {
  if (location.protocol !== 'file:') return '';
  return window.vocalmix
    ? window.vocalmix.getServerState().then((state) => `http://localhost:${state.port || 3000}`)
    : Promise.resolve('http://localhost:3000');
}

async function fetchJSON(path: string, options?: RequestInit) {
  const base = await getApiBase();
  const response = await fetch(`${base}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json();
}

async function refreshDLiveData() {
  const status = await fetchJSON('/api/dlive-status');
  channels = Array.isArray(status.channels) ? status.channels : [];
  if (Array.isArray(status.auxBuses) && status.auxBuses.length) {
    auxBuses = status.auxBuses;
  }

  getById<HTMLElement>('dliveStatusText').textContent = status.connected ? 'Connected' : 'Disconnected';
  getById<HTMLElement>('dliveCardStatus').textContent = status.connected ? 'Connected' : 'Disconnected';
  getById<HTMLElement>('dliveCardIP').textContent = status.ip || 'No MixRack';
  getById<HTMLElement>('channelCount').textContent = String(channels.length);
  getById<HTMLElement>('syncBannerTitle').textContent = channels.length
    ? 'Live channel names loaded from dLive.'
    : 'No live channel data loaded.';
  getById<HTMLElement>('syncBannerText').textContent = channels.length
    ? ` ${channels.length} input names synced from the MixRack.`
    : ' Connect to a MixRack and sync channel names.';

  const dotColor = status.connected ? '#34C759' : '#FF9500';
  const dotShadow = status.connected ? '#34C75940' : '#FF950040';
  ['dliveStatusDot', 'dliveCardDot'].forEach((id) => {
    const element = getById<HTMLElement>(id);
    element.style.background = dotColor;
    element.style.boxShadow = `0 0 6px ${dotShadow}`;
  });

  renderProfiles();
  if (editingProfileId) renderChannelCheckboxes();
  renderMatrix();
}

function getAuxLabel(auxId: number) {
  const aux = auxBuses.find((item) => item.id === auxId);
  if (!aux) return `Aux ${auxId}`;
  return aux.name;
}

function formatLiveLevel(level?: number) {
  if (typeof level !== 'number') return '...';
  if (level <= 0) return '-∞';
  const db = (level * 66) - 60;
  return db > 0 ? `+${db.toFixed(1)} dB` : `${db.toFixed(1)} dB`;
}

async function loadLiveSendLevelsForChannels(inputChannels: number[]) {
  if (!editingProfileId || !inputChannels.length) return;

  const requestChannels = [...new Set(inputChannels)]
    .filter((channel) => editChannels.has(channel))
    .filter((channel) => !liveSendLevelLoads.has(channel));

  if (!requestChannels.length) return;

  requestChannels.forEach((channel) => liveSendLevelLoads.add(channel));
  liveSendLevelError = null;
  renderChannelCheckboxes();

  try {
    const response = await fetchJSON('/api/dlive/send-levels', {
      method: 'POST',
      body: JSON.stringify({
        auxBus: editAux,
        inputChannels: requestChannels,
      }),
    });

    Object.entries(response.levels || {}).forEach(([channel, level]) => {
      liveSendLevels[Number(channel)] = Number(level);
    });
  } catch (error) {
    liveSendLevelError = error instanceof Error ? error.message : String(error);
  } finally {
    requestChannels.forEach((channel) => liveSendLevelLoads.delete(channel));
    renderChannelCheckboxes();
  }
}

async function loadCurrentProfileLiveSendLevels() {
  liveSendLevels = {};
  liveSendLevelLoads = new Set();
  liveSendLevelError = null;
  renderChannelCheckboxes();
  await loadLiveSendLevelsForChannels([...editChannels]);
}

async function loadProfiles() {
  profiles = await fetchJSON('/api/profiles');
  getById<HTMLElement>('connectedCount').textContent =
    `${profiles.filter((profile) => profile.name).length} / ${profiles.length}`;
}

async function loadMatrix() {
  matrix = await fetchJSON('/api/matrix');
  profiles.forEach((profile) => {
    profile.allowedChannels = channels
      .filter((channel) => matrix[`${profile.auxBus}-${channel.ch}`])
      .map((channel) => channel.ch);
  });
}

async function loadSettings() {
  settings = await fetchJSON('/api/settings');
  getById<HTMLInputElement>('dliveIP').value = settings?.dliveIP || '';
  getById<HTMLInputElement>('autoConnect').checked = !!settings?.autoConnect;
  getById<HTMLInputElement>('serverName').value = settings?.serverName || 'VocalMix';
  getById<HTMLInputElement>('serverPortSetting').value = String(settings?.port || 3000);
  getById<HTMLInputElement>('faderMin').value = String(settings?.faderMin ?? -60);
  getById<HTMLInputElement>('faderMax').value = String(settings?.faderMax ?? 6);
}

function readSettingsForm(): Settings {
  return {
    dliveIP: getById<HTMLInputElement>('dliveIP').value.trim(),
    autoConnect: getById<HTMLInputElement>('autoConnect').checked,
    serverName: getById<HTMLInputElement>('serverName').value.trim() || 'VocalMix',
    faderMin: Number(getById<HTMLInputElement>('faderMin').value),
    faderMax: Number(getById<HTMLInputElement>('faderMax').value),
  };
}

async function saveSettings() {
  try {
    settings = await fetchJSON('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(readSettingsForm()),
    });
    await loadSettings();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    alert(`Failed to save settings: ${message}`);
  }
}

async function connectDLiveNow() {
  try {
    const nextSettings = readSettingsForm();
    nextSettings.autoConnect = true;
    getById<HTMLInputElement>('autoConnect').checked = true;
    await fetchJSON('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(nextSettings),
    });
    await fetchJSON('/api/dlive/connect', {
      method: 'POST',
      body: JSON.stringify({ ip: nextSettings.dliveIP }),
    });
    setTimeout(refreshDLiveData, 500);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    alert(`Failed to connect to dLive: ${message}`);
  }
}

async function disconnectDLiveNow() {
  try {
    await fetchJSON('/api/dlive/disconnect', { method: 'POST', body: '{}' });
    setTimeout(refreshDLiveData, 100);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    alert(`Failed to disconnect dLive: ${message}`);
  }
}

function switchTab(tab: string) {
  document.querySelectorAll('.tab').forEach((tabElement, index) => {
    tabElement.classList.toggle('active', ['profiles', 'matrix', 'settings'][index] === tab);
  });
  ['profiles', 'matrix', 'settings'].forEach((section) => {
    const element = document.getElementById(`tab-${section}`);
    if (element) element.style.display = section === tab ? 'block' : 'none';
  });
  if (tab === 'matrix') renderMatrix();
}

function renderProfiles() {
  const grid = getById<HTMLElement>('profilesGrid');
  grid.innerHTML = profiles.map((profile) => `
    <div class="profile-card ${editingProfileId === profile.id ? 'selected' : ''}"
         onclick="openEdit(${profile.id})">
      <div class="profile-avatar ${!profile.name ? 'unassigned' : ''}"
           style="${profile.name ? `background:linear-gradient(135deg,${profile.color},${profile.color}aa)` : ''}">
        ${profile.name ? profile.id : '+'}
      </div>
      <div class="profile-info">
        <div class="profile-slot">
          ${profile.slot}
          ${profile.connected ? '<span class="online-dot"></span>' : ''}
        </div>
        <div class="profile-name ${!profile.name ? 'empty' : ''}">
          ${profile.name || 'Tap to assign'}
        </div>
      </div>
      <div class="profile-aux">${getAuxLabel(profile.auxBus)}</div>
      ${profile.allowedChannels.length ? `<div class="profile-chcount">${profile.allowedChannels.length} ch</div>` : ''}
    </div>
  `).join('');
}

function openEdit(id: number) {
  const profile = profiles.find((item) => item.id === id);
  if (!profile) return;

  editingProfileId = id;
  editAux = profile.auxBus;
  editChannels = new Set(profile.allowedChannels);

  getById<HTMLElement>('editAvatar').textContent = String(profile.id);
  getById<HTMLElement>('editAvatar').style.background =
    profile.name ? `linear-gradient(135deg,${profile.color},${profile.color}aa)` : 'rgba(255,255,255,0.04)';
  getById<HTMLElement>('editSlot').textContent = profile.slot;
  getById<HTMLInputElement>('editName').value = profile.name || '';
  getById<HTMLElement>('editPanel').classList.add('open');

  renderAuxGrid();
  renderChannelCheckboxes();
  renderProfiles();
  void loadCurrentProfileLiveSendLevels();
}

function closeEdit() {
  editingProfileId = null;
  getById<HTMLElement>('editPanel').classList.remove('open');
  renderProfiles();
}

function renderAuxGrid() {
  const grid = getById<HTMLElement>('auxGrid');
  grid.innerHTML = auxBuses.map((aux) => `
    <button class="aux-btn ${editAux === aux.id ? 'active' : ''}"
            onclick="selectEditAux(${aux.id})"
            title="${aux.name}">
      ${aux.id}<span style="display:block;font-size:10px;opacity:0.75;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:90px">${aux.name}</span>
    </button>
  `).join('');
}

function selectEditAux(auxId: number) {
  editAux = auxId;
  renderAuxGrid();
  void loadCurrentProfileLiveSendLevels();
}

function renderChannelCheckboxes() {
  const container = getById<HTMLElement>('channelCheckboxes');
  if (!channels.length) {
    container.innerHTML = '<div style="padding:10px;color:var(--text-muted);font-size:12px">No live channel names have been received from the MixRack yet.</div>';
    return;
  }

  const errorBanner = liveSendLevelError
    ? `<div style="padding:8px 10px;color:#ffb4aa;font-size:12px">Live send levels unavailable: ${liveSendLevelError}</div>`
    : '';

  container.innerHTML = errorBanner + channels.map((channel) => {
    const enabled = editChannels.has(channel.ch);
    const levelText = enabled
      ? (liveSendLevelLoads.has(channel.ch) ? 'Loading...' : formatLiveLevel(liveSendLevels[channel.ch]))
      : '';

    return `
      <div onclick="toggleEditChannel(${channel.ch})" style="
        display:flex;align-items:center;gap:10px;
        padding:7px 10px;border-radius:6px;cursor:pointer;
        background:${enabled ? `color-mix(in srgb, ${channel.color} 12%, transparent)` : 'transparent'};
        border:1px solid ${enabled ? `color-mix(in srgb, ${channel.color} 30%, transparent)` : 'transparent'};
      ">
        <div style="
          width:18px;height:18px;border-radius:4px;
          background:${enabled ? channel.color : 'rgba(255,255,255,0.1)'};
          border:${enabled ? 'none' : '1px solid rgba(255,255,255,0.15)'};
          display:flex;align-items:center;justify-content:center;
          font-size:11px;color:white;
        ">${enabled ? '✓' : ''}</div>
        <span style="color:rgba(255,255,255,0.35);font-size:12px;width:20px;font-weight:500">${channel.ch}</span>
        <span style="color:white;font-size:13px">${channel.name}</span>
        <span style="margin-left:auto;font-size:11px;color:${enabled ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.2)'};font-variant-numeric:tabular-nums;width:72px;text-align:right">${levelText}</span>
        <span style="margin-left:auto;font-size:10px;color:rgba(255,255,255,0.2);text-transform:uppercase">${channel.group}</span>
      </div>
    `;
  }).join('');
}

function toggleEditChannel(channel: number) {
  if (editChannels.has(channel)) {
    editChannels.delete(channel);
  } else {
    editChannels.add(channel);
    void loadLiveSendLevelsForChannels([channel]);
  }
  renderChannelCheckboxes();
}

function applyPreset(type: string) {
  const vocalBasic = [1, 2, 3, 4, 5, 6, 15, 16, 17, 18];
  const vocalFull = [1, 2, 3, 4, 5, 6, 7, 8, 9, 15, 16, 17, 18, 19, 20];
  const all = channels.map((channel) => channel.ch);

  switch (type) {
    case 'vocalist-basic':
      editChannels = new Set(vocalBasic);
      break;
    case 'vocalist-full':
      editChannels = new Set(vocalFull);
      break;
    case 'all':
      editChannels = new Set(all);
      break;
    case 'clear':
      editChannels = new Set();
      break;
    default:
      break;
  }

  renderChannelCheckboxes();
}

async function saveProfile() {
  const profile = profiles.find((item) => item.id === editingProfileId);
  if (!profile) return;

  const previousAuxBus = profile.auxBus;
  const nextProfile = {
    ...profile,
    name: getById<HTMLInputElement>('editName').value.trim(),
    auxBus: editAux,
  };

  channels.forEach((channel) => {
    delete matrix[`${previousAuxBus}-${channel.ch}`];
  });
  channels.forEach((channel) => {
    matrix[`${nextProfile.auxBus}-${channel.ch}`] = editChannels.has(channel.ch);
  });

  try {
    const savedProfile = await fetchJSON(`/api/profiles/${profile.id}`, {
      method: 'PUT',
      body: JSON.stringify(nextProfile),
    });
    await fetchJSON('/api/matrix', {
      method: 'PUT',
      body: JSON.stringify(matrix),
    });

    Object.assign(profile, savedProfile);
    profile.allowedChannels = [...editChannels];
    closeEdit();
    renderProfiles();
    renderMatrix();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    alert(`Failed to save profile: ${message}`);
  }
}

function renderMatrix() {
  const table = getById<HTMLElement>('matrixTable');
  if (!channels.length) {
    table.innerHTML = '<tbody><tr><td style="padding:20px;color:var(--text-muted);font-size:12px">No live channel names available. Connect to dLive and re-sync.</td></tr></tbody>';
    return;
  }

  const matrixChannels = [...channels].sort((left, right) => left.ch - right.ch);
  const groups: Array<{ group: string; count: number }> = [];
  let lastGroup: string | null = null;

  matrixChannels.forEach((channel) => {
    if (channel.group !== lastGroup) {
      groups.push({ group: channel.group, count: 0 });
      lastGroup = channel.group;
    }
    groups[groups.length - 1].count += 1;
  });

  let html = '<thead>';
  html += '<tr><th class="row-header" style="border-bottom:1px solid var(--border)"><span style="font-size:10px;color:var(--text-muted)">Aux → Input</span></th>';
  groups.forEach((group) => {
    html += `<th colspan="${group.count}" style="border-left:1px solid var(--border)">
      <span class="group-header" style="color:${GROUP_COLORS[group.group]}">${group.group.toUpperCase()}</span>
    </th>`;
  });
  html += '<th style="width:45px"></th></tr>';

  html += '<tr><th class="row-header"></th>';
  matrixChannels.forEach((channel, index) => {
    const isFirst = index === 0 || matrixChannels[index - 1].group !== channel.group;
    html += `<th style="${isFirst ? 'border-left:1px solid var(--border)' : ''}">
      <div class="ch-number">${channel.ch}</div>
      <div class="ch-name">${channel.name}</div>
    </th>`;
  });
  html += '<th><span class="ch-number">#</span></th></tr></thead>';

  html += '<tbody>';
  profiles.forEach((profile) => {
    const count = channels.filter((channel) => matrix[`${profile.auxBus}-${channel.ch}`]).length;
    html += '<tr>';
    html += `<td class="row-header">
      <div style="display:flex;align-items:center;gap:10px">
        <div style="width:30px;height:30px;border-radius:8px;display:flex;align-items:center;justify-content:center;
          font-size:13px;font-weight:700;color:white;flex-shrink:0;
          ${profile.name ? `background:linear-gradient(135deg,${profile.color},${profile.color}99)` : 'background:rgba(255,255,255,0.04);border:1px dashed rgba(255,255,255,0.12)'}">
          ${profile.id}
        </div>
        <div>
          <div style="font-size:12px;font-weight:600">${profile.slot}</div>
          <div style="font-size:10px;color:${profile.name ? 'var(--text-dim)' : 'var(--text-muted)'};${!profile.name ? 'font-style:italic' : ''}">${profile.name || 'Unassigned'}</div>
          <div style="font-size:10px;color:var(--text-muted)">${getAuxLabel(profile.auxBus)}</div>
        </div>
      </div>
    </td>`;

    matrixChannels.forEach((channel, index) => {
      const key = `${profile.auxBus}-${channel.ch}`;
      const enabled = !!matrix[key];
      const isFirst = index === 0 || matrixChannels[index - 1].group !== channel.group;
      html += `<td style="${isFirst ? 'border-left:1px solid var(--border)' : ''}">
        <div class="matrix-cell ${enabled ? 'on' : ''}"
             style="--cell-color:${channel.color}"
             data-aux="${profile.auxBus}" data-ch="${channel.ch}"
             onmousedown="matrixMouseDown(event,${profile.auxBus},${channel.ch})"
             onmouseenter="matrixMouseEnter(event,${profile.auxBus},${channel.ch})">
          ${enabled ? '<div class="dot"></div>' : ''}
        </div>
      </td>`;
    });

    html += `<td class="count-cell">${count}</td>`;
    html += '</tr>';
  });
  html += '</tbody>';

  table.innerHTML = html;
}

function matrixMouseDown(event: MouseEvent, aux: number, channel: number) {
  event.preventDefault();
  const key = `${aux}-${channel}`;
  dragMode = !matrix[key];
  isDragging = true;
  matrix[key] = !!dragMode;
  matrixDirty = true;
  getById<HTMLElement>('pushBtn').style.display = 'flex';

  const profile = profiles.find((item) => item.auxBus === aux);
  if (profile) {
    if (dragMode) {
      if (!profile.allowedChannels.includes(channel)) profile.allowedChannels.push(channel);
    } else {
      profile.allowedChannels = profile.allowedChannels.filter((item) => item !== channel);
    }
  }

  renderMatrix();
}

function matrixMouseEnter(_event: MouseEvent, aux: number, channel: number) {
  if (!isDragging) return;
  const key = `${aux}-${channel}`;
  matrix[key] = !!dragMode;
  matrixDirty = true;

  const profile = profiles.find((item) => item.auxBus === aux);
  if (profile) {
    if (dragMode) {
      if (!profile.allowedChannels.includes(channel)) profile.allowedChannels.push(channel);
    } else {
      profile.allowedChannels = profile.allowedChannels.filter((item) => item !== channel);
    }
  }

  renderMatrix();
}

document.addEventListener('mouseup', () => {
  isDragging = false;
  dragMode = null;
});

async function pushMatrix() {
  try {
    await fetchJSON('/api/matrix', {
      method: 'PUT',
      body: JSON.stringify(matrix),
    });
    matrixDirty = false;
    getById<HTMLElement>('pushBtn').style.display = 'none';
    alert('Channel access matrix saved.');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    alert(`Failed to save matrix: ${message}`);
  }
}

async function resyncDLive() {
  try {
    await fetchJSON('/api/dlive/resync', { method: 'POST', body: '{}' });
    setTimeout(refreshDLiveData, 500);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    alert(`Failed to re-sync dLive: ${message}`);
  }
}

async function initDashboard() {
  renderProfiles();
  renderMatrix();
  try {
    await loadSettings();
    await refreshDLiveData();
    await loadProfiles();
    await loadMatrix();
    renderProfiles();
    renderMatrix();
  } catch (error) {
    console.error('Failed to load dLive data:', error);
  }
}

Object.assign(window, {
  applyPreset,
  closeEdit,
  connectDLiveNow,
  disconnectDLiveNow,
  matrixMouseDown,
  matrixMouseEnter,
  openEdit,
  pushMatrix,
  resyncDLive,
  saveProfile,
  saveSettings,
  selectEditAux,
  switchTab,
  toggleEditChannel,
});

void initDashboard();
