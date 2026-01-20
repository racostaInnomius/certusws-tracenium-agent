const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("agentConfig", {
  getCurrent: () => ipcRenderer.invoke("agentConfig:getCurrent"),
  save: (payload) => ipcRenderer.invoke("agentConfig:save", payload),

  // NUEVO
  getAppInfo: () => ipcRenderer.invoke("agentConfig:getAppInfo"),
  validateAgentKey: (payload) => ipcRenderer.invoke("agentConfig:validateAgentKey", payload),
  cancel: () => ipcRenderer.invoke("agentConfig:cancel"),
});
