import { contextBridge, ipcRenderer } from 'electron';
import type { IPC } from '../shared/ipc-channels';

type Channel = (typeof IPC)[keyof typeof IPC];

const api = {
  invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
  send: (channel: string, ...args: unknown[]) => ipcRenderer.send(channel, ...args),
  on: (channel: string, callback: (...args: unknown[]) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...args);
    ipcRenderer.on(channel, listener);
    return () => { ipcRenderer.removeListener(channel, listener); };
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);

export type ElectronAPI = typeof api;
