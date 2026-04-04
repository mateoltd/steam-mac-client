import { create } from 'zustand';
import type { ToolStatus } from '../../shared/types';
import { IPC } from '../../shared/ipc-channels';

type SidebarItem = 'search' | 'downloads' | 'settings';

interface AppState {
  sidebarItem: SidebarItem;
  setSidebarItem: (item: SidebarItem) => void;

  toolStatus: ToolStatus | null;
  loadToolStatus: () => Promise<void>;

  architecture: string;
  loadArchitecture: () => Promise<void>;

  steamUsername: string;
  steamPassword: string;
  isAuthenticated: boolean;
  setCredentials: (username: string, password: string) => void;
  clearCredentials: () => void;
  loadSavedCredentials: () => Promise<void>;
}

export const useAppStore = create<AppState>((set) => ({
  sidebarItem: 'search',
  setSidebarItem: (item) => set({ sidebarItem: item }),

  toolStatus: null,
  loadToolStatus: async () => {
    const status = await window.electronAPI.invoke(IPC.LOCATE_TOOLS);
    set({ toolStatus: status as ToolStatus });
  },

  architecture: 'arm64',
  loadArchitecture: async () => {
    const arch = await window.electronAPI.invoke(IPC.GET_ARCHITECTURE);
    set({ architecture: arch as string });
  },

  steamUsername: '',
  steamPassword: '',
  isAuthenticated: false,
  setCredentials: (username, password) => {
    set({ steamUsername: username, steamPassword: password, isAuthenticated: true });
    window.electronAPI.invoke(IPC.SAVE_CREDENTIALS, { username, password });
  },
  clearCredentials: () => {
    set({ steamUsername: '', steamPassword: '', isAuthenticated: false });
    window.electronAPI.invoke(IPC.CLEAR_CREDENTIALS);
  },
  loadSavedCredentials: async () => {
    const creds = await window.electronAPI.invoke(IPC.LOAD_CREDENTIALS) as { username: string; password: string } | null;
    if (creds) {
      set({ steamUsername: creds.username, steamPassword: creds.password, isAuthenticated: true });
    }
  },
}));
