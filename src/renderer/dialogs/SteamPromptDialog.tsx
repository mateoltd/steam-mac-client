import React, { useState, useRef, useEffect } from 'react';
import { IconShieldLock } from '@tabler/icons-react';
import { useDownloadStore } from '../stores/download-store';
import { STEAM_PROMPT_INFO } from '../../shared/constants';

export function SteamPromptDialog() {
  const { activePrompt, submitAuthCode, dismissAuthPrompt } = useDownloadStore();
  const [code, setCode] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (activePrompt) {
      setCode('');
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [activePrompt]);

  if (!activePrompt) return null;

  const info = STEAM_PROMPT_INFO[activePrompt.type];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    submitAuthCode(activePrompt.taskId, code.trim());
    setCode('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-bg-secondary rounded-xl shadow-2xl border border-border w-[360px] p-5">
        <div className="flex items-center gap-2.5 mb-1">
          <IconShieldLock size={20} stroke={1.5} className="text-accent" />
          <h3 className="text-base font-semibold text-txt-primary">{info.title}</h3>
        </div>
        <p className="text-xs text-txt-tertiary mb-5 ml-[30px]">{info.description}</p>

        <form onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={info.placeholder}
            autoComplete="off"
            className="w-full px-3 py-2.5 rounded-lg bg-white/5 border border-border text-txt-primary
                       placeholder:text-txt-tertiary focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/30
                       text-center text-lg tracking-[0.3em] font-mono transition"
          />

          <div className="flex gap-2 mt-4">
            <button
              type="button"
              onClick={dismissAuthPrompt}
              className="flex-1 px-4 py-2 rounded-lg bg-white/5 text-txt-secondary text-[13px]
                         hover:bg-white/10 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!code.trim()}
              className="flex-1 px-4 py-2 rounded-lg bg-accent text-white text-[13px] font-medium
                         hover:bg-accent-hover disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              Submit
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
