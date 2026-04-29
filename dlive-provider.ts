function createDLiveProvider(dlive) {
  return {
    getStatus: () => ({
      connected: dlive?.isConnected() || false,
      ip: dlive?.getIP() || null,
      channels: dlive?.getChannels() || [],
      auxBuses: dlive?.getAuxBuses() || [],
    }),
    resync: () => dlive.refreshChannelNames(),
    getAuxSendLevels: (inputChannels, auxBus) => dlive.getAuxSendLevels(inputChannels, auxBus),
    getAuxMasterLevel: (auxBus) => dlive.getAuxMasterLevel(auxBus),
    applyAuxSendLevels: (auxBus, levels) => dlive.applyAuxSendLevels(auxBus, levels),
    setAuxSendLevel: (inputChannel, auxBus, level) => dlive.setAuxSendLevel(inputChannel, auxBus, level),
    setAuxMasterLevel: (auxBus, level) => dlive.setAuxMasterLevel(auxBus, level),
    connect: (ip) => dlive.connect(ip),
    disconnect: () => {
      dlive.disconnect();
      return { success: true };
    },
  };
}

module.exports = { createDLiveProvider };
export {};
