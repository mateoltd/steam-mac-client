import { create } from 'zustand';
import type { DownloadTask, DownloadStatus, SteamPromptType } from '../../shared/types';
import { IPC } from '../../shared/ipc-channels';

interface DownloadState {
  tasks: DownloadTask[];
  activePrompt: { taskId: string; type: SteamPromptType } | null;

  startDownload: (appId: number, appName: string, depotId: string, username: string, password: string) => Promise<void>;
  cancelDownload: (taskId: string) => void;
  submitAuthCode: (taskId: string, code: string) => void;
  revealInFinder: (dir: string) => void;
  toggleOnlineMode: (taskId: string) => void;
  loadExistingDownloads: () => Promise<void>;

  // Called by IPC listeners
  updateProgress: (taskId: string, percent: number) => void;
  updateStatus: (taskId: string, status: DownloadStatus) => void;
  appendLog: (taskId: string, line: string) => void;
  showAuthPrompt: (taskId: string, type: SteamPromptType) => void;
  dismissAuthPrompt: () => void;
}

export const useDownloadStore = create<DownloadState>((set, get) => ({
  tasks: [],
  activePrompt: null,

  loadExistingDownloads: async () => {
    const existing = await window.electronAPI.invoke(IPC.SCAN_DOWNLOADS) as
      { appId: number; appName: string; directory: string }[];
    if (!existing?.length) return;
    const tasks: DownloadTask[] = existing.map((e) => ({
      id: crypto.randomUUID(),
      appId: e.appId,
      appName: e.appName,
      depotId: '',
      status: { type: 'completed' as const, outputDirectory: e.directory },
      progressPercent: 100,
      outputLog: '',
      outputDirectory: e.directory,
      onlineMode: true,
    }));
    set((s) => {
      const existingAppIds = new Set(s.tasks.map(t => t.appId));
      const newTasks = tasks.filter(t => !existingAppIds.has(t.appId));
      return { tasks: [...s.tasks, ...newTasks] };
    });
  },

  startDownload: async (appId, appName, depotId, username, password) => {
    const taskId = crypto.randomUUID();
    const task: DownloadTask = {
      id: taskId,
      appId,
      appName,
      depotId,
      status: { type: 'queued' },
      progressPercent: 0,
      outputLog: '',
      outputDirectory: null,
      onlineMode: true,
    };
    set((s) => ({ tasks: [task, ...s.tasks] }));
    await window.electronAPI.invoke(IPC.START_DOWNLOAD, { taskId, appId, appName, depotId, username, password });
  },

  cancelDownload: (taskId) => {
    window.electronAPI.send(IPC.CANCEL_DOWNLOAD, taskId);
  },

  submitAuthCode: (taskId, code) => {
    window.electronAPI.invoke(IPC.SUBMIT_AUTH_CODE, { taskId, code });
    set({ activePrompt: null });
  },

  revealInFinder: (dir) => {
    window.electronAPI.invoke(IPC.REVEAL_IN_FINDER, dir);
  },

  toggleOnlineMode: (taskId) => {
    set((s) => ({
      tasks: s.tasks.map(t => t.id === taskId ? { ...t, onlineMode: !t.onlineMode } : t),
    }));
  },

  updateProgress: (taskId, percent) => {
    set((s) => ({
      tasks: s.tasks.map(t => t.id === taskId ? { ...t, progressPercent: percent } : t),
    }));
  },

  updateStatus: (taskId, status) => {
    set((s) => ({
      tasks: s.tasks.map(t => {
        if (t.id !== taskId) return t;
        const update: Partial<DownloadTask> = { status };
        if (status.type === 'completed' && (status as any).outputDirectory) {
          update.outputDirectory = (status as any).outputDirectory;
        }
        return { ...t, ...update };
      }),
    }));
  },

  appendLog: (taskId, line) => {
    set((s) => ({
      tasks: s.tasks.map(t => t.id === taskId ? { ...t, outputLog: t.outputLog + line + '\n' } : t),
    }));
  },

  showAuthPrompt: (taskId, type) => {
    set({ activePrompt: { taskId, type } });
  },

  dismissAuthPrompt: () => set({ activePrompt: null }),
}));
