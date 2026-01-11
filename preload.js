const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("agentConfig", {
  getCurrent: () => ipcRenderer.invoke("agentConfig:getCurrent"),
  save: (payload) => ipcRenderer.invoke("agentConfig:save", payload),
});
