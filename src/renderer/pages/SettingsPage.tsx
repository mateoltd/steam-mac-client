import React, { useState, useEffect } from 'react';
import {
  IconRefresh,
  IconDownload,
  IconTool,
  IconFolder,
} from '@tabler/icons-react';
import { useAppStore } from '../stores/app-store';
import { useSettingsStore } from '../stores/settings-store';
import { ToolCheckRow } from '../components/ToolCheckRow';
import { SetupWizard } from '../dialogs/SetupWizard';
import { WINE_BACKENDS } from '../../shared/constants';
import { IPC } from '../../shared/ipc-channels';
import type { WineBackend } from '../../shared/types';

type Tab = 'general' | 'tools';

export function SettingsPage() {
  const [tab, setTab] = useState<Tab>('general');
  const { toolStatus, loadToolStatus, steamUsername, steamPassword, setCredentials } = useAppStore();
  const { settings, loaded, loadSettings, updateSetting, pickDirectory } = useSettingsStore();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [reinstalling, setReinstalling] = useState(false);
  const [installingSingle, setInstallingSingle] = useState<string | null>(null);
  const [installLog, setInstallLog] = useState('');

  useEffect(() => {
    if (!loaded) loadSettings();
    if (!toolStatus) loadToolStatus();
  }, []);

  useEffect(() => {
    const unsubs = [
      window.electronAPI.on(IPC.INSTALL_LOG, (data: any) => {
        setInstallLog(prev => prev + data.line + '\n');
      }),
    ];
    return () => unsubs.forEach(fn => fn());
  }, []);

  const handleInstallSingle = async (identifier: string) => {
    setInstallingSingle(identifier);
    setInstallLog('');
    try {
      await window.electronAPI.invoke(IPC.INSTALL_SINGLE_TOOL, identifier);
      await loadToolStatus();
    } finally {
      setInstallingSingle(null);
    }
  };

  const handleReinstallAll = async () => {
    setReinstalling(true);
    setInstallLog('');
    try {
      await window.electronAPI.invoke(IPC.REINSTALL_ALL);
      await loadToolStatus();
    } finally {
      setReinstalling(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <h2 className="text-lg font-semibold text-txt-primary mb-5">Settings</h2>

      {/* Tab bar */}
      <div className="flex gap-0.5 mb-6 bg-white/5 rounded-lg p-0.5 w-fit">
        {(['general', 'tools'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-md text-[13px] font-medium transition-all ${
              tab === t
                ? 'bg-white/10 text-txt-primary'
                : 'text-txt-tertiary hover:text-txt-secondary'
            }`}
          >
            {t === 'general' ? 'General' : 'Tools'}
          </button>
        ))}
      </div>

      {tab === 'general' && (
        <div className="space-y-8 max-w-lg">
          {/* Steam Credentials */}
          <section>
            <h3 className="text-[13px] font-semibold text-txt-secondary mb-3 uppercase tracking-wide">
              Steam Account
            </h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-txt-tertiary mb-1.5">Username</label>
                <input
                  type="text"
                  value={steamUsername}
                  onChange={(e) => setCredentials(e.target.value, steamPassword)}
                  placeholder="Steam username"
                  className="w-full px-3 py-2 rounded-lg bg-white/5 border border-border text-[13px] text-txt-primary
                             placeholder:text-txt-tertiary focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/30 transition"
                />
              </div>
              <div>
                <label className="block text-xs text-txt-tertiary mb-1.5">Password</label>
                <input
                  type="password"
                  value={steamPassword}
                  onChange={(e) => setCredentials(steamUsername, e.target.value)}
                  placeholder="Password"
                  className="w-full px-3 py-2 rounded-lg bg-white/5 border border-border text-[13px] text-txt-primary
                             placeholder:text-txt-tertiary focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/30 transition"
                />
              </div>
              <p className="text-[11px] text-txt-tertiary">Stored in memory only. Cleared on quit.</p>
            </div>
          </section>

          {/* Download Directory */}
          <section>
            <h3 className="text-[13px] font-semibold text-txt-secondary mb-3 uppercase tracking-wide">
              Download Directory
            </h3>
            <div className="flex gap-2 items-center">
              <input
                type="text"
                value={settings.downloadDirectory}
                readOnly
                className="flex-1 px-3 py-2 rounded-lg bg-white/5 border border-border text-[13px] text-txt-secondary truncate font-mono"
              />
              <button
                onClick={pickDirectory}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/5 border border-border text-[13px] text-txt-secondary
                           hover:bg-white/10 transition-colors shrink-0"
              >
                <IconFolder size={15} stroke={1.5} />
                Browse
              </button>
            </div>
          </section>

          {/* Wine Backend */}
          <section>
            <h3 className="text-[13px] font-semibold text-txt-secondary mb-3 uppercase tracking-wide">
              Wine Backend
            </h3>
            <select
              value={settings.wineBackend}
              onChange={(e) => updateSetting('wineBackend', e.target.value as WineBackend)}
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-border text-[13px] text-txt-primary
                         focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/30 transition appearance-none"
            >
              {WINE_BACKENDS.map((b) => (
                <option key={b.value} value={b.value}>{b.label}</option>
              ))}
            </select>
            <p className="text-[11px] text-txt-tertiary mt-1.5">
              GPTK translates DirectX to Metal (Apple Silicon). CrossOver uses WineD3D (OpenGL).
            </p>
          </section>
        </div>
      )}

      {tab === 'tools' && (
        <div className="max-w-lg">
          <div className="bg-bg-secondary rounded-xl border border-border p-1">
            <ToolCheckRow
              label="steamcmd"
              path={toolStatus?.steamcmdPath ?? null}
              onInstall={() => handleInstallSingle('steamcmd')}
              installing={installingSingle === 'steamcmd'}
            />
            <ToolCheckRow
              label="DepotDownloader"
              path={toolStatus?.depotDownloaderPath ?? null}
              onInstall={() => handleInstallSingle('depotdownloader')}
              installing={installingSingle === 'depotdownloader'}
            />
            <ToolCheckRow
              label="Wine (CrossOver)"
              path={toolStatus?.winePath ?? null}
              onInstall={() => handleInstallSingle('gcenx/wine/wine-crossover')}
              installing={installingSingle === 'gcenx/wine/wine-crossover'}
            />
            <ToolCheckRow
              label="Game Porting Toolkit"
              path={toolStatus?.gptkPath ?? null}
              onInstall={() => handleInstallSingle('gptk')}
              installing={installingSingle === 'gptk'}
            />
          </div>

          <div className="flex gap-2 mt-4">
            <button
              onClick={() => setWizardOpen(true)}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-accent text-white text-[13px] font-medium
                         hover:bg-accent-hover transition-colors"
            >
              <IconDownload size={15} stroke={1.5} />
              Install All
            </button>
            <button
              onClick={handleReinstallAll}
              disabled={reinstalling}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-white/5 text-txt-secondary text-[13px]
                         hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <IconTool size={15} stroke={1.5} />
              {reinstalling ? 'Reinstalling...' : 'Reinstall All'}
            </button>
            <button
              onClick={loadToolStatus}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-white/5 text-txt-secondary text-[13px]
                         hover:bg-white/10 transition-colors"
            >
              <IconRefresh size={15} stroke={1.5} />
              Refresh
            </button>
          </div>

          {installLog && (
            <pre className="mt-4 h-[160px] overflow-y-auto text-[11px] leading-relaxed text-txt-tertiary bg-black/30
                            rounded-lg p-3 font-mono whitespace-pre-wrap border border-border">
              {installLog}
            </pre>
          )}
        </div>
      )}

      <SetupWizard open={wizardOpen} onClose={() => { setWizardOpen(false); loadToolStatus(); }} />
    </div>
  );
}
