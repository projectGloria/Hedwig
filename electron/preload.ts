import { contextBridge, ipcRenderer } from "electron";
import type { API, Snapshot, AuthProgress } from "../src/shared";
const api: API = {
  snapshot: () => ipcRenderer.invoke("snapshot"),
  inspect: (url) => ipcRenderer.invoke("inspect", url),
  chooseFolder: () => ipcRenderer.invoke("chooseFolder"),
  download: (url, destination) =>
    ipcRenderer.invoke("download", { url, destination }),
  upload: (jobId, provider, name, visibility) =>
    ipcRenderer.invoke("upload", { jobId, provider, name, visibility }),
  cancel: (id) => ipcRenderer.invoke("cancel", id),
  retry: (id) => ipcRenderer.invoke("retry", id),
  saveSettings: (settings) => ipcRenderer.invoke("saveSettings", settings),
  connect: (provider) => ipcRenderer.invoke("connect", provider),
  disconnect: (provider) => ipcRenderer.invoke("disconnect", provider),
  openFolder: (id) => ipcRenderer.invoke("openFolder", id),
  copyUrl: (id) => ipcRenderer.invoke("copyUrl", id),
  openExternal: (url) => ipcRenderer.invoke("openExternal", url),
  onChange: (callback) => {
    const handler = (_: unknown, value: Snapshot) => callback(value);
    ipcRenderer.on("changed", handler);
    return () => ipcRenderer.removeListener("changed", handler);
  },
  onAuth: (callback) => {
    const handler = (_: unknown, value: AuthProgress) => callback(value);
    ipcRenderer.on("auth", handler);
    return () => ipcRenderer.removeListener("auth", handler);
  },
};
contextBridge.exposeInMainWorld("hedwig", api);
