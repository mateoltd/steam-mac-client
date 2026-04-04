import React, { useState } from 'react';
import { IconDownload, IconLogin, IconDatabase } from '@tabler/icons-react';
import { useSearchStore } from '../stores/search-store';
import { useAppStore } from '../stores/app-store';
import { useDownloadStore } from '../stores/download-store';
import { LoginDialog } from '../dialogs/LoginDialog';
import type { Depot } from '../../shared/types';

export function GameDetailPanel() {
  const { selectedGame, depots, isLoadingDepots, depotError, selectedDepotId, selectDepot } = useSearchStore();
  const { isAuthenticated, steamUsername, steamPassword, toolStatus, setSidebarItem } = useAppStore();
  const startDownload = useDownloadStore((s) => s.startDownload);
  const [loginOpen, setLoginOpen] = useState(false);

  if (!selectedGame) return null;
  const app = selectedGame;
  const selectedDepot = depots.find(d => d.id === selectedDepotId);

  const handleDownload = async () => {
    if (!selectedDepotId || !isAuthenticated) return;
    await startDownload(app.id, app.name, selectedDepotId, steamUsername, steamPassword);
    setSidebarItem('downloads');
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
        {app.tinyImage ? (
          <img src={app.tinyImage} alt="" className="w-12 h-12 rounded-lg object-cover" />
        ) : (
          <div className="w-12 h-12 rounded-lg bg-bg-tertiary" />
        )}
        <div>
          <h2 className="text-base font-semibold text-txt-primary">{app.name}</h2>
          <p className="text-xs text-txt-tertiary select-text font-mono">App ID: {app.id}</p>
        </div>
      </div>

      {/* Depot list */}
      <div className="flex-1 overflow-y-auto">
        {isLoadingDepots ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-txt-tertiary">
            <div className="w-5 h-5 border-[1.5px] border-txt-tertiary border-t-accent rounded-full animate-spin" />
            <span className="text-[13px]">Loading depot info...</span>
          </div>
        ) : depotError ? (
          <div className="p-5 text-center text-[13px] text-red-400">{depotError}</div>
        ) : depots.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-txt-tertiary gap-2">
            <IconDatabase size={28} stroke={1} className="opacity-40" />
            <span className="text-[13px]">No depots found</span>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {depots.map((depot) => (
              <DepotRow
                key={depot.id}
                depot={depot}
                selected={selectedDepotId === depot.id}
                onSelect={() => selectDepot(depot.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Action bar */}
      <div className="flex items-center gap-3 px-5 py-3 border-t border-border bg-bg-secondary/50">
        {selectedDepot && (
          <div className="text-xs text-txt-tertiary">
            <span className="font-mono font-medium text-txt-secondary">Depot {selectedDepot.id}</span>
            {selectedDepot.maxSize && (
              <span className="ml-2">{formatSize(selectedDepot.maxSize)}</span>
            )}
          </div>
        )}
        <div className="flex-1" />
        {!isAuthenticated ? (
          <button
            onClick={() => setLoginOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-[7px] rounded-lg bg-white/10 text-txt-primary text-[13px] font-medium
                       hover:bg-white/15 transition-colors"
          >
            <IconLogin size={15} stroke={1.5} />
            Log In to Download
          </button>
        ) : (
          <button
            onClick={handleDownload}
            disabled={!selectedDepotId || !toolStatus?.hasDownloadTool}
            className="flex items-center gap-1.5 px-3.5 py-[7px] rounded-lg bg-accent text-white text-[13px] font-medium
                       hover:bg-accent-hover disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <IconDownload size={15} stroke={1.5} />
            Download
          </button>
        )}
      </div>

      <LoginDialog open={loginOpen} onClose={() => setLoginOpen(false)} />
    </div>
  );
}

function DepotRow({ depot, selected, onSelect }: { depot: Depot; selected: boolean; onSelect: () => void }) {
  return (
    <button
      onClick={onSelect}
      className={`w-full flex items-center px-5 py-3 text-left transition-colors ${
        selected ? 'bg-accent/8' : 'hover:bg-white/[0.03]'
      }`}
    >
      <div className="flex-1 min-w-0">
        <div className="text-[13px] text-txt-primary">{depot.name}</div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-xs text-txt-tertiary font-mono">#{depot.id}</span>
          {depot.maxSize && (
            <span className="text-xs text-txt-tertiary">{formatSize(depot.maxSize)}</span>
          )}
        </div>
      </div>
      <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded bg-white/5 text-txt-tertiary">
        {depot.oslist.join(' / ') || 'shared'}
      </span>
    </button>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
