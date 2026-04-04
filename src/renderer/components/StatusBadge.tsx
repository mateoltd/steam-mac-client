import React from 'react';
import {
  IconClock,
  IconKey,
  IconArrowDown,
  IconCheck,
  IconX,
  IconBan,
} from '@tabler/icons-react';
import type { DownloadStatus } from '../../shared/types';

const statusConfig: Record<string, { icon: React.ElementType; color: string; bg: string; label: string }> = {
  queued:          { icon: IconClock,    color: 'text-txt-tertiary', bg: 'bg-white/5',            label: 'Queued' },
  authenticating:  { icon: IconKey,      color: 'text-yellow-400',   bg: 'bg-yellow-400/10',      label: 'Authenticating' },
  downloading:     { icon: IconArrowDown, color: 'text-accent',      bg: 'bg-accent/10',          label: 'Downloading' },
  completed:       { icon: IconCheck,    color: 'text-green-400',    bg: 'bg-green-400/10',       label: 'Completed' },
  failed:          { icon: IconX,        color: 'text-red-400',      bg: 'bg-red-400/10',         label: 'Failed' },
  cancelled:       { icon: IconBan,      color: 'text-orange-400',   bg: 'bg-orange-400/10',      label: 'Cancelled' },
};

export function StatusBadge({ status }: { status: DownloadStatus }) {
  const config = statusConfig[status.type];
  const Icon = config.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium ${config.color} ${config.bg}`}>
      <Icon size={13} stroke={2} />
      {config.label}
    </span>
  );
}
