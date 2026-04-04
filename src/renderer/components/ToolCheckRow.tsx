import React from 'react';
import { IconCircleCheck, IconCircleX, IconLoader } from '@tabler/icons-react';

interface Props {
  label: string;
  path: string | null;
  onInstall?: () => void;
  installing?: boolean;
}

export function ToolCheckRow({ label, path, onInstall, installing }: Props) {
  const installed = !!path;

  return (
    <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-white/[0.03] transition-colors">
      {installed ? (
        <IconCircleCheck size={18} stroke={1.5} className="text-green-400 shrink-0" />
      ) : (
        <IconCircleX size={18} stroke={1.5} className="text-txt-tertiary shrink-0" />
      )}

      <div className="flex-1 min-w-0">
        <p className="text-[13px] text-txt-primary font-medium">{label}</p>
        {installed ? (
          <p className="text-[11px] text-txt-tertiary font-mono truncate" title={path}>{path}</p>
        ) : (
          <p className="text-[11px] text-txt-tertiary">Not installed</p>
        )}
      </div>

      {!installed && onInstall && (
        <button
          onClick={onInstall}
          disabled={installing}
          className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-accent/10 text-accent text-xs font-medium
                     hover:bg-accent/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
        >
          {installing ? (
            <>
              <IconLoader size={12} stroke={1.5} className="animate-spin" />
              Installing
            </>
          ) : (
            'Install'
          )}
        </button>
      )}
    </div>
  );
}
