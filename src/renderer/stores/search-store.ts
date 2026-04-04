import { create } from 'zustand';
import type { SteamApp, Depot } from '../../shared/types';
import { IPC } from '../../shared/ipc-channels';

interface SearchState {
  query: string;
  results: SteamApp[];
  isSearching: boolean;
  error: string | null;
  selectedGame: SteamApp | null;

  setQuery: (query: string) => void;
  search: (query: string) => Promise<void>;
  selectGame: (game: SteamApp | null) => void;

  depots: Depot[];
  isLoadingDepots: boolean;
  depotError: string | null;
  selectedDepotId: string | null;
  loadDepots: (appId: number) => Promise<void>;
  selectDepot: (depotId: string | null) => void;
}

let searchTimer: ReturnType<typeof setTimeout> | null = null;

export const useSearchStore = create<SearchState>((set, get) => ({
  query: '',
  results: [],
  isSearching: false,
  error: null,
  selectedGame: null,

  setQuery: (query) => {
    set({ query });
    if (searchTimer) clearTimeout(searchTimer);
    if (!query.trim()) {
      set({ results: [], error: null });
      return;
    }
    searchTimer = setTimeout(() => get().search(query), 300);
  },

  search: async (query) => {
    set({ isSearching: true, error: null });
    try {
      const results = await window.electronAPI.invoke(IPC.SEARCH_GAMES, query);
      set({ results: results as SteamApp[], isSearching: false });
    } catch (err) {
      set({ error: String(err), isSearching: false });
    }
  },

  selectGame: (game) => {
    set({ selectedGame: game, depots: [], selectedDepotId: null, depotError: null });
    if (game) get().loadDepots(game.id);
  },

  depots: [],
  isLoadingDepots: false,
  depotError: null,
  selectedDepotId: null,

  loadDepots: async (appId) => {
    set({ isLoadingDepots: true, depotError: null });
    try {
      const depots = await window.electronAPI.invoke(IPC.GET_DEPOTS, appId);
      const depotList = depots as Depot[];
      set({ depots: depotList, isLoadingDepots: false });
      // Auto-select first Windows depot
      const windowsDepot = depotList.find(d => d.oslist.includes('windows') || d.oslist.length === 0);
      if (windowsDepot) set({ selectedDepotId: windowsDepot.id });
    } catch (err) {
      set({ depotError: String(err), isLoadingDepots: false });
    }
  },

  selectDepot: (depotId) => set({ selectedDepotId: depotId }),
}));
