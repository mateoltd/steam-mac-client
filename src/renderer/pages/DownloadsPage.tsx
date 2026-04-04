import React, { useState, useEffect, useRef } from 'react';
import {
  IconDownload,
  IconPlayerPlay,
  IconFolder,
  IconX,
  IconChevronDown,
  IconChevronRight,
  IconTerminal2,
  IconWifi,
  IconWifiOff,
  IconBrandSteam,
  IconLoader,
  IconInfoCircle,
  IconRefresh,
  IconPlayerStop,
} from '@tabler/icons-react';
import { useDownloadStore } from '../stores/download-store';
import { StatusBadge } from '../components/StatusBadge';
import { LaunchConfigDialog } from '../dialogs/LaunchConfigDialog';
import type { DownloadTask } from '../../shared/types';
import { IPC } from '../../shared/ipc-channels';

export function DownloadsPage() {
  const { tasks } = useDownloadStore();

  if (tasks.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-txt-tertiary gap-2">
        <IconDownload size={40} stroke={1} className="opacity-30" />
        <span className="text-[13px] font-medium">No Downloads</span>
        <span className="text-xs">Download a game from the Search tab</span>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="divide-y divide-border">
        {tasks.map((task) => (
          <DownloadRow key={task.id} task={task} />
        ))}
      </div>
    </div>
  );
}

type LaunchPhase =
  | 'idle'
  | 'installing-steam'
  | 'launching-steam'
  | 'waiting-for-login'
  | 'ready';

function DownloadRow({ task }: { task: DownloadTask }) {
  const { cancelDownload, revealInFinder, toggleOnlineMode } = useDownloadStore();
  const [showLog, setShowLog] = useState(false);
  const [launchOpen, setLaunchOpen] = useState(false);
  const [launchPhase, setLaunchPhase] = useState<LaunchPhase>('idle');
  const [phaseMessage, setPhaseMessage] = useState('');
  const [phaseError, setPhaseError] = useState<string | null>(null);

  const isActive = task.status.type === 'queued' || task.status.type === 'authenticating' || task.status.type === 'downloading';
  const isCompleted = task.status.type === 'completed';

  const handleLaunch = async () => {
    if (!task.onlineMode) {
      setLaunchOpen(true);
      return;
    }

    // Online mode: ensure Steam is installed and running in the prefix
    try {
      setPhaseError(null);
      setLaunchPhase('installing-steam');
      setPhaseMessage('Checking Steam installation...');

      const installed = await window.electronAPI.invoke(IPC.CHECK_STEAM_IN_PREFIX, task.appId) as boolean;

      if (!installed) {
        setPhaseMessage('Installing Steam in Wine prefix (first time only, may take a minute)...');
        const installResult = await window.electronAPI.invoke(IPC.INSTALL_STEAM_IN_PREFIX, task.appId) as any;
        if (!installResult.success) {
          setLaunchPhase('idle');
          setPhaseMessage('');
          setPhaseError(`Steam install failed: ${installResult.message}`);
          return;
        }
      }

      // Launch Steam with CEF workaround flags
      setLaunchPhase('launching-steam');
      setPhaseMessage('Starting Steam (this may take a moment on first launch while it updates)...');

      const steamResult = await window.electronAPI.invoke(IPC.LAUNCH_STEAM_IN_PREFIX, task.appId) as any;
      if (!steamResult.success) {
        setLaunchPhase('idle');
        setPhaseMessage('');
        setPhaseError(`Failed to start Steam: ${steamResult.message}`);
        return;
      }

      // Show waiting state — user needs to log in
      setLaunchPhase('waiting-for-login');
      setPhaseMessage('');
      setPhaseError(null);
    } catch (err) {
      setLaunchPhase('idle');
      setPhaseMessage('');
      setPhaseError(`Error: ${err}`);
    }
  };

  const handleProceedToLaunch = () => {
    setLaunchPhase('idle');
    setPhaseMessage('');
    setLaunchOpen(true);
  };

  const handleCancelSteamFlow = () => {
    setLaunchPhase('idle');
    setPhaseMessage('');
  };

  return (
    <div className="px-5 py-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-[13px] font-semibold text-txt-primary">{task.appName}</h3>
          <p className="text-xs text-txt-tertiary font-mono mt-0.5">
            App {task.appId} / Depot {task.depotId}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isCompleted && (
            <button
              onClick={() => toggleOnlineMode(task.id)}
              title={task.onlineMode ? 'Online mode: Steam will run for authentication' : 'Offline mode: no Steam needed'}
              className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors ${
                task.onlineMode
                  ? 'bg-accent/10 text-accent'
                  : 'bg-white/5 text-txt-tertiary'
              }`}
            >
              {task.onlineMode ? <IconWifi size={13} stroke={1.5} /> : <IconWifiOff size={13} stroke={1.5} />}
              {task.onlineMode ? 'Online' : 'Offline'}
            </button>
          )}
          <StatusBadge status={task.status} />
        </div>
      </div>

      {/* Error message */}
      {task.status.type === 'failed' && (
        <div className="mt-3 flex items-start gap-2 px-3 py-2.5 bg-red-400/10 rounded-lg border border-red-400/20">
          <IconX size={14} stroke={2} className="text-red-400 mt-0.5 shrink-0" />
          <span className="text-xs text-red-400">{task.status.message}</span>
        </div>
      )}

      {/* Progress bar */}
      {task.status.type === 'downloading' && (
        <div className="mt-3">
          <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
            <div
              className="h-full bg-accent rounded-full transition-all duration-300"
              style={{ width: `${task.progressPercent}%` }}
            />
          </div>
          <p className="text-[11px] text-txt-tertiary mt-1.5 font-mono">{Math.round(task.progressPercent)}%</p>
        </div>
      )}

      {/* Authenticating spinner */}
      {task.status.type === 'authenticating' && (
        <div className="mt-3 flex items-center gap-2">
          <div className="w-3.5 h-3.5 border-[1.5px] border-txt-tertiary border-t-yellow-400 rounded-full animate-spin" />
          <span className="text-xs text-txt-secondary">Authenticating with Steam...</span>
        </div>
      )}

      {/* Steam online flow — loading phases */}
      {launchPhase !== 'idle' && launchPhase !== 'waiting-for-login' && (
        <div className="mt-3 flex items-center gap-2 px-3 py-2.5 bg-accent/5 rounded-lg border border-accent/10">
          <IconLoader size={14} stroke={1.5} className="text-accent animate-spin shrink-0" />
          <span className="text-xs text-txt-secondary flex-1">{phaseMessage}</span>
          <button
            onClick={handleCancelSteamFlow}
            className="text-txt-tertiary hover:text-txt-secondary transition-colors"
          >
            <IconX size={13} stroke={1.5} />
          </button>
        </div>
      )}

      {/* Steam online flow — waiting for user to log in */}
      {launchPhase === 'waiting-for-login' && (
        <SteamWaitingBanner
          appId={task.appId}
          onCancel={handleCancelSteamFlow}
          onProceed={handleProceedToLaunch}
          onRepairComplete={() => {
            // After repair, re-launch Steam
            handleCancelSteamFlow();
            setTimeout(() => handleLaunch(), 300);
          }}
        />
      )}

      {/* Steam flow error */}
      {phaseError && launchPhase === 'idle' && (
        <div className="mt-3 flex items-start gap-2 px-3 py-2.5 bg-red-400/10 rounded-lg border border-red-400/20">
          <IconX size={14} stroke={2} className="text-red-400 mt-0.5 shrink-0" />
          <div className="flex-1">
            <span className="text-xs text-red-400">{phaseError}</span>
          </div>
          <button
            onClick={() => setPhaseError(null)}
            className="text-red-400/60 hover:text-red-400 transition-colors"
          >
            <IconX size={12} stroke={2} />
          </button>
        </div>
      )}

      {/* Action buttons */}
      {launchPhase === 'idle' && (
        <div className="mt-3 flex items-center gap-2">
          {isActive && (
            <button
              onClick={() => cancelDownload(task.id)}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-txt-secondary rounded-md
                         bg-white/5 hover:bg-white/10 transition-colors"
            >
              <IconX size={13} stroke={1.5} />
              Cancel
            </button>
          )}

          {isCompleted && (
            <>
              <button
                onClick={handleLaunch}
                className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-white font-medium rounded-md
                           bg-green-500/80 hover:bg-green-500 transition-colors"
              >
                <IconPlayerPlay size={13} stroke={1.5} />
                Launch
              </button>
              {task.outputDirectory && (
                <button
                  onClick={() => revealInFinder(task.outputDirectory!)}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-txt-secondary rounded-md
                             bg-white/5 hover:bg-white/10 transition-colors"
                >
                  <IconFolder size={13} stroke={1.5} />
                  Reveal
                </button>
              )}
            </>
          )}

          <div className="flex-1" />

          <button
            onClick={() => setShowLog(!showLog)}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-txt-tertiary rounded-md
                       hover:bg-white/5 transition-colors"
          >
            <IconTerminal2 size={13} stroke={1.5} />
            {showLog ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
            Log
          </button>
        </div>
      )}

      {/* Log output */}
      {showLog && (
        <pre className="mt-3 p-3 bg-black/30 text-txt-tertiary text-[11px] leading-relaxed font-mono rounded-lg
                        max-h-40 overflow-y-auto select-text whitespace-pre-wrap border border-border">
          {task.outputLog || '(no output yet)'}
        </pre>
      )}

      {/* Launch config dialog */}
      {launchOpen && (
        <LaunchConfigDialog
          open={launchOpen}
          appId={task.appId}
          appName={task.appName}
          gameDir={task.outputDirectory || ''}
          onlineMode={task.onlineMode}
          onClose={() => setLaunchOpen(false)}
        />
      )}
    </div>
  );
}

function SteamWaitingBanner({
  appId,
  onCancel,
  onProceed,
  onRepairComplete,
}: {
  appId: number;
  onCancel: () => void;
  onProceed: () => void;
  onRepairComplete: () => void;
}) {
  const [elapsed, setElapsed] = useState(0);
  const [repairing, setRepairing] = useState(false);
  const [stoppingSteam, setStoppingSteam] = useState(false);
  const [steamLogs, setSteamLogs] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const startRef = useRef(Date.now());
  const logEndRef = useRef<HTMLPreElement>(null);

  // Timer
  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Listen for Steam log lines from main process
  useEffect(() => {
    const unsub = window.electronAPI.on(IPC.STEAM_LOG, (data: any) => {
      const line = data?.line || String(data);
      setSteamLogs(prev => {
        const next = [...prev, line];
        return next.length > 200 ? next.slice(-200) : next;
      });
    });
    return unsub;
  }, []);

  // Auto-scroll log
  useEffect(() => {
    logEndRef.current?.scrollTo({ top: logEndRef.current.scrollHeight });
  }, [steamLogs]);

  const formatElapsed = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
  };

  const lastLogLine = steamLogs.length > 0 ? steamLogs[steamLogs.length - 1] : null;

  const handleRepair = async () => {
    setRepairing(true);
    setSteamLogs([]);
    try {
      const result = await window.electronAPI.invoke(IPC.REPAIR_STEAM_IN_PREFIX, appId) as any;
      if (result.success) {
        onRepairComplete();
      }
    } catch {
      // repair failed — user can retry
    } finally {
      setRepairing(false);
    }
  };

  const handleStopSteam = async () => {
    setStoppingSteam(true);
    try {
      await window.electronAPI.invoke(IPC.SHUTDOWN_STEAM_IN_PREFIX, appId);
      // Give Steam a moment to finish its shutdown sequence
      setTimeout(() => {
        setStoppingSteam(false);
        onCancel();
      }, 3000);
    } catch {
      setStoppingSteam(false);
    }
  };

  return (
    <div className="mt-3 px-3 py-3 bg-accent/5 rounded-lg border border-accent/10">
      <div className="flex items-start gap-2 mb-2">
        <IconBrandSteam size={16} stroke={1.5} className="text-accent mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-[13px] text-txt-primary font-medium">Steam is starting</p>
            <span className="text-[11px] text-txt-tertiary font-mono">{formatElapsed(elapsed)}</span>
            <IconLoader size={12} stroke={1.5} className="text-accent animate-spin" />
          </div>

          {/* Latest status line */}
          {lastLogLine && (
            <p className="text-[11px] text-txt-secondary font-mono mt-1 truncate">{lastLogLine}</p>
          )}

          <p className="text-[11px] text-txt-tertiary mt-1 leading-relaxed">
            A Steam window should appear. Log in with the account that owns this game.
            On first launch, Steam updates itself — this can take several minutes.
          </p>
          <p className="text-[11px] text-txt-tertiary mt-1 leading-relaxed">
            Once you're logged in and can see your library, click "Launch Game" below.
            Keep Steam open while playing — it provides authentication for online multiplayer.
          </p>

          {elapsed > 120 && (
            <p className="text-[11px] text-yellow-400/80 mt-1.5 leading-relaxed">
              <IconInfoCircle size={11} stroke={1.5} className="inline -mt-px mr-0.5" />
              Taking longer than expected? Try "Repair Steam" below to reinstall from scratch.
            </p>
          )}
        </div>
      </div>

      {/* Expandable Steam log output */}
      {steamLogs.length > 0 && (
        <div className="mt-2">
          <button
            onClick={() => setShowLogs(!showLogs)}
            className="flex items-center gap-1 text-[11px] text-txt-tertiary hover:text-txt-secondary transition-colors"
          >
            <IconTerminal2 size={12} stroke={1.5} />
            {showLogs ? <IconChevronDown size={11} /> : <IconChevronRight size={11} />}
            Steam Output ({steamLogs.length} lines)
          </button>
          {showLogs && (
            <pre
              ref={logEndRef}
              className="mt-1.5 p-2 bg-black/30 text-txt-tertiary text-[10px] leading-relaxed font-mono
                         rounded-md max-h-32 overflow-y-auto select-text whitespace-pre-wrap border border-border"
            >
              {steamLogs.join('\n')}
            </pre>
          )}
        </div>
      )}

      <div className="flex gap-2 mt-3">
        <button
          onClick={handleStopSteam}
          disabled={stoppingSteam}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-txt-secondary rounded-md
                     bg-white/5 hover:bg-white/10 disabled:opacity-40 transition-colors"
        >
          {stoppingSteam
            ? <IconLoader size={13} stroke={1.5} className="animate-spin" />
            : <IconPlayerStop size={13} stroke={1.5} />}
          {stoppingSteam ? 'Stopping...' : 'Stop Steam'}
        </button>
        <button
          onClick={handleRepair}
          disabled={repairing}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-txt-secondary rounded-md
                     bg-white/5 hover:bg-white/10 disabled:opacity-40 transition-colors"
        >
          {repairing
            ? <IconLoader size={13} stroke={1.5} className="animate-spin" />
            : <IconRefresh size={13} stroke={1.5} />}
          {repairing ? 'Repairing...' : 'Repair Steam'}
        </button>
        <div className="flex-1" />
        <button
          onClick={onProceed}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-white font-medium rounded-md
                     bg-green-500/80 hover:bg-green-500 transition-colors"
        >
          <IconPlayerPlay size={13} stroke={1.5} />
          Launch Game
        </button>
      </div>
    </div>
  );
}
