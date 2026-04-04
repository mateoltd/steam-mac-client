import React, { useState, useEffect } from 'react';
import {
  IconPlayerPlay,
  IconPlus,
  IconTrash,
  IconLoader,
  IconAlertTriangle,
} from '@tabler/icons-react';
import { WINDOWS_VERSIONS, DLL_LOAD_ORDERS } from '../../shared/constants';
import type { WineConfig, DLLLoadOrder, WindowsVersion } from '../../shared/types';
import { IPC } from '../../shared/ipc-channels';

interface Props {
  open: boolean;
  appId: number;
  appName: string;
  gameDir: string;
  onClose: () => void;
}

export function LaunchConfigDialog({ open, appId, appName, gameDir, onClose }: Props) {
  const [exes, setExes] = useState<string[]>([]);
  const [selectedExe, setSelectedExe] = useState('');
  const [windowsVersion, setWindowsVersion] = useState<WindowsVersion>('win10');
  const [dllOverrides, setDllOverrides] = useState<Record<string, DLLLoadOrder>>({});
  const [newDll, setNewDll] = useState('');
  const [envVars, setEnvVars] = useState<Record<string, string>>({});
  const [newEnvKey, setNewEnvKey] = useState('');
  const [newEnvVal, setNewEnvVal] = useState('');
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingExes, setLoadingExes] = useState(false);

  useEffect(() => {
    if (!open || !gameDir) return;
    setLoadingExes(true);
    setError(null);
    window.electronAPI.invoke(IPC.FIND_EXECUTABLES, gameDir).then((result: any) => {
      const list = (result as string[]) || [];
      setExes(list);
      if (list.length > 0 && !selectedExe) setSelectedExe(list[0]);
      setLoadingExes(false);
    });
  }, [open, gameDir]);

  if (!open) return null;

  const handleAddDll = () => {
    if (!newDll.trim()) return;
    setDllOverrides({ ...dllOverrides, [newDll.trim()]: 'n' });
    setNewDll('');
  };

  const handleAddEnv = () => {
    if (!newEnvKey.trim()) return;
    setEnvVars({ ...envVars, [newEnvKey.trim()]: newEnvVal });
    setNewEnvKey('');
    setNewEnvVal('');
  };

  const handleLaunch = async () => {
    if (!selectedExe) return;
    setLaunching(true);
    setError(null);

    const config: WineConfig = { dllOverrides, environmentVariables: envVars, windowsVersion };

    try {
      const result = await window.electronAPI.invoke(IPC.LAUNCH_GAME, {
        exePath: selectedExe, appId, wineConfig: config,
      }) as any;
      if (!result.success) setError(result.message);
      else onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setLaunching(false);
    }
  };

  const displayPath = (p: string) => p.replace(gameDir + '/', '');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-bg-secondary rounded-xl shadow-2xl border border-border w-[500px] max-h-[85vh] overflow-y-auto p-5">
        <h3 className="text-base font-semibold text-txt-primary mb-0.5">Launch {appName}</h3>
        <p className="text-[11px] text-txt-tertiary font-mono mb-5">App ID: {appId}</p>

        {/* Executable */}
        <div className="mb-4">
          <label className="block text-xs text-txt-tertiary mb-1.5 uppercase tracking-wide font-semibold">Executable</label>
          {loadingExes ? (
            <div className="flex items-center gap-2 text-[13px] text-txt-tertiary">
              <IconLoader size={14} className="animate-spin" />
              Scanning for .exe files...
            </div>
          ) : exes.length === 0 ? (
            <p className="text-[13px] text-txt-tertiary">No .exe files found.</p>
          ) : (
            <select
              value={selectedExe}
              onChange={(e) => setSelectedExe(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-border text-[13px] text-txt-primary
                         focus:outline-none focus:border-accent/50 transition appearance-none"
            >
              {exes.map((exe) => (
                <option key={exe} value={exe}>{displayPath(exe)}</option>
              ))}
            </select>
          )}
        </div>

        {/* Windows Version */}
        <div className="mb-4">
          <label className="block text-xs text-txt-tertiary mb-1.5 uppercase tracking-wide font-semibold">Windows Version</label>
          <select
            value={windowsVersion}
            onChange={(e) => setWindowsVersion(e.target.value as WindowsVersion)}
            className="w-full px-3 py-2 rounded-lg bg-white/5 border border-border text-[13px] text-txt-primary
                       focus:outline-none focus:border-accent/50 transition appearance-none"
          >
            {WINDOWS_VERSIONS.map((v) => (
              <option key={v.value} value={v.value}>{v.label}</option>
            ))}
          </select>
        </div>

        {/* DLL Overrides */}
        <div className="mb-4">
          <label className="block text-xs text-txt-tertiary mb-1.5 uppercase tracking-wide font-semibold">DLL Overrides</label>
          {Object.entries(dllOverrides).map(([dll, order]) => (
            <div key={dll} className="flex items-center gap-2 mb-1.5">
              <span className="text-[13px] text-txt-primary font-mono flex-1">{dll}</span>
              <select
                value={order}
                onChange={(e) => setDllOverrides({ ...dllOverrides, [dll]: e.target.value as DLLLoadOrder })}
                className="px-2 py-1 rounded-md bg-white/5 border border-border text-[11px] text-txt-primary appearance-none"
              >
                {DLL_LOAD_ORDERS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <button onClick={() => { const c = { ...dllOverrides }; delete c[dll]; setDllOverrides(c); }}
                className="text-txt-tertiary hover:text-red-400 transition-colors">
                <IconTrash size={14} stroke={1.5} />
              </button>
            </div>
          ))}
          <div className="flex gap-2 mt-1">
            <input type="text" value={newDll} onChange={(e) => setNewDll(e.target.value)}
              placeholder="e.g. d3d11"
              className="flex-1 px-2.5 py-1.5 rounded-md bg-white/5 border border-border text-[13px] text-txt-primary
                         placeholder:text-txt-tertiary focus:outline-none focus:border-accent/50 transition font-mono"
              onKeyDown={(e) => e.key === 'Enter' && handleAddDll()} />
            <button onClick={handleAddDll}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-white/5 text-txt-secondary text-xs hover:bg-white/10 transition-colors">
              <IconPlus size={13} stroke={1.5} /> Add
            </button>
          </div>
        </div>

        {/* Env Vars */}
        <div className="mb-4">
          <label className="block text-xs text-txt-tertiary mb-1.5 uppercase tracking-wide font-semibold">Environment Variables</label>
          {Object.entries(envVars).map(([key, val]) => (
            <div key={key} className="flex items-center gap-2 mb-1.5">
              <span className="text-[13px] text-txt-primary font-mono">{key}</span>
              <span className="text-txt-tertiary">=</span>
              <span className="text-[13px] text-txt-secondary font-mono flex-1 truncate">{val}</span>
              <button onClick={() => { const c = { ...envVars }; delete c[key]; setEnvVars(c); }}
                className="text-txt-tertiary hover:text-red-400 transition-colors">
                <IconTrash size={14} stroke={1.5} />
              </button>
            </div>
          ))}
          <div className="flex gap-2 mt-1">
            <input type="text" value={newEnvKey} onChange={(e) => setNewEnvKey(e.target.value)}
              placeholder="Key"
              className="w-1/3 px-2.5 py-1.5 rounded-md bg-white/5 border border-border text-[13px] text-txt-primary
                         placeholder:text-txt-tertiary focus:outline-none focus:border-accent/50 transition font-mono" />
            <input type="text" value={newEnvVal} onChange={(e) => setNewEnvVal(e.target.value)}
              placeholder="Value"
              className="flex-1 px-2.5 py-1.5 rounded-md bg-white/5 border border-border text-[13px] text-txt-primary
                         placeholder:text-txt-tertiary focus:outline-none focus:border-accent/50 transition font-mono"
              onKeyDown={(e) => e.key === 'Enter' && handleAddEnv()} />
            <button onClick={handleAddEnv}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-white/5 text-txt-secondary text-xs hover:bg-white/10 transition-colors">
              <IconPlus size={13} stroke={1.5} /> Add
            </button>
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-2 text-[13px] text-red-400 mb-3">
            <IconAlertTriangle size={15} stroke={1.5} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex gap-2">
          <button onClick={onClose}
            className="flex-1 px-4 py-2 rounded-lg bg-white/5 text-txt-secondary text-[13px] hover:bg-white/10 transition-colors">
            Cancel
          </button>
          <button onClick={handleLaunch} disabled={!selectedExe || launching}
            className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-green-500/80 text-white text-[13px] font-medium
                       hover:bg-green-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
            {launching ? <IconLoader size={15} className="animate-spin" /> : <IconPlayerPlay size={15} stroke={1.5} />}
            {launching ? 'Launching...' : 'Launch'}
          </button>
        </div>
      </div>
    </div>
  );
}
