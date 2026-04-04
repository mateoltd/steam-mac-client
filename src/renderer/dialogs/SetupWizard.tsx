import React, { useState, useEffect } from 'react';
import { IconCheck, IconAlertTriangle } from '@tabler/icons-react';
import { useAppStore } from '../stores/app-store';
import { IPC } from '../../shared/ipc-channels';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function SetupWizard({ open, onClose }: Props) {
  const { loadToolStatus } = useAppStore();
  const [step, setStep] = useState('');
  const [percent, setPercent] = useState(0);
  const [log, setLog] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!open) return;

    const unsubs = [
      window.electronAPI.on(IPC.INSTALL_PROGRESS, (data: any) => {
        setStep(data.step);
        setPercent(data.percent);
      }),
      window.electronAPI.on(IPC.INSTALL_LOG, (data: any) => {
        setLog(prev => prev + data.line + '\n');
      }),
    ];

    return () => unsubs.forEach(fn => fn());
  }, [open]);

  if (!open) return null;

  const handleStart = async () => {
    setRunning(true);
    setError(null);
    setDone(false);
    setLog('');
    setStep('Starting...');
    setPercent(0);

    try {
      const result = await window.electronAPI.invoke(IPC.INSTALL_TOOLS) as any;
      if (result.success) {
        setDone(true);
        await loadToolStatus();
      } else {
        setError(result.message || 'Installation failed.');
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-bg-secondary rounded-xl shadow-2xl border border-border w-[500px] max-h-[80vh] flex flex-col p-5">
        <h3 className="text-base font-semibold text-txt-primary mb-1">Setup Required Tools</h3>
        <p className="text-xs text-txt-tertiary mb-5">
          Installs Homebrew, DepotDownloader, steamcmd, and Wine/GPTK.
        </p>

        {!running && !done && !error && (
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2 rounded-lg bg-white/5 text-txt-secondary text-[13px]
                         hover:bg-white/10 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleStart}
              className="flex-1 px-4 py-2 rounded-lg bg-accent text-white text-[13px] font-medium
                         hover:bg-accent-hover transition-colors"
            >
              Install All
            </button>
          </div>
        )}

        {(running || done || error) && (
          <>
            <div className="mb-3">
              <div className="flex justify-between text-[11px] text-txt-tertiary mb-1.5">
                <span>{step}</span>
                <span className="font-mono">{Math.round(percent * 100)}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${
                    done ? 'bg-green-400' : error ? 'bg-red-400' : 'bg-accent'
                  }`}
                  style={{ width: `${percent * 100}%` }}
                />
              </div>
            </div>

            <div className="flex-1 min-h-0 mb-3">
              <pre className="h-[200px] overflow-y-auto text-[11px] leading-relaxed text-txt-tertiary bg-black/30
                              rounded-lg p-3 font-mono whitespace-pre-wrap border border-border">
                {log || 'Waiting for output...'}
              </pre>
            </div>

            {error && (
              <div className="flex items-start gap-2 text-[13px] text-red-400 mb-3">
                <IconAlertTriangle size={16} stroke={1.5} className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {done && (
              <div className="flex items-center gap-2 text-[13px] text-green-400 mb-3">
                <IconCheck size={16} stroke={2} />
                <span>All tools installed successfully.</span>
              </div>
            )}

            {(done || error) && (
              <button
                onClick={onClose}
                className="w-full px-4 py-2 rounded-lg bg-white/5 text-txt-secondary text-[13px]
                           hover:bg-white/10 transition-colors"
              >
                Close
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
