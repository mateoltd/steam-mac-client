import React, { useState, useRef, useEffect } from 'react';
import { IconUser, IconLock } from '@tabler/icons-react';
import { useAppStore } from '../stores/app-store';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function LoginDialog({ open, onClose }: Props) {
  const { steamUsername, setCredentials } = useAppStore();
  const [username, setUsername] = useState(steamUsername);
  const [password, setPassword] = useState('');
  const usernameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setUsername(steamUsername);
      setPassword('');
      setTimeout(() => usernameRef.current?.focus(), 100);
    }
  }, [open]);

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) return;
    setCredentials(username.trim(), password);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-bg-secondary rounded-xl shadow-2xl border border-border w-[360px] p-5">
        <h3 className="text-base font-semibold text-txt-primary mb-1">Steam Login</h3>
        <p className="text-xs text-txt-tertiary mb-5">
          Credentials are encrypted and saved locally.
        </p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs text-txt-tertiary mb-1.5">Username</label>
            <div className="relative">
              <IconUser size={15} stroke={1.5} className="absolute left-3 top-1/2 -translate-y-1/2 text-txt-tertiary" />
              <input
                ref={usernameRef}
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Steam username"
                autoComplete="username"
                className="w-full pl-9 pr-3 py-2 rounded-lg bg-white/5 border border-border text-[13px] text-txt-primary
                           placeholder:text-txt-tertiary focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/30 transition"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs text-txt-tertiary mb-1.5">Password</label>
            <div className="relative">
              <IconLock size={15} stroke={1.5} className="absolute left-3 top-1/2 -translate-y-1/2 text-txt-tertiary" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                autoComplete="current-password"
                className="w-full pl-9 pr-3 py-2 rounded-lg bg-white/5 border border-border text-[13px] text-txt-primary
                           placeholder:text-txt-tertiary focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/30 transition"
              />
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 rounded-lg bg-white/5 text-txt-secondary text-[13px]
                         hover:bg-white/10 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!username.trim() || !password}
              className="flex-1 px-4 py-2 rounded-lg bg-accent text-white text-[13px] font-medium
                         hover:bg-accent-hover disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
