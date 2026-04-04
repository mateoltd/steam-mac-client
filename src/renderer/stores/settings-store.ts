import { create } from 'zustand';
import type { AppSettings, WineBackend } from '../../shared/types';
import { IPC } from '../../shared/ipc-channels';

interface SettingsState {
  settings: AppSettings;
  loaded: boolean;

  loadSettings: () => Promise<void>;
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => Promise<void>;
  pickDirectory: () => Promise<void>;
}

const defaults: AppSettings = {
  steamUsername: '',
  downloadDirectory: '',
  wineBackend: 'gptk',
};

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: { ...defaults },
  loaded: false,

  loadSettings: async () => {
    const result = await window.electronAPI.invoke(IPC.GET_SETTINGS);
    set({ settings: result as AppSettings, loaded: true });
  },

  updateSetting: async (key, value) => {
    const updated = { ...get().settings, [key]: value };
    set({ settings: updated });
    await window.electronAPI.invoke(IPC.SET_SETTINGS, updated);
  },

  pickDirectory: async () => {
    const dir = await window.electronAPI.invoke(IPC.PICK_DIRECTORY);
    if (dir) {
      const updated = { ...get().settings, downloadDirectory: dir as string };
      set({ settings: updated });
      await window.electronAPI.invoke(IPC.SET_SETTINGS, updated);
    }
  },
}));
