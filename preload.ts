const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vocalmix', {
  getServerState: () => ipcRenderer.invoke('get-server-state'),
  getDLiveStatus: () => ipcRenderer.invoke('get-dlive-status'),
  connectDLive: (ip) => ipcRenderer.invoke('connect-dlive', ip),
  disconnectDLive: () => ipcRenderer.invoke('disconnect-dlive'),
});
export {};
