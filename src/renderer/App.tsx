import React, { useEffect, useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { SearchPage } from './pages/SearchPage';
import { DownloadsPage } from './pages/DownloadsPage';
import { SettingsPage } from './pages/SettingsPage';
import { SteamPromptDialog } from './dialogs/SteamPromptDialog';
import { SetupWizard } from './dialogs/SetupWizard';
import { useAppStore } from './stores/app-store';
import { useDownloadStore } from './stores/download-store';
import { IPC } from '../shared/ipc-channels';

export default function App() {
  const { sidebarItem, toolStatus, loadToolStatus, loadArchitecture, loadSavedCredentials } = useAppStore();
  const loadExistingDownloads = useDownloadStore((s) => s.loadExistingDownloads);
  const [showSetup, setShowSetup] = useState(false);
  const [checkedTools, setCheckedTools] = useState(false);

  useEffect(() => {
    loadToolStatus().then(() => setCheckedTools(true));
    loadArchitecture();
    loadSavedCredentials();
    loadExistingDownloads();
  }, []);

  // Auto-show setup wizard when tools are missing on first load
  useEffect(() => {
    if (!checkedTools || !toolStatus) return;
    const missingEssentials = !toolStatus.hasDownloadTool || !toolStatus.hasWineTool;
    if (missingEssentials) {
      setShowSetup(true);
    }
  }, [checkedTools, toolStatus]);

  // Listen for streaming IPC events from main process
  useEffect(() => {
    const store = useDownloadStore.getState();

    const unsubs = [
      window.electronAPI.on(IPC.DOWNLOAD_PROGRESS, (data: any) => {
        store.updateProgress(data.taskId, data.percent);
      }),
      window.electronAPI.on(IPC.DOWNLOAD_STATUS, (data: any) => {
        store.updateStatus(data.taskId, data.status);
      }),
      window.electronAPI.on(IPC.DOWNLOAD_LOG, (data: any) => {
        store.appendLog(data.taskId, data.line);
      }),
      window.electronAPI.on(IPC.DOWNLOAD_AUTH_PROMPT, (data: any) => {
        store.showAuthPrompt(data.taskId, data.type);
      }),
    ];

    return () => unsubs.forEach(unsub => unsub());
  }, []);

  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 overflow-hidden">
        {sidebarItem === 'search' && <SearchPage />}
        {sidebarItem === 'downloads' && <DownloadsPage />}
        {sidebarItem === 'settings' && <SettingsPage />}
      </main>
      <SteamPromptDialog />
      <SetupWizard
        open={showSetup}
        onClose={() => {
          setShowSetup(false);
          loadToolStatus();
        }}
      />
    </div>
  );
}
