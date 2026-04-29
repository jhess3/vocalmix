interface VocalMixServerState {
  port?: number;
  running?: boolean;
}

interface VocalMixRendererAPI {
  getServerState: () => Promise<VocalMixServerState>;
  getDLiveStatus: () => Promise<unknown>;
  connectDLive: (ip: string) => Promise<unknown>;
  disconnectDLive: () => Promise<unknown>;
}

interface Window {
  vocalmix?: VocalMixRendererAPI;
}
