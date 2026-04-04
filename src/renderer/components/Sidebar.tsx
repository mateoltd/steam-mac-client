import React from 'react';
import { IconSearch, IconDownload, IconSettings } from '@tabler/icons-react';
import { useAppStore } from '../stores/app-store';
import { useDownloadStore } from '../stores/download-store';

type SidebarItem = 'search' | 'downloads' | 'settings';

const items: { id: SidebarItem; label: string; icon: React.ElementType }[] = [
  { id: 'search', label: 'Search', icon: IconSearch },
  { id: 'downloads', label: 'Downloads', icon: IconDownload },
  { id: 'settings', label: 'Settings', icon: IconSettings },
];

export function Sidebar() {
  const { sidebarItem, setSidebarItem } = useAppStore();
  const tasks = useDownloadStore((s) => s.tasks);
  const activeCount = tasks.filter(t =>
    t.status.type === 'queued' || t.status.type === 'authenticating' || t.status.type === 'downloading'
  ).length;

  return (
    <div className="flex flex-col w-44 h-full bg-bg-sidebar backdrop-blur-xl border-r border-border">
      <div className="titlebar-drag h-12 shrink-0" />
      <nav className="flex flex-col gap-0.5 px-1.5">
        {items.map((item) => {
          const Icon = item.icon;
          const active = sidebarItem === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setSidebarItem(item.id)}
              className={`
                titlebar-no-drag flex items-center gap-2 px-2.5 py-[6px] rounded-lg text-[12px] font-medium transition-all
                ${active
                  ? 'bg-white/10 text-white'
                  : 'text-txt-secondary hover:bg-white/[0.05] hover:text-txt-primary'}
              `}
            >
              <Icon size={16} stroke={1.5} />
              <span>{item.label}</span>
              {item.id === 'downloads' && activeCount > 0 && (
                <span className="bg-accent text-white text-[10px] font-bold px-1.5 py-px rounded-full min-w-[18px] text-center leading-[16px]">
                  {activeCount}
                </span>
              )}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
