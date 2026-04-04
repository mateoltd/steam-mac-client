import React from 'react';
import { IconSearch, IconX, IconDeviceGamepad2 } from '@tabler/icons-react';
import { useSearchStore } from '../stores/search-store';
import { GameDetailPanel } from './GameDetailPanel';
import type { SteamApp } from '../../shared/types';

export function SearchPage() {
  const { query, setQuery, results, isSearching, error, selectedGame, selectGame } = useSearchStore();

  return (
    <div className="flex h-full">
      {/* Search results column */}
      <div className="w-80 flex flex-col border-r border-border bg-bg-primary">
        {/* Search bar */}
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border">
          <IconSearch size={16} stroke={1.5} className="text-txt-tertiary shrink-0" />
          <input
            type="text"
            placeholder="Search Steam games..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1 bg-transparent outline-none text-[13px] text-txt-primary placeholder:text-txt-tertiary"
          />
          {isSearching && (
            <div className="w-3.5 h-3.5 border-[1.5px] border-txt-tertiary border-t-accent rounded-full animate-spin" />
          )}
          {query && !isSearching && (
            <button
              onClick={() => setQuery('')}
              className="text-txt-tertiary hover:text-txt-secondary transition-colors"
            >
              <IconX size={14} stroke={1.5} />
            </button>
          )}
        </div>

        {/* Results list */}
        <div className="flex-1 overflow-y-auto">
          {error ? (
            <div className="p-4 text-center text-[13px] text-red-400">{error}</div>
          ) : results.length === 0 && query && !isSearching ? (
            <div className="p-4 text-center text-[13px] text-txt-tertiary">No results for "{query}"</div>
          ) : results.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-txt-tertiary gap-2">
              <IconDeviceGamepad2 size={32} stroke={1} className="opacity-40" />
              <span className="text-[13px]">Search for games</span>
            </div>
          ) : (
            results.map((app) => (
              <GameRow
                key={app.id}
                app={app}
                selected={selectedGame?.id === app.id}
                onSelect={() => selectGame(app)}
              />
            ))
          )}
        </div>
      </div>

      {/* Detail panel */}
      <div className="flex-1 bg-bg-primary">
        {selectedGame ? (
          <GameDetailPanel />
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-txt-tertiary gap-2">
            <IconDeviceGamepad2 size={40} stroke={1} className="opacity-30" />
            <span className="text-[13px]">Select a game to see depot info</span>
          </div>
        )}
      </div>
    </div>
  );
}

function GameRow({ app, selected, onSelect }: { app: SteamApp; selected: boolean; onSelect: () => void }) {
  return (
    <button
      onClick={onSelect}
      className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${
        selected ? 'bg-accent/10' : 'hover:bg-white/[0.03]'
      }`}
    >
      {app.tinyImage ? (
        <img src={app.tinyImage} alt="" className="w-9 h-9 rounded-md object-cover shrink-0" />
      ) : (
        <div className="w-9 h-9 rounded-md bg-bg-tertiary shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium text-txt-primary truncate">{app.name}</div>
        <div className="flex gap-1 mt-0.5">
          <PlatformTag label="Win" active={app.platforms.windows} />
          <PlatformTag label="Mac" active={app.platforms.mac} />
          <PlatformTag label="Lnx" active={app.platforms.linux} />
        </div>
      </div>
      {!app.platforms.mac && app.platforms.windows && (
        <span className="text-[10px] font-medium text-accent bg-accent/10 px-1.5 py-0.5 rounded whitespace-nowrap shrink-0">
          Win Only
        </span>
      )}
    </button>
  );
}

function PlatformTag({ label, active }: { label: string; active: boolean }) {
  return (
    <span className={`text-[9px] font-semibold uppercase tracking-wide px-1 py-px rounded ${
      active ? 'bg-white/10 text-txt-secondary' : 'bg-white/[0.03] text-txt-tertiary/50'
    }`}>
      {label}
    </span>
  );
}
