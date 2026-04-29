export async function fetchJSON(path: string, options?: RequestInit) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  return response.json();
}

export function login(profileId: number) {
  return fetchJSON('/api/login', {
    method: 'POST',
    body: JSON.stringify({ slotId: profileId, profileId }),
  });
}

export function logout(profileId: number) {
  return fetchJSON('/api/logout', {
    method: 'POST',
    body: JSON.stringify({ slotId: profileId }),
  });
}

export function getProfiles() {
  return fetchJSON('/api/profiles');
}

export function getChannels() {
  return fetchJSON('/api/channels');
}

export function getDLiveStatus() {
  return fetchJSON('/api/dlive-status');
}

export function getAuxSendLevels(auxBus: number, inputChannels: number[]) {
  return fetchJSON('/api/dlive/send-levels', {
    method: 'POST',
    body: JSON.stringify({ auxBus, inputChannels }),
  });
}

export function getSavedMixes() {
  return fetchJSON('/api/saved-mixes');
}

export function recallMix(slotId: number, mixId: string) {
  return fetchJSON('/api/recall-mix', {
    method: 'POST',
    body: JSON.stringify({ slotId, mixId }),
  });
}

export function createMix(name: string, levels: Record<string, number>) {
  return fetchJSON('/api/saved-mixes', {
    method: 'POST',
    body: JSON.stringify({ name, levels }),
  });
}

export function saveMix(mixId: string, levels: Record<string, number>) {
  return fetchJSON(`/api/saved-mixes/${encodeURIComponent(mixId)}`, {
    method: 'PUT',
    body: JSON.stringify({ levels }),
  });
}

export function setFaderLevel(slotId: number, inputChannel: number, level: number) {
  return fetchJSON('/api/fader-level', {
    method: 'POST',
    body: JSON.stringify({ slotId, inputChannel, level }),
  });
}
